import type { SupabaseClient } from '@supabase/supabase-js'
import type { CanonicalEvent, ParsedWebhook } from './types.ts'

export interface ProjectionInput {
  provider: string
  rawBody: string
  parsed: ParsedWebhook
}

export interface ProjectionResult {
  runId: string | null
  skipped: boolean
  reason?: string
}

const DUPLICATE = '23505'

type LoggableEvent = CanonicalEvent & {
  clientId?: string | null
  agentId?: string | null
  runId?: string | null
  latencyMs?: number
}

async function logEvent(db: SupabaseClient, e: LoggableEvent): Promise<void> {
  await db.from('events').insert({
    client_id: e.clientId ?? null,
    agent_id: e.agentId ?? null,
    run_id: e.runId ?? null,
    type: e.type,
    level: e.level,
    message: e.message ?? null,
    latency_ms: e.latencyMs ?? null,
    payload: e.payload ?? null,
  })
}

/**
 * Convierte un webhook interpretado en filas.
 *
 * Orden deliberado: primero el crudo, después todo lo demás. Si algo falla a
 * mitad, el evento sigue en run_raw_events con su processing_error y puede
 * reprocesarse; nunca se pierde una llamada por un fallo de proyección.
 */
export async function projectWebhook(
  db: SupabaseClient,
  { provider, rawBody, parsed }: ProjectionInput,
): Promise<ProjectionResult> {
  const startedMs = Date.now()

  // 1. Crudo. El constraint decide si es la primera vez que llega: intentar e
  //    interpretar el 23505 evita la carrera de comprobar-y-luego-insertar.
  const { data: rawRow, error: rawError } = await db.from('run_raw_events').insert({
    provider,
    provider_call_id: parsed.providerCallId,
    event_type: parsed.eventType,
    payload: JSON.parse(rawBody || '{}'),
    signature_verified: true,
  }).select('id').single()

  if (rawError?.code === DUPLICATE) {
    const { data: existing } = await db.from('runs')
      .select('id').eq('provider', provider)
      .eq('provider_call_id', parsed.providerCallId ?? '').maybeSingle()
    return { runId: existing?.id ?? null, skipped: true, reason: 'evento ya recibido' }
  }
  if (rawError) throw new Error(`No se pudo guardar el crudo: ${rawError.message}`)

  const rawId = rawRow!.id
  const fail = async (reason: string): Promise<ProjectionResult> => {
    await db.from('run_raw_events')
      .update({ processing_error: reason, processed_at: new Date().toISOString() })
      .eq('id', rawId)
    await logEvent(db, { type: 'projection.failed', level: 'error', message: reason })
    return { runId: null, skipped: true, reason }
  }

  // 2. Eventos que el adaptador quiso reportar del propio parseo.
  for (const e of parsed.events) await logEvent(db, e)

  if (!parsed.isFinal || !parsed.run) {
    await db.from('run_raw_events')
      .update({ processed_at: new Date().toISOString() }).eq('id', rawId)
    return { runId: null, skipped: true, reason: 'evento no final' }
  }

  // 3. ¿A qué agente pertenece? Sin esto no hay cliente al que atribuir nada.
  const { data: agent } = await db.from('agents')
    .select('id, client_id, extraction_version')
    .eq('provider', provider)
    .eq('provider_agent_id', parsed.run.providerAgentId ?? '')
    .maybeSingle()

  if (!agent) {
    return await fail(
      `Agente desconocido para el proveedor ${provider}: ${parsed.run.providerAgentId}`,
    )
  }

  const run = parsed.run
  const version = agent.extraction_version ?? 1

  // 4. Run. Si ya existía (carrera entre dos entregas), se reutiliza.
  const { data: runRow, error: runError } = await db.from('runs').insert({
    client_id: agent.client_id,
    agent_id: agent.id,
    provider,
    provider_call_id: run.providerCallId,
    direction: run.direction,
    caller_number: run.callerNumber,
    started_at: run.startedAt,
    ended_at: run.endedAt,
    duration_sec: run.durationSec,
    status: run.status,
    ended_reason: run.endedReason,
    recording_url: run.recordingUrl,
    summary: run.summary,
    reason_category: run.extracted.reason_category ?? null,
    urgency: run.extracted.urgency ?? null,
    extraction_version: version,
  }).select('id').single()

  let runId: string
  if (runError?.code === DUPLICATE) {
    const { data: existing } = await db.from('runs').select('id')
      .eq('provider', provider).eq('provider_call_id', run.providerCallId).single()
    runId = existing!.id
  } else if (runError) {
    return await fail(`No se pudo crear el run: ${runError.message}`)
  } else {
    runId = runRow!.id
  }

  // 5. Turnos y valores. `upsert` con ignoreDuplicates porque un reintento
  //    parcial puede haberlos escrito ya.
  if (run.turns.length) {
    await db.from('transcript_turns').upsert(
      run.turns.map(t => ({
        run_id: runId, seq: t.seq, speaker: t.speaker,
        text: t.text, offset_ms: t.offsetMs ?? null,
      })),
      { onConflict: 'run_id,seq', ignoreDuplicates: true },
    )
  }

  const entries = Object.entries(run.extracted)
  if (entries.length) {
    await db.from('extracted_values').upsert(
      entries.map(([k, v]) => ({
        run_id: runId, field_key: k, value_text: v, extraction_version: version,
      })),
      { onConflict: 'run_id,field_key,extraction_version', ignoreDuplicates: true },
    )
  }

  // 6. Consumo. La idempotencia real la da el unique de usage_events.
  if (parsed.usage.length) {
    await db.from('usage_events').upsert(
      parsed.usage.map(u => ({
        client_id: agent.client_id, agent_id: agent.id, module_type: 'voice',
        run_id: runId, provider, component: u.component,
        quantity: u.quantity, unit: u.unit, cost_usd: u.costUsd,
        source_event_id: u.sourceEventId, occurred_at: run.endedAt ?? run.startedAt,
      })),
      { onConflict: 'provider,source_event_id,component', ignoreDuplicates: true },
    )
  }

  // 7. ¿Se capturó todo lo obligatorio?
  const { data: required } = await db.from('field_defs')
    .select('key').eq('agent_id', agent.id).is('intent_id', null).eq('required', true)

  const missing = (required ?? [])
    .map((f: { key: string }) => f.key)
    .filter((k: string) => !run.extracted[k] || run.extracted[k].trim() === '')

  const extractionStatus = entries.length === 0
    ? 'failed'
    : missing.length > 0 ? 'partial' : 'complete'

  await db.from('runs').update({ extraction_status: extractionStatus }).eq('id', runId)
  await db.from('run_raw_events')
    .update({ processed_at: new Date().toISOString() }).eq('id', rawId)

  await logEvent(db, {
    type: 'run.projected',
    level: missing.length ? 'warn' : 'info',
    message: missing.length ? `Faltaron campos requeridos: ${missing.join(', ')}` : undefined,
    clientId: agent.client_id, agentId: agent.id, runId,
    latencyMs: Date.now() - startedMs,
    payload: { turns: run.turns.length, fields: entries.length, missing },
  })

  return { runId, skipped: false }
}
