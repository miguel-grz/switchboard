import { registerAdapter, type ProviderAdapter, type AssistantInput } from '../adapter.ts'
import type {
  CanonicalEvent, CanonicalRun, CanonicalTurn, CanonicalUsage,
  FieldDef, ParsedWebhook, RunStatus,
} from '../../types.ts'

/** Razones de fin que no son un fallo del sistema pero tampoco una llamada atendida. */
const NO_ANSWER = new Set([
  'customer-did-not-answer', 'customer-busy', 'voicemail',
  'no-answer', 'customer-did-not-give-microphone-permission',
])

function statusFrom(endedReason: string | null): RunStatus {
  if (!endedReason) return 'in_progress'
  if (NO_ANSWER.has(endedReason)) return 'no_answer'
  // Vapi prefija con `pipeline-error-` / `assistant-error-` todo fallo interno.
  if (/error|failed/i.test(endedReason)) return 'failed'
  return 'completed'
}

/** Los valores viajan como texto: el tipo real lo declara field_defs. */
function flatten(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v === null || v === undefined) out[k] = ''
    else if (typeof v === 'object') out[k] = JSON.stringify(v)
    else out[k] = String(v)
  }
  return out
}

function turnsFrom(messages: unknown): CanonicalTurn[] {
  if (!Array.isArray(messages)) return []
  const turns: CanonicalTurn[] = []
  for (const m of messages) {
    const role = m?.role
    // `system` y `tool` no son conversación: no van al transcript visible.
    if (role !== 'assistant' && role !== 'user') continue
    const text = typeof m.message === 'string' ? m.message : ''
    if (!text) continue
    turns.push({
      seq: turns.length + 1,
      speaker: role === 'assistant' ? 'agent' : 'caller',
      text,
      offsetMs: typeof m.secondsFromStart === 'number'
        ? Math.round(m.secondsFromStart * 1000)
        : undefined,
    })
  }
  return turns
}

function durationSec(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null
}

/** Nombres que Vapi usa por componente, mapeados a los nuestros. */
const COMPONENT_BY_KEY: Record<string, CanonicalUsage['component']> = {
  transport: 'telephony', transportcost: 'telephony', telephony: 'telephony',
  stt: 'stt', transcriber: 'stt', transcribercost: 'stt',
  llm: 'llm', model: 'llm', modelcost: 'llm',
  tts: 'tts', voice: 'tts', voicecost: 'tts',
  vapi: 'other', analysis: 'other', knowledgebase: 'other',
}

function componentFor(key: string): CanonicalUsage['component'] | null {
  return COMPONENT_BY_KEY[key.toLowerCase().replace(/[^a-z]/g, '')] ?? null
}

function extractUsage(
  msg: Record<string, any>,
  callId: string | null,
): CanonicalUsage[] {
  const call = (msg.call ?? {}) as Record<string, any>
  const id = callId ?? 'unknown'
  const seconds = durationSec(call.startedAt ?? null, call.endedAt ?? null) ?? 0
  const minutes = seconds / 60
  const out: CanonicalUsage[] = []

  const push = (component: CanonicalUsage['component'], cost: number) => {
    const existing = out.find(u => u.component === component)
    if (existing) {
      existing.costUsd = (existing.costUsd ?? 0) + cost
      return
    }
    out.push({
      component,
      // Solo la telefonía se mide en tiempo; el resto se registra por llamada
      // porque Vapi no reporta tokens ni caracteres en el desglose.
      quantity: component === 'telephony' ? minutes : 1,
      unit: component === 'telephony' ? 'minutes' : 'calls',
      costUsd: cost,
      sourceEventId: `${id}:${component}`,
    })
  }

  const bd = call.costBreakdown
  if (Array.isArray(bd)) {
    for (const item of bd) {
      const c = componentFor(String(item?.type ?? ''))
      if (c) push(c, Number(item?.cost ?? 0))
    }
  } else if (bd && typeof bd === 'object') {
    for (const [k, v] of Object.entries(bd)) {
      if (k.toLowerCase() === 'total' || typeof v !== 'number') continue
      const c = componentFor(k)
      if (c) push(c, v)
    }
  }

  if (out.length === 0 && typeof call.cost === 'number') {
    out.push({
      component: 'other',
      quantity: 1,
      unit: 'calls',
      costUsd: call.cost,
      sourceEventId: `${id}:total`,
    })
  }

  return out
}

/**
 * Comparación de tiempo constante. Un `===` sobre secretos filtra por cuánto
 * tarda en fallar cuántos caracteres iniciales coincidían.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const vapiAdapter: ProviderAdapter = {
  name: 'vapi',
  apiBaseUrl: 'https://api.vapi.ai',

  async verifySignature(headers: Headers, rawBody: string, secret: string): Promise<boolean> {
    try {
      // Modo secreto compartido: Vapi lo envía tal cual en la cabecera.
      const shared = headers.get('x-vapi-secret')
        ?? headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      if (shared) return timingSafeEqual(shared, secret)

      // Modo HMAC: se recalcula sobre el cuerpo crudo, nunca sobre el objeto
      // parseado — reserializar cambia bytes y rompería la firma.
      const provided = headers.get('x-vapi-signature')
      if (!provided) return false

      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      )
      const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
      const expected = [...new Uint8Array(sig)]
        .map(b => b.toString(16).padStart(2, '0')).join('')
      return timingSafeEqual(provided.trim().toLowerCase(), expected)
    } catch {
      // Una credencial malformada es un rechazo, no una caída del webhook.
      return false
    }
  },

  parseWebhook(payload: unknown): ParsedWebhook {
    const msg = (payload as { message?: Record<string, any> })?.message
    if (!msg || typeof msg.type !== 'string') {
      throw new Error('Payload de Vapi sin message.type')
    }

    const call = (msg.call ?? {}) as Record<string, any>
    const eventType = msg.type
    const providerCallId = typeof call.id === 'string' ? call.id : null
    const events: CanonicalEvent[] = []

    if (eventType !== 'end-of-call-report') {
      return { providerCallId, eventType, isFinal: false, run: null, usage: [], events }
    }

    const artifact = (msg.artifact ?? {}) as Record<string, any>
    // El análisis viaja en message.analysis, pero algunas versiones lo dejan
    // solo bajo call.analysis. Se aceptan ambos en vez de asumir uno.
    const analysis = (msg.analysis ?? call.analysis ?? null) as Record<string, any> | null

    if (!analysis) {
      events.push({
        type: 'extraction.missing',
        level: 'warn',
        message: 'El reporte llegó sin bloque de análisis: no hay datos extraídos',
      })
    }

    const endedReason = typeof msg.endedReason === 'string' ? msg.endedReason : null
    const startedAt = typeof call.startedAt === 'string' ? call.startedAt : null
    const endedAt = typeof call.endedAt === 'string' ? call.endedAt : null

    const run: CanonicalRun = {
      providerCallId: providerCallId ?? '',
      providerAgentId: typeof call.assistantId === 'string' ? call.assistantId : null,
      direction: String(call.type ?? '').toLowerCase().includes('outbound')
        ? 'outbound' : 'inbound',
      callerNumber: call.customer?.number ?? null,
      startedAt: startedAt ?? new Date().toISOString(),
      endedAt,
      durationSec: durationSec(startedAt, endedAt),
      status: statusFrom(endedReason),
      endedReason,
      recordingUrl: artifact.recording?.stereoUrl ?? artifact.recording?.url ?? null,
      summary: analysis?.summary ?? null,
      extracted: flatten(analysis?.structuredData),
      turns: turnsFrom(artifact.messages),
    }

    const usage = extractUsage(msg, providerCallId)
    if (usage.length === 1 && usage[0].sourceEventId.endsWith(':total')) {
      events.push({
        type: 'usage.breakdown_missing',
        level: 'warn',
        message: 'Vapi no envió desglose de costo: se registra solo el total',
      })
    }

    return { providerCallId, eventType, isFinal: true, run, usage, events }
  },

  buildExtractionSchema(fields: FieldDef[]): unknown {
    const JSON_TYPE: Record<FieldDef['type'], string> = {
      text: 'string', phone: 'string', date: 'string',
      select: 'string', number: 'number', boolean: 'boolean',
    }
    const properties: Record<string, Record<string, unknown>> = {}
    for (const f of fields) {
      const prop: Record<string, unknown> = { type: JSON_TYPE[f.type] }
      if (f.description) prop.description = f.description
      if (f.type === 'date') prop.format = 'date'
      if (f.type === 'select' && f.options?.length) prop.enum = f.options
      properties[f.key] = prop
    }
    return {
      type: 'object',
      properties,
      required: fields.filter(f => f.required).map(f => f.key),
    }
  },

  buildAssistantConfig(input: AssistantInput): unknown {
    return {
      name: input.name,
      model: {
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'system', content: input.systemPrompt }],
      },
      // Sin structuredDataPlan habilitado, Vapi no devuelve structuredData y
      // la extracción llegaría vacía en cada llamada.
      analysisPlan: {
        structuredDataPlan: {
          enabled: true,
          schema: this.buildExtractionSchema(input.fields),
        },
        summaryPlan: { enabled: true },
      },
    }
  },
}

registerAdapter(vapiAdapter)
