# Ingesta de llamadas (Plan 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un webhook de Vapi se convierta en un run completo — transcripción, datos extraídos, costo y eventos — de forma idempotente y sin acoplar el sistema al proveedor.

**Architecture:** Una frontera de adaptador aísla todo lo que sabe de Vapi. El adaptador son funciones puras (sin APIs de Deno) para poder probarlas desde Vitest en Node; solo el manejador HTTP usa `Deno.serve`. El webhook escribe primero el payload crudo y proyecta después: si la proyección falla, el evento no se pierde y se reprocesa.

**Tech Stack:** Supabase Edge Functions (Deno) · TypeScript · Web Crypto para HMAC · Vitest

## Global Constraints

- **El resto del sistema nunca importa tipos ni SDK de Vapi.** Todo lo específico del proveedor vive bajo `supabase/functions/_shared/providers/vapi/`. Fuera de ahí solo existen los tipos canónicos.
- **Las funciones del adaptador son puras y sin dependencias de Deno** (nada de `Deno.env`, `Deno.serve`) para que Vitest pueda importarlas en Node.
- **Se escribe el crudo antes de proyectar, siempre.** Ninguna falla aguas abajo puede perder un evento.
- **Idempotencia por constraint de base, no por comprobación previa**: se intenta insertar y se trata el `23505` como "ya procesado". Comprobar-y-luego-insertar tiene una carrera entre ambos pasos.
- **Dinero como `numeric`**, nunca `float`, y en la base como `numeric(12,6)`.
- Identificadores en inglés; comentarios y documentación en español.
- Todo evento relevante escribe una fila en `events` con su `type`, `level` y `latency_ms`.

---

### Task 1: Tipos canónicos y contrato del adaptador

**Files:**
- Create: `supabase/functions/_shared/types.ts`
- Create: `supabase/functions/_shared/providers/adapter.ts`
- Test: `tests/ingest/contract.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `CanonicalRun`, `CanonicalTurn`, `CanonicalUsage`, `CanonicalEvent`, `ParsedWebhook`, `ProviderAdapter`, `getAdapter(name)`

- [ ] **Step 1: Escribir la prueba de contrato (debe fallar)**

Crear `tests/ingest/contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getAdapter } from '../../supabase/functions/_shared/providers/adapter'

describe('registro de adaptadores', () => {
  it('resuelve el adaptador de vapi por nombre', () => {
    const a = getAdapter('vapi')
    expect(a.name).toBe('vapi')
    expect(typeof a.verifySignature).toBe('function')
    expect(typeof a.parseWebhook).toBe('function')
    expect(typeof a.buildExtractionSchema).toBe('function')
  })

  it('falla con un proveedor desconocido en vez de devolver algo vacío', () => {
    expect(() => getAdapter('paloma')).toThrow(/desconocido/i)
  })

  // Retell existe para demostrar que la interfaz basta, no para funcionar.
  it('expone retell como stub que declara su ausencia', () => {
    const a = getAdapter('retell')
    expect(a.name).toBe('retell')
    expect(() => a.parseWebhook({})).toThrow(/no implementado/i)
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ingest/contract.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Escribir los tipos canónicos**

Crear `supabase/functions/_shared/types.ts`:

```ts
/**
 * Modelo canónico. Ninguna de estas formas debe contener campos con nombre o
 * estructura de un proveedor concreto: si Vapi cambia su payload, cambia el
 * adaptador y nada más.
 */

export type RunStatus = 'in_progress' | 'completed' | 'failed' | 'no_answer'
export type UsageComponent = 'telephony' | 'stt' | 'llm' | 'tts' | 'other'
export type UsageUnit = 'minutes' | 'tokens' | 'characters' | 'calls'
export type EventLevel = 'debug' | 'info' | 'warn' | 'error'

export interface CanonicalTurn {
  seq: number
  speaker: 'agent' | 'caller'
  text: string
  offsetMs?: number
}

export interface CanonicalUsage {
  component: UsageComponent
  quantity: number
  unit: UsageUnit
  costUsd: number | null
  /** Identificador estable del cargo en el proveedor, para idempotencia. */
  sourceEventId: string
}

export interface CanonicalRun {
  providerCallId: string
  providerAgentId: string | null
  direction: 'inbound' | 'outbound'
  callerNumber: string | null
  startedAt: string
  endedAt: string | null
  durationSec: number | null
  status: RunStatus
  endedReason: string | null
  recordingUrl: string | null
  summary: string | null
  /** Pares clave-valor tal como los devolvió el proveedor. */
  extracted: Record<string, string>
  turns: CanonicalTurn[]
}

export interface CanonicalEvent {
  type: string
  level: EventLevel
  message?: string
  payload?: Record<string, unknown>
}

/** Resultado de interpretar un webhook. `run` es null si el evento no lo describe. */
export interface ParsedWebhook {
  providerCallId: string | null
  eventType: string
  /** true solo cuando el evento cierra la llamada y trae el reporte completo. */
  isFinal: boolean
  run: CanonicalRun | null
  usage: CanonicalUsage[]
  events: CanonicalEvent[]
}

export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'phone'
  required: boolean
  description: string | null
  options: string[] | null
}
```

- [ ] **Step 4: Escribir el contrato y el registro**

Crear `supabase/functions/_shared/providers/adapter.ts`:

```ts
import type { ParsedWebhook, FieldDef } from '../types.ts'

export interface ProviderAdapter {
  readonly name: string
  /** Verifica que el webhook viene del proveedor. Nunca lanza: devuelve false. */
  verifySignature(headers: Headers, rawBody: string, secret: string): Promise<boolean>
  parseWebhook(payload: unknown): ParsedWebhook
  /** Traduce field_defs al esquema de extracción del proveedor. */
  buildExtractionSchema(fields: FieldDef[]): unknown
}

const registry = new Map<string, ProviderAdapter>()

export function registerAdapter(a: ProviderAdapter): void {
  registry.set(a.name, a)
}

export function getAdapter(name: string): ProviderAdapter {
  const a = registry.get(name)
  if (!a) throw new Error(`Proveedor desconocido: ${name}`)
  return a
}

/** Stub deliberado: demuestra que la interfaz basta para un segundo proveedor. */
export const retellAdapter: ProviderAdapter = {
  name: 'retell',
  verifySignature: () => Promise.resolve(false),
  parseWebhook: () => { throw new Error('Adaptador de Retell no implementado') },
  buildExtractionSchema: () => { throw new Error('Adaptador de Retell no implementado') },
}

registerAdapter(retellAdapter)
```

- [ ] **Step 5: Registrar el adaptador de Vapi desde su módulo**

Añadir al final de `adapter.ts`:

```ts
// Import con efecto secundario: registra el adaptador de Vapi.
import './vapi/index.ts'
```

> Se importa al final para evitar un ciclo: `vapi/index.ts` importa `registerAdapter` de este archivo.

- [ ] **Step 6: Ejecutar la prueba**

Run: `npx vitest run tests/ingest/contract.test.ts`
Expected: PASS, 3 pruebas.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared tests/ingest
git commit -m "feat(ingest): tipos canónicos y contrato de adaptador de proveedor"
```

---

### Task 2: Adaptador de Vapi — parseo del reporte de llamada

**Files:**
- Create: `supabase/functions/_shared/providers/vapi/index.ts`
- Create: `tests/ingest/fixtures/vapi-end-of-call.json`
- Test: `tests/ingest/vapi-parse.test.ts`

**Interfaces:**
- Consumes: `ProviderAdapter`, `registerAdapter`, tipos canónicos (Task 1)
- Produces: `vapiAdapter` registrado bajo el nombre `vapi`

- [ ] **Step 1: Crear la fixture**

Crear `tests/ingest/fixtures/vapi-end-of-call.json`. Reproduce la estructura documentada de Vapi:

```json
{
  "message": {
    "type": "end-of-call-report",
    "endedReason": "customer-ended-call",
    "timestamp": 1785000000000,
    "call": {
      "id": "c1a2b3c4-0000-4000-8000-000000000001",
      "assistantId": "asst_magen_intake",
      "type": "inboundPhoneCall",
      "customer": { "number": "+13055550147" },
      "startedAt": "2026-08-02T02:14:05.000Z",
      "endedAt": "2026-08-02T02:17:41.000Z",
      "cost": 0.3412,
      "costBreakdown": {
        "transport": 0.0362,
        "stt": 0.0431,
        "llm": 0.1204,
        "tts": 0.0915,
        "vapi": 0.05,
        "total": 0.3412
      }
    },
    "artifact": {
      "recording": { "stereoUrl": "https://storage.vapi.ai/rec/c1a2b3c4.wav" },
      "transcript": "AI: Gracias por llamar a Magen Insurance...",
      "messages": [
        { "role": "assistant", "message": "Gracias por llamar a Magen Insurance. Soy un asistente automático y esta llamada se graba. ¿En qué le puedo ayudar?", "secondsFromStart": 0.4 },
        { "role": "user", "message": "Hola, quiero cancelar mi póliza de auto.", "secondsFromStart": 7.2 },
        { "role": "assistant", "message": "Entiendo. No puedo procesar la cancelación yo mismo, pero tomo sus datos y alguien del equipo lo llama. ¿Me da su nombre completo?", "secondsFromStart": 11.0 },
        { "role": "user", "message": "Rosa Elena Domínguez.", "secondsFromStart": 18.5 }
      ]
    },
    "analysis": {
      "summary": "Rosa Elena Domínguez, asegurada actual, llamó para cancelar su póliza de auto porque vendió el vehículo. Pidió que la contacten el lunes por la mañana.",
      "structuredData": {
        "caller_name": "Rosa Elena Domínguez",
        "callback_phone": "+13055550147",
        "reason_verbatim": "Quiero cancelar mi póliza de auto porque vendí el carro",
        "reason_category": "cancelación",
        "is_existing_client": true,
        "policy_number": "",
        "urgency": "normal",
        "summary": "Solicita cancelación de póliza de auto por venta del vehículo."
      }
    }
  }
}
```

> **Reemplazar por un payload real** en cuanto entre la primera llamada de pruebas: esta fixture sigue la estructura documentada, pero solo un payload capturado confirma los nombres exactos de los campos de costo, que es donde más varía Vapi entre versiones.

- [ ] **Step 2: Escribir la prueba (debe fallar)**

Crear `tests/ingest/vapi-parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAdapter } from '../../supabase/functions/_shared/providers/adapter'

const payload = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/vapi-end-of-call.json'), 'utf8'),
)
const vapi = getAdapter('vapi')

describe('parseo del reporte de llamada', () => {
  it('identifica el evento y la llamada', () => {
    const p = vapi.parseWebhook(payload)
    expect(p.eventType).toBe('end-of-call-report')
    expect(p.isFinal).toBe(true)
    expect(p.providerCallId).toBe('c1a2b3c4-0000-4000-8000-000000000001')
  })

  it('normaliza la llamada al modelo canónico', () => {
    const { run } = vapi.parseWebhook(payload)
    expect(run!.direction).toBe('inbound')
    expect(run!.callerNumber).toBe('+13055550147')
    expect(run!.status).toBe('completed')
    expect(run!.endedReason).toBe('customer-ended-call')
    expect(run!.recordingUrl).toMatch(/^https:\/\//)
    expect(run!.durationSec).toBe(216)   // 02:17:41 − 02:14:05
  })

  it('convierte los mensajes en turnos ordenados', () => {
    const { run } = vapi.parseWebhook(payload)
    expect(run!.turns).toHaveLength(4)
    expect(run!.turns[0]).toMatchObject({ seq: 1, speaker: 'agent' })
    expect(run!.turns[1]).toMatchObject({ seq: 2, speaker: 'caller' })
    expect(run!.turns[1].text).toContain('cancelar mi póliza')
    expect(run!.turns[1].offsetMs).toBe(7200)
  })

  it('aplana los datos extraídos a texto', () => {
    const { run } = vapi.parseWebhook(payload)
    // Todo llega como texto porque extracted_values guarda value_text: el tipo
    // real lo declara field_defs, no el proveedor.
    expect(run!.extracted.caller_name).toBe('Rosa Elena Domínguez')
    expect(run!.extracted.is_existing_client).toBe('true')
    expect(run!.extracted.policy_number).toBe('')
  })

  it('marca no_answer cuando nadie contestó', () => {
    const sin = structuredClone(payload)
    sin.message.endedReason = 'customer-did-not-answer'
    const { run } = vapi.parseWebhook(sin)
    expect(run!.status).toBe('no_answer')
  })

  it('marca failed ante un error del proveedor', () => {
    const err = structuredClone(payload)
    err.message.endedReason = 'pipeline-error-openai-llm-failed'
    const { run } = vapi.parseWebhook(err)
    expect(run!.status).toBe('failed')
  })

  it('no reventa si falta el bloque de análisis', () => {
    const parcial = structuredClone(payload)
    delete parcial.message.analysis
    const { run, events } = vapi.parseWebhook(parcial)
    expect(run!.extracted).toEqual({})
    expect(run!.summary).toBeNull()
    // Debe avisar, no fallar en silencio: sin esto una extracción vacía parece normal.
    expect(events.some(e => e.level === 'warn')).toBe(true)
  })

  it('trata status-update como evento no final', () => {
    const p = vapi.parseWebhook({
      message: { type: 'status-update', status: 'in-progress', call: { id: 'c9' } },
    })
    expect(p.isFinal).toBe(false)
    expect(p.eventType).toBe('status-update')
    expect(p.providerCallId).toBe('c9')
  })
})
```

- [ ] **Step 3: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ingest/vapi-parse.test.ts`
Expected: FAIL — `Proveedor desconocido: vapi`.

- [ ] **Step 4: Implementar el parseo**

Crear `supabase/functions/_shared/providers/vapi/index.ts`:

```ts
import { registerAdapter, type ProviderAdapter } from '../adapter.ts'
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

export const vapiAdapter: ProviderAdapter = {
  name: 'vapi',

  async verifySignature(): Promise<boolean> {
    // Implementado en la Task 4.
    return false
  },

  parseWebhook(payload: unknown): ParsedWebhook {
    const msg = (payload as { message?: Record<string, unknown> })?.message
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

    return {
      providerCallId,
      eventType,
      isFinal: true,
      run,
      usage: extractUsage(msg, providerCallId),
      events,
    }
  },

  buildExtractionSchema(fields: FieldDef[]): unknown {
    // Implementado en la Task 3.
    void fields
    throw new Error('buildExtractionSchema pendiente')
  },
}

/** Implementado en la Task 3; declarado aquí para no romper el parseo. */
function extractUsage(_msg: Record<string, unknown>, _callId: string | null): CanonicalUsage[] {
  return []
}

registerAdapter(vapiAdapter)
```

- [ ] **Step 5: Ejecutar las pruebas**

Run: `npx vitest run tests/ingest/`
Expected: PASS, 11 pruebas (3 de contrato + 8 de parseo).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/providers/vapi tests/ingest
git commit -m "feat(ingest): adaptador de Vapi para el reporte de fin de llamada"
```

---

### Task 3: Consumo, costo y esquema de extracción

Cierra el punto 2 de Luis en el lado del proveedor y elimina la necesidad de un extractor propio.

**Files:**
- Modify: `supabase/functions/_shared/providers/vapi/index.ts`
- Test: `tests/ingest/vapi-usage.test.ts`

**Interfaces:**
- Consumes: `vapiAdapter`, `CanonicalUsage`, `FieldDef`
- Produces: `vapiAdapter.parseWebhook(...).usage` poblado; `vapiAdapter.buildExtractionSchema(fields)`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ingest/vapi-usage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAdapter } from '../../supabase/functions/_shared/providers/adapter'
import type { FieldDef } from '../../supabase/functions/_shared/types'

const payload = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/vapi-end-of-call.json'), 'utf8'),
)
const vapi = getAdapter('vapi')

describe('consumo y costo', () => {
  it('desglosa el costo por componente', () => {
    const { usage } = vapi.parseWebhook(payload)
    const byComponent = Object.fromEntries(usage.map(u => [u.component, u]))

    expect(byComponent.telephony.costUsd).toBeCloseTo(0.0362, 6)
    expect(byComponent.stt.costUsd).toBeCloseTo(0.0431, 6)
    expect(byComponent.llm.costUsd).toBeCloseTo(0.1204, 6)
    expect(byComponent.tts.costUsd).toBeCloseTo(0.0915, 6)
    // La comisión de la plataforma no encaja en ningún componente técnico.
    expect(byComponent.other.costUsd).toBeCloseTo(0.05, 6)
  })

  it('suma exactamente el costo total reportado', () => {
    const { usage } = vapi.parseWebhook(payload)
    const total = usage.reduce((s, u) => s + (u.costUsd ?? 0), 0)
    expect(total).toBeCloseTo(payload.message.call.cost, 6)
  })

  it('da a cada cargo un identificador estable para idempotencia', () => {
    const a = vapi.parseWebhook(payload).usage
    const b = vapi.parseWebhook(payload).usage
    expect(a.map(u => u.sourceEventId)).toEqual(b.map(u => u.sourceEventId))
    expect(new Set(a.map(u => u.sourceEventId)).size).toBe(a.length)
    expect(a[0].sourceEventId).toContain(payload.message.call.id)
  })

  it('imputa los minutos de telefonía a partir de la duración', () => {
    const { usage } = vapi.parseWebhook(payload)
    const tel = usage.find(u => u.component === 'telephony')!
    expect(tel.unit).toBe('minutes')
    expect(tel.quantity).toBeCloseTo(216 / 60, 3)
  })

  it('acepta el desglose como arreglo además de como objeto', () => {
    const arr = structuredClone(payload)
    arr.message.call.costBreakdown = [
      { type: 'transport', cost: 0.02 },
      { type: 'model', cost: 0.08 },
    ]
    const { usage } = vapi.parseWebhook(arr)
    const map = Object.fromEntries(usage.map(u => [u.component, u.costUsd]))
    expect(map.telephony).toBeCloseTo(0.02, 6)
    expect(map.llm).toBeCloseTo(0.08, 6)
  })

  it('registra el costo total sin desglose cuando no viene', () => {
    const sin = structuredClone(payload)
    delete sin.message.call.costBreakdown
    const { usage, events } = vapi.parseWebhook(sin)
    expect(usage).toHaveLength(1)
    expect(usage[0].component).toBe('other')
    expect(usage[0].costUsd).toBeCloseTo(0.3412, 6)
    expect(events.some(e => e.type === 'usage.breakdown_missing')).toBe(true)
  })
})

describe('esquema de extracción', () => {
  const fields: FieldDef[] = [
    { key: 'caller_name', label: 'Nombre', type: 'text', required: true, description: 'Nombre completo', options: null },
    { key: 'is_existing_client', label: 'Cliente', type: 'boolean', required: true, description: null, options: null },
    { key: 'reason_category', label: 'Categoría', type: 'select', required: true, description: 'Motivo', options: ['cancelación', 'pago'] },
    { key: 'policy_number', label: 'Póliza', type: 'text', required: false, description: null, options: null },
  ]

  it('traduce field_defs a JSON Schema', () => {
    const schema = vapi.buildExtractionSchema(fields) as any
    expect(schema.type).toBe('object')
    expect(schema.properties.caller_name).toMatchObject({ type: 'string', description: 'Nombre completo' })
    expect(schema.properties.is_existing_client.type).toBe('boolean')
  })

  it('convierte las opciones de un select en enum', () => {
    const schema = vapi.buildExtractionSchema(fields) as any
    expect(schema.properties.reason_category.enum).toEqual(['cancelación', 'pago'])
  })

  it('lista como requeridos solo los campos obligatorios', () => {
    const schema = vapi.buildExtractionSchema(fields) as any
    expect(schema.required).toEqual(['caller_name', 'is_existing_client', 'reason_category'])
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ingest/vapi-usage.test.ts`
Expected: FAIL — `usage` vacío y `buildExtractionSchema` lanza.

- [ ] **Step 3: Implementar consumo y esquema**

En `supabase/functions/_shared/providers/vapi/index.ts`, reemplazar el `extractUsage` provisional y el `buildExtractionSchema`:

```ts
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
```

Y reemplazar `buildExtractionSchema` en `vapiAdapter`:

```ts
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
```

Añadir el aviso cuando no hay desglose, dentro de `parseWebhook` justo antes del `return`:

```ts
    const usage = extractUsage(msg, providerCallId)
    if (usage.length === 1 && usage[0].sourceEventId.endsWith(':total')) {
      events.push({
        type: 'usage.breakdown_missing',
        level: 'warn',
        message: 'Vapi no envió desglose de costo: se registra solo el total',
      })
    }
```

y usar esa variable `usage` en el objeto devuelto.

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npx vitest run tests/ingest/`
Expected: PASS, 20 pruebas.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/providers/vapi tests/ingest
git commit -m "feat(ingest): desglose de costo por componente y esquema de extracción"
```

---

### Task 4: Verificación de firma

**Files:**
- Modify: `supabase/functions/_shared/providers/vapi/index.ts`
- Test: `tests/ingest/vapi-signature.test.ts`

**Interfaces:**
- Consumes: `vapiAdapter`
- Produces: `vapiAdapter.verifySignature(headers, rawBody, secret)` funcional

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ingest/vapi-signature.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getAdapter } from '../../supabase/functions/_shared/providers/adapter'

const vapi = getAdapter('vapi')
const SECRET = 'secreto-de-pruebas'
const BODY = '{"message":{"type":"status-update"}}'

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

describe('verificación de firma', () => {
  it('acepta el secreto compartido en X-Vapi-Secret', async () => {
    const h = new Headers({ 'x-vapi-secret': SECRET })
    expect(await vapi.verifySignature(h, BODY, SECRET)).toBe(true)
  })

  it('rechaza un secreto incorrecto', async () => {
    const h = new Headers({ 'x-vapi-secret': 'otro' })
    expect(await vapi.verifySignature(h, BODY, SECRET)).toBe(false)
  })

  it('acepta una firma HMAC válida', async () => {
    const h = new Headers({ 'x-vapi-signature': await hmacHex(SECRET, BODY) })
    expect(await vapi.verifySignature(h, BODY, SECRET)).toBe(true)
  })

  it('rechaza una firma HMAC sobre otro cuerpo', async () => {
    const h = new Headers({ 'x-vapi-signature': await hmacHex(SECRET, '{"otro":1}') })
    expect(await vapi.verifySignature(h, BODY, SECRET)).toBe(false)
  })

  it('rechaza cuando no viene ninguna credencial', async () => {
    expect(await vapi.verifySignature(new Headers(), BODY, SECRET)).toBe(false)
  })

  it('devuelve false en vez de lanzar ante una firma malformada', async () => {
    const h = new Headers({ 'x-vapi-signature': 'no-es-hex' })
    await expect(vapi.verifySignature(h, BODY, SECRET)).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ingest/vapi-signature.test.ts`
Expected: FAIL — devuelve `false` siempre.

- [ ] **Step 3: Implementar la verificación**

Reemplazar `verifySignature` en `vapiAdapter`:

```ts
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
```

Y añadir la comparación de tiempo constante al final del archivo:

```ts
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
```

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npx vitest run tests/ingest/`
Expected: PASS, 26 pruebas.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/providers/vapi tests/ingest
git commit -m "feat(ingest): verificación de firma por secreto compartido y HMAC"
```

---

### Task 5: Proyección del crudo a las tablas canónicas

El corazón del plan: convierte un `ParsedWebhook` en filas, de forma idempotente.

**Files:**
- Create: `supabase/functions/_shared/projection.ts`
- Test: `tests/ingest/projection.test.ts`

**Interfaces:**
- Consumes: tipos canónicos, `serviceClient` del arnés de pruebas
- Produces: `projectWebhook(db, { provider, rawBody, parsed }): Promise<ProjectionResult>` con `ProjectionResult = { runId: string | null, skipped: boolean, reason?: string }`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ingest/projection.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serviceClient, resetData } from '../db/client'
import { getAdapter } from '../../supabase/functions/_shared/providers/adapter'
import { projectWebhook } from '../../supabase/functions/_shared/projection'

const raw = readFileSync(resolve(__dirname, 'fixtures/vapi-end-of-call.json'), 'utf8')
const payload = JSON.parse(raw)
const vapi = getAdapter('vapi')

async function seedAgent() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
    provider_agent_id: 'asst_magen_intake', system_prompt: 'Contestas para Magen.',
  }).select().single()
  return { clientId: c!.id as string, agentId: a!.id as string }
}

describe('proyección', () => {
  beforeEach(resetData)

  it('crea el run con sus turnos, valores y consumo', async () => {
    const { clientId, agentId } = await seedAgent()
    const svc = serviceClient()

    const res = await projectWebhook(svc, {
      provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload),
    })
    expect(res.skipped).toBe(false)

    const { data: run } = await svc.from('runs').select().eq('id', res.runId!).single()
    expect(run!.client_id).toBe(clientId)
    expect(run!.agent_id).toBe(agentId)
    expect(run!.status).toBe('completed')
    expect(run!.duration_sec).toBe(216)
    expect(run!.reason_category).toBe('cancelación')
    expect(run!.extraction_status).toBe('complete')

    const { data: turns } = await svc.from('transcript_turns')
      .select().eq('run_id', res.runId!).order('seq')
    expect(turns).toHaveLength(4)
    expect(turns![0].speaker).toBe('agent')

    const { data: values } = await svc.from('extracted_values').select().eq('run_id', res.runId!)
    expect(values!.find(v => v.field_key === 'caller_name')!.value_text)
      .toBe('Rosa Elena Domínguez')

    const { data: usage } = await svc.from('usage_events').select().eq('run_id', res.runId!)
    expect(usage!.length).toBeGreaterThanOrEqual(4)
    const total = usage!.reduce((s, u) => s + Number(u.cost_usd), 0)
    expect(total).toBeCloseTo(0.3412, 4)
  })

  it('guarda el crudo antes de proyectar', async () => {
    await seedAgent()
    const svc = serviceClient()
    await projectWebhook(svc, { provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload) })

    const { data } = await svc.from('run_raw_events').select()
    expect(data).toHaveLength(1)
    expect(data![0].processed_at).not.toBeNull()
    expect(data![0].payload.message.type).toBe('end-of-call-report')
  })

  // La garantía que impide cobrar dos veces la misma llamada.
  it('es idempotente ante un reintento del proveedor', async () => {
    await seedAgent()
    const svc = serviceClient()
    const args = { provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload) }

    const first = await projectWebhook(svc, args)
    const second = await projectWebhook(svc, args)

    expect(second.skipped).toBe(true)
    expect(second.runId).toBe(first.runId)

    const { data: runs } = await svc.from('runs').select('id')
    const { data: usage } = await svc.from('usage_events').select('id')
    const { data: turns } = await svc.from('transcript_turns').select('id')
    expect(runs).toHaveLength(1)
    expect(turns).toHaveLength(4)
    // Lo esencial: un solo cargo por componente aunque el webhook llegue dos veces.
    expect(usage!.length).toBeLessThanOrEqual(5)
  })

  it('marca la extracción como parcial si falta un campo requerido', async () => {
    const { agentId } = await seedAgent()
    const svc = serviceClient()
    await svc.from('field_defs').insert([
      { agent_id: agentId, key: 'caller_name', label: 'Nombre', type: 'text', required: true },
      { agent_id: agentId, key: 'vin', label: 'VIN', type: 'text', required: true },
    ])

    const res = await projectWebhook(svc, {
      provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload),
    })

    const { data: run } = await svc.from('runs').select('extraction_status').eq('id', res.runId!).single()
    expect(run!.extraction_status).toBe('partial')
  })

  it('registra el evento en vez de crear un run si el agente es desconocido', async () => {
    const svc = serviceClient()   // sin sembrar agente
    const res = await projectWebhook(svc, {
      provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload),
    })

    expect(res.skipped).toBe(true)
    expect(res.reason).toMatch(/agente/i)

    const { data: raws } = await svc.from('run_raw_events').select()
    expect(raws).toHaveLength(1)                    // el crudo nunca se pierde
    expect(raws![0].processing_error).toMatch(/agente/i)

    const { data: events } = await svc.from('events').select().eq('level', 'error')
    expect(events!.length).toBeGreaterThan(0)
  })

  it('ignora los eventos no finales sin crear un run', async () => {
    await seedAgent()
    const svc = serviceClient()
    const parsed = vapi.parseWebhook({
      message: { type: 'status-update', status: 'in-progress', call: { id: 'c9' } },
    })

    const res = await projectWebhook(svc, { provider: 'vapi', rawBody: '{}', parsed })

    expect(res.skipped).toBe(true)
    const { data: runs } = await svc.from('runs').select('id')
    expect(runs).toEqual([])
    const { data: raws } = await svc.from('run_raw_events').select()
    expect(raws).toHaveLength(1)   // pero el crudo sí queda registrado
  })

  it('escribe un evento de proyección con su latencia', async () => {
    await seedAgent()
    const svc = serviceClient()
    await projectWebhook(svc, { provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload) })

    const { data } = await svc.from('events').select().eq('type', 'run.projected')
    expect(data).toHaveLength(1)
    expect(data![0].latency_ms).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ingest/projection.test.ts`
Expected: FAIL — `projection.ts` no existe.

- [ ] **Step 3: Implementar la proyección**

Crear `supabase/functions/_shared/projection.ts`:

```ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
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

async function logEvent(
  db: SupabaseClient,
  e: CanonicalEvent & { clientId?: string | null; agentId?: string | null; runId?: string | null; latencyMs?: number },
): Promise<void> {
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

  // 1. Crudo. El constraint decide si es la primera vez que llega.
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
  const fail = async (reason: string, extra?: Record<string, unknown>) => {
    await db.from('run_raw_events')
      .update({ processing_error: reason, processed_at: new Date().toISOString() })
      .eq('id', rawId)
    await logEvent(db, { type: 'projection.failed', level: 'error', message: reason, payload: extra })
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
  // parcial puede haberlos escrito ya.
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
    .map(f => f.key)
    .filter(k => !run.extracted[k] || run.extracted[k].trim() === '')

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
```

- [ ] **Step 4: Ejecutar las pruebas**

```bash
npx supabase db reset
npx vitest run tests/ingest/projection.test.ts
```

Expected: PASS, 7 pruebas.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/projection.ts tests/ingest/projection.test.ts
git commit -m "feat(ingest): proyección idempotente del crudo a las tablas canónicas"
```

---

### Task 6: Edge Function del webhook

**Files:**
- Create: `supabase/functions/provider-webhook/index.ts`
- Create: `supabase/functions/deno.json`
- Modify: `.env.example`
- Test: `tests/ingest/webhook.test.ts`

**Interfaces:**
- Consumes: `getAdapter`, `projectWebhook`
- Produces: endpoint `POST /functions/v1/provider-webhook/{provider}`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ingest/webhook.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serviceClient, resetData } from '../db/client'
import { supabaseEnv } from '../db/env'

const raw = readFileSync(resolve(__dirname, 'fixtures/vapi-end-of-call.json'), 'utf8')
const SECRET = 'secreto-de-pruebas'

function url(provider = 'vapi') {
  return `${supabaseEnv().url}/functions/v1/provider-webhook/${provider}`
}

async function post(body: string, headers: Record<string, string>) {
  return fetch(url(), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
}

async function seedAgent() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
    provider_agent_id: 'asst_magen_intake',
  })
}

// Requiere `npx supabase functions serve` corriendo en otra terminal.
describe('webhook del proveedor', () => {
  beforeEach(resetData)

  it('rechaza una petición sin credencial', async () => {
    const res = await post(raw, {})
    expect(res.status).toBe(401)
  })

  it('rechaza un proveedor desconocido', async () => {
    const res = await fetch(url('paloma'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vapi-secret': SECRET },
      body: raw,
    })
    expect(res.status).toBe(404)
  })

  it('acepta y proyecta un reporte válido', async () => {
    await seedAgent()
    const res = await post(raw, { 'x-vapi-secret': SECRET })
    expect(res.status).toBe(200)

    const { data } = await serviceClient().from('runs').select('id, status')
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('completed')
  })

  // Vapi reintenta ante cualquier respuesta que no sea 2xx: devolver 500 por un
  // payload que nunca va a funcionar provoca reintentos infinitos.
  it('responde 200 ante un payload que no puede proyectar', async () => {
    const res = await post(raw, { 'x-vapi-secret': SECRET })   // sin agente sembrado
    expect(res.status).toBe(200)

    const { data } = await serviceClient().from('run_raw_events').select('processing_error')
    expect(data![0].processing_error).toMatch(/agente/i)
  })

  it('responde 400 ante un cuerpo que no es JSON', async () => {
    const res = await post('esto no es json', { 'x-vapi-secret': SECRET })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

```bash
npx supabase functions serve --env-file supabase/functions/.env.local &
npx vitest run tests/ingest/webhook.test.ts
```

Expected: FAIL — la función no existe (404 en todas).

- [ ] **Step 3: Escribir la Edge Function**

Crear `supabase/functions/deno.json`:

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

Crear `supabase/functions/provider-webhook/index.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { getAdapter } from '../_shared/providers/adapter.ts'
import { projectWebhook } from '../_shared/projection.ts'

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Método no permitido', { status: 405 })
  }

  // La ruta es /provider-webhook/{provider}: un solo endpoint para todos.
  const provider = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? ''

  let adapter
  try {
    adapter = getAdapter(provider)
  } catch {
    return new Response('Proveedor desconocido', { status: 404 })
  }

  // El cuerpo se lee crudo: la firma se calcula sobre estos bytes exactos.
  const rawBody = await req.text()
  const secret = Deno.env.get(`${provider.toUpperCase()}_WEBHOOK_SECRET`) ?? ''

  if (!secret || !(await adapter.verifySignature(req.headers, rawBody, secret))) {
    return new Response('No autorizado', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Cuerpo no es JSON válido', { status: 400 })
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  try {
    const parsed = adapter.parseWebhook(payload)
    const result = await projectWebhook(db, { provider, rawBody, parsed })
    // Siempre 200 si el evento quedó registrado: el proveedor reintenta ante
    // cualquier cosa que no sea 2xx, y un payload que nunca va a proyectar
    // generaría reintentos infinitos. El fallo queda en processing_error.
    return Response.json({ ok: true, ...result })
  } catch (err) {
    // Aquí sí conviene el reintento: es un fallo nuestro, no del payload.
    await db.from('events').insert({
      type: 'webhook.unhandled', level: 'error',
      message: err instanceof Error ? err.message : String(err),
      payload: { provider },
    })
    return new Response('Error procesando el webhook', { status: 500 })
  }
})
```

- [ ] **Step 4: Documentar las variables**

Crear `.env.example`:

```bash
# Secreto compartido configurado en el panel de Vapi para el Server URL.
VAPI_WEBHOOK_SECRET=

# Las inyecta Supabase automáticamente en las Edge Functions desplegadas;
# en local van en supabase/functions/.env.local
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Añadir `supabase/functions/.env.local` a `.gitignore`.

- [ ] **Step 5: Ejecutar las pruebas**

```bash
printf 'VAPI_WEBHOOK_SECRET=secreto-de-pruebas\n' > supabase/functions/.env.local
npx supabase functions serve --env-file supabase/functions/.env.local &
npx vitest run tests/ingest/webhook.test.ts
```

Expected: PASS, 5 pruebas.

- [ ] **Step 6: Verificar la suite completa**

```bash
npx supabase db reset
npm run test:db
npx tsc -b
```

Expected: todo en verde.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions .env.example .gitignore tests/ingest
git commit -m "feat(ingest): Edge Function del webhook con verificación y proyección"
```

---

## Verificación final

```bash
npx supabase db reset && npm run test:db && npx tsc -b
```

- Un webhook de Vapi produce run, turnos, valores, consumo y eventos
- Reenviar el mismo webhook no duplica nada ni vuelve a cobrar
- Un payload sin agente conocido no se pierde: queda con `processing_error`
- Nada fuera de `providers/vapi/` conoce la forma de Vapi

## Lo que queda para el Plan 3

Sincronizar el agente con Vapi (crear el assistant con el prompt y el esquema
generado por `buildExtractionSchema`), aprovisionar el número, y el ejecutor de
acciones que manda el correo. Este plan deja la ingesta lista para recibirlas.
