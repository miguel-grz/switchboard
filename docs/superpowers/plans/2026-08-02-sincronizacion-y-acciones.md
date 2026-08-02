# Sincronización de agentes y ejecución de acciones (Plan 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un agente configurado en la base se publique en el proveedor con su prompt y su esquema, y que al terminar una llamada se ejecuten las acciones configuradas — hoy, el correo.

**Architecture:** Las dependencias externas (HTTP hacia el proveedor, envío de correo) entran **inyectadas**. Así todo se construye y prueba hoy contra dobles, y conectar las cuentas reales de Vapi y Resend es cambiar una variable de entorno. Cada sincronización congela una `agent_revision`, de modo que siempre se sabe con qué configuración corrió cada llamada.

**Tech Stack:** Supabase Edge Functions (Deno) · TypeScript · Vitest

## Global Constraints

- **Nada fuera de `providers/vapi/` conoce la forma de Vapi.** La sincronización llama al adaptador; no arma payloads del proveedor por su cuenta.
- **Toda dependencia externa se inyecta.** Ninguna función de dominio llama a `fetch` global ni lee `Deno.env` directamente: los recibe como parámetro. Es lo que hace posible probarlas.
- **Toda ejecución de acción deja fila en `action_runs`**, haya salido bien o mal, con su `attempt`.
- **Una acción que falla nunca revienta la ingesta.** Se registra el error y se sigue con las demás.
- Identificadores en inglés; comentarios y documentación en español.
- Ningún secreto en el repo. Las llaves van en `.env.example` documentadas y vacías.

---

### Task 1: Construcción del assistant y sincronización

**Files:**
- Modify: `supabase/functions/_shared/providers/adapter.ts`
- Modify: `supabase/functions/_shared/providers/vapi/index.ts`
- Create: `supabase/functions/_shared/sync.ts`
- Test: `tests/ingest/sync.test.ts`

**Interfaces:**
- Consumes: `getAdapter`, tablas `agents` y `field_defs`
- Produces: `ProviderAdapter.buildAssistantConfig(input)`, `syncAgent(db, agentId, deps)` con `deps = { http: FetchLike, apiKey: string }`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ingest/sync.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from '../db/client'
import { getAdapter } from '../../supabase/functions/_shared/providers/index'
import { syncAgent } from '../../supabase/functions/_shared/sync'

async function seedAgent(providerAgentId: string | null = null) {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake general',
    provider: 'vapi', provider_agent_id: providerAgentId,
    system_prompt: 'Contestas para Magen fuera de horario.',
  }).select().single()
  await svc.from('field_defs').insert([
    { agent_id: a!.id, key: 'caller_name', label: 'Nombre', type: 'text', required: true, sort_order: 0 },
    { agent_id: a!.id, key: 'urgency', label: 'Urgencia', type: 'select', required: true, sort_order: 1, options: ['normal', 'urgente'] },
  ])
  return { clientId: c!.id as string, agentId: a!.id as string }
}

/** Doble del HTTP del proveedor: registra las llamadas y devuelve lo pactado. */
function fakeHttp(response: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const http = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(response), {
      status, headers: { 'content-type': 'application/json' },
    })
  }
  return { http, calls }
}

describe('construcción del assistant', () => {
  it('incluye el prompt y el esquema derivado de los campos', () => {
    const vapi = getAdapter('vapi')
    const cfg = vapi.buildAssistantConfig({
      name: 'Intake general',
      systemPrompt: 'Contestas para Magen.',
      fields: [
        { key: 'caller_name', label: 'Nombre', type: 'text', required: true, description: 'Nombre completo', options: null },
        { key: 'urgency', label: 'Urgencia', type: 'select', required: true, description: null, options: ['normal', 'urgente'] },
      ],
    }) as any

    expect(cfg.name).toBe('Intake general')
    expect(cfg.model.messages[0].role).toBe('system')
    expect(cfg.model.messages[0].content).toContain('Contestas para Magen.')

    const schema = cfg.analysisPlan.structuredDataPlan.schema
    expect(schema.properties.caller_name.type).toBe('string')
    expect(schema.properties.urgency.enum).toEqual(['normal', 'urgente'])
    expect(schema.required).toEqual(['caller_name', 'urgency'])
    // Sin esto Vapi no genera structuredData y la extracción llega vacía.
    expect(cfg.analysisPlan.structuredDataPlan.enabled).toBe(true)
  })
})

describe('sincronización', () => {
  beforeEach(resetData)

  it('crea el assistant y guarda su id cuando el agente es nuevo', async () => {
    const { agentId } = await seedAgent(null)
    const svc = serviceClient()
    const { http, calls } = fakeHttp({ id: 'asst_creado_123' })

    const res = await syncAgent(svc, agentId, { http, apiKey: 'llave' })

    expect(res.providerAgentId).toBe('asst_creado_123')
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].url).toMatch(/\/assistant$/)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer llave')

    const { data } = await svc.from('agents').select('provider_agent_id').eq('id', agentId).single()
    expect(data!.provider_agent_id).toBe('asst_creado_123')
  })

  it('actualiza en vez de crear cuando el agente ya está publicado', async () => {
    const { agentId } = await seedAgent('asst_existente')
    const { http, calls } = fakeHttp({ id: 'asst_existente' })

    await syncAgent(serviceClient(), agentId, { http, apiKey: 'llave' })

    expect(calls[0].init.method).toBe('PATCH')
    expect(calls[0].url).toMatch(/\/assistant\/asst_existente$/)
  })

  it('congela una revisión con el prompt y los campos de ese momento', async () => {
    const { agentId } = await seedAgent(null)
    const svc = serviceClient()
    const { http } = fakeHttp({ id: 'asst_1' })

    await syncAgent(svc, agentId, { http, apiKey: 'llave' })

    const { data } = await svc.from('agent_revisions').select().eq('agent_id', agentId)
    expect(data).toHaveLength(1)
    expect(data![0].version).toBe(1)
    expect(data![0].system_prompt).toContain('Contestas para Magen')
    expect(data![0].fields).toHaveLength(2)
  })

  it('numera las revisiones de forma incremental', async () => {
    const { agentId } = await seedAgent(null)
    const svc = serviceClient()
    const { http } = fakeHttp({ id: 'asst_1' })

    await syncAgent(svc, agentId, { http, apiKey: 'llave' })
    await svc.from('agents').update({ system_prompt: 'Prompt nuevo' }).eq('id', agentId)
    await syncAgent(svc, agentId, { http, apiKey: 'llave' })

    const { data } = await svc.from('agent_revisions')
      .select('version, system_prompt').eq('agent_id', agentId).order('version')
    expect(data!.map(r => r.version)).toEqual([1, 2])
    expect(data![1].system_prompt).toBe('Prompt nuevo')
  })

  it('no crea revisión ni guarda id si el proveedor rechaza', async () => {
    const { agentId } = await seedAgent(null)
    const svc = serviceClient()
    const { http } = fakeHttp({ message: 'clave inválida' }, 401)

    await expect(syncAgent(svc, agentId, { http, apiKey: 'mala' })).rejects.toThrow(/401/)

    const { data: revs } = await svc.from('agent_revisions').select()
    expect(revs).toEqual([])
    const { data: agent } = await svc.from('agents').select('provider_agent_id').eq('id', agentId).single()
    expect(agent!.provider_agent_id).toBeNull()

    const { data: events } = await svc.from('events').select().eq('type', 'agent.sync_failed')
    expect(events!.length).toBe(1)
  })

  it('registra el evento de sincronización exitosa', async () => {
    const { agentId } = await seedAgent(null)
    const svc = serviceClient()
    const { http } = fakeHttp({ id: 'asst_1' })

    await syncAgent(svc, agentId, { http, apiKey: 'llave' })

    const { data } = await svc.from('events').select().eq('type', 'agent.synced')
    expect(data).toHaveLength(1)
    expect(data![0].agent_id).toBe(agentId)
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ingest/sync.test.ts`
Expected: FAIL — `sync.ts` no existe y `buildAssistantConfig` no está en el contrato.

- [ ] **Step 3: Ampliar el contrato del adaptador**

En `supabase/functions/_shared/providers/adapter.ts`, añadir al `ProviderAdapter`:

```ts
  /** Arma la configuración del assistant tal como la espera el proveedor. */
  buildAssistantConfig(input: AssistantInput): unknown
```

y arriba, la entrada neutra:

```ts
import type { ParsedWebhook, FieldDef } from '../types.ts'

export interface AssistantInput {
  name: string
  systemPrompt: string
  fields: FieldDef[]
}
```

Añadir el método a `retellAdapter` en `providers/retell.ts`:

```ts
  buildAssistantConfig: () => { throw new Error('Adaptador de Retell no implementado') },
```

- [ ] **Step 4: Implementar en el adaptador de Vapi**

En `supabase/functions/_shared/providers/vapi/index.ts`, añadir al objeto `vapiAdapter`:

```ts
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
```

y su import de tipo:

```ts
import { registerAdapter, type ProviderAdapter, type AssistantInput } from '../adapter.ts'
```

- [ ] **Step 5: Implementar la sincronización**

Crear `supabase/functions/_shared/sync.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdapter } from './providers/index.ts'
import type { FieldDef } from './types.ts'

/** Firma mínima de fetch. Se inyecta para poder probar sin red. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface SyncDeps {
  http: FetchLike
  apiKey: string
  baseUrl?: string
}

export interface SyncResult {
  providerAgentId: string
  version: number
}

const DEFAULT_BASE_URL = 'https://api.vapi.ai'

/**
 * Publica la configuración del agente en el proveedor y congela una revisión.
 *
 * La revisión se escribe **después** de que el proveedor confirma: si se
 * escribiera antes, un fallo dejaría un histórico que afirma una configuración
 * que nunca llegó a estar vigente.
 */
export async function syncAgent(
  db: SupabaseClient,
  agentId: string,
  deps: SyncDeps,
): Promise<SyncResult> {
  const { data: agent, error } = await db.from('agents')
    .select('id, client_id, name, provider, provider_agent_id, system_prompt')
    .eq('id', agentId).single()
  if (error || !agent) throw new Error(`Agente no encontrado: ${agentId}`)

  const { data: rows } = await db.from('field_defs')
    .select('key, label, type, required, description, options')
    .eq('agent_id', agentId).is('intent_id', null).order('sort_order')

  const fields = (rows ?? []) as FieldDef[]
  const adapter = getAdapter(agent.provider)
  const config = adapter.buildAssistantConfig({
    name: agent.name,
    systemPrompt: agent.system_prompt,
    fields,
  })

  const base = deps.baseUrl ?? DEFAULT_BASE_URL
  const isUpdate = Boolean(agent.provider_agent_id)
  const url = isUpdate ? `${base}/assistant/${agent.provider_agent_id}` : `${base}/assistant`

  const res = await deps.http(url, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(config),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const message = `El proveedor rechazó la sincronización (${res.status}): ${detail.slice(0, 200)}`
    await db.from('events').insert({
      client_id: agent.client_id, agent_id: agentId,
      type: 'agent.sync_failed', level: 'error', message,
    })
    throw new Error(message)
  }

  const body = await res.json() as { id?: string }
  const providerAgentId = body.id ?? agent.provider_agent_id
  if (!providerAgentId) throw new Error('El proveedor no devolvió un identificador de assistant')

  const { data: last } = await db.from('agent_revisions')
    .select('version').eq('agent_id', agentId)
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const version = (last?.version ?? 0) + 1

  await db.from('agent_revisions').insert({
    agent_id: agentId,
    version,
    system_prompt: agent.system_prompt,
    fields,
    provider: agent.provider,
    provider_agent_id: providerAgentId,
  })

  await db.from('agents')
    .update({ provider_agent_id: providerAgentId, updated_at: new Date().toISOString() })
    .eq('id', agentId)

  await db.from('events').insert({
    client_id: agent.client_id, agent_id: agentId,
    type: 'agent.synced', level: 'info',
    message: `Agente publicado como revisión ${version}`,
    payload: { providerAgentId, fields: fields.length },
  })

  return { providerAgentId, version }
}
```

- [ ] **Step 6: Ejecutar las pruebas**

```bash
npx supabase db reset
npx vitest run tests/ingest/sync.test.ts
```

Expected: PASS, 7 pruebas.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared tests/ingest/sync.test.ts
git commit -m "feat(sync): publicación del agente en el proveedor con revisión congelada"
```

---

### Task 2: Resolución de acciones y condiciones

**Files:**
- Create: `supabase/functions/_shared/actions.ts`
- Test: `tests/ingest/actions-resolve.test.ts`

**Interfaces:**
- Consumes: tablas `agent_actions`, `runs`, `extracted_values`
- Produces: `matchesCondition(condition, context)`, `buildRunContext(db, runId)` → `RunContext`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ingest/actions-resolve.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from '../db/client'
import { matchesCondition, buildRunContext } from '../../supabase/functions/_shared/actions'

async function seedRun(extracted: Record<string, string>) {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen Insurance Inc', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
  }).select().single()
  const { data: r } = await svc.from('runs').insert({
    client_id: c!.id, agent_id: a!.id, provider: 'vapi', provider_call_id: 'call_ctx',
    started_at: '2026-08-02T02:14:05.000Z', ended_at: '2026-08-02T02:17:41.000Z',
    duration_sec: 216, status: 'completed', caller_number: '+13055550147',
    summary: 'Solicita cancelación.',
  }).select().single()
  await svc.from('extracted_values').insert(
    Object.entries(extracted).map(([k, v]) => ({
      run_id: r!.id, field_key: k, value_text: v, extraction_version: 1,
    })),
  )
  return { clientId: c!.id as string, agentId: a!.id as string, runId: r!.id as string }
}

describe('condiciones de acción', () => {
  const ctx = { urgency: 'urgente', reason_category: 'siniestro' }

  it('sin condición se dispara siempre', () => {
    expect(matchesCondition(null, ctx)).toBe(true)
  })

  it('coincide cuando todos los pares casan', () => {
    expect(matchesCondition({ urgency: 'urgente' }, ctx)).toBe(true)
    expect(matchesCondition({ urgency: 'urgente', reason_category: 'siniestro' }, ctx)).toBe(true)
  })

  it('no coincide si algún par difiere', () => {
    expect(matchesCondition({ urgency: 'normal' }, ctx)).toBe(false)
    expect(matchesCondition({ urgency: 'urgente', reason_category: 'pago' }, ctx)).toBe(false)
  })

  it('no coincide si el campo no existe', () => {
    expect(matchesCondition({ inexistente: 'x' }, ctx)).toBe(false)
  })

  it('acepta una lista de valores admitidos', () => {
    expect(matchesCondition({ reason_category: ['siniestro', 'cancelación'] }, ctx)).toBe(true)
    expect(matchesCondition({ reason_category: ['pago'] }, ctx)).toBe(false)
  })
})

describe('contexto del run', () => {
  beforeEach(resetData)

  it('reúne cliente, agente, campos y transcripción', async () => {
    const { runId } = await seedRun({ caller_name: 'Rosa', urgency: 'normal' })
    const svc = serviceClient()
    await svc.from('transcript_turns').insert([
      { run_id: runId, seq: 1, speaker: 'agent', text: 'Buenas noches.' },
      { run_id: runId, seq: 2, speaker: 'caller', text: 'Quiero cancelar.' },
    ])

    const ctx = await buildRunContext(svc, runId)

    expect(ctx.clientName).toBe('Magen Insurance Inc')
    expect(ctx.agentName).toBe('Intake')
    expect(ctx.durationSec).toBe(216)
    expect(ctx.callerNumber).toBe('+13055550147')
    expect(ctx.fields.caller_name).toBe('Rosa')
    expect(ctx.turns).toHaveLength(2)
    expect(ctx.turns[0].speaker).toBe('agent')
  })

  it('devuelve null si el run no existe', async () => {
    const ctx = await buildRunContext(serviceClient(), '00000000-0000-4000-8000-000000000000')
    expect(ctx).toBeNull()
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ingest/actions-resolve.test.ts`
Expected: FAIL — `actions.ts` no existe.

- [ ] **Step 3: Implementar**

Crear `supabase/functions/_shared/actions.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RunContext {
  runId: string
  clientId: string
  clientName: string
  clientTimezone: string
  agentId: string
  agentName: string
  startedAt: string
  durationSec: number | null
  status: string
  callerNumber: string | null
  summary: string | null
  recordingUrl: string | null
  fields: Record<string, string>
  turns: { speaker: string; text: string }[]
}

/**
 * Evalúa la condición de una acción contra los datos de la llamada.
 *
 * Es deliberadamente simple: igualdad, o pertenencia si el valor esperado es
 * una lista. Nada de operadores ni expresiones — una condición que hay que
 * depurar deja de ser configuración y se vuelve código escondido en la base.
 */
export function matchesCondition(
  condition: Record<string, unknown> | null | undefined,
  context: Record<string, string>,
): boolean {
  if (!condition || Object.keys(condition).length === 0) return true
  return Object.entries(condition).every(([key, expected]) => {
    const actual = context[key]
    if (actual === undefined) return false
    if (Array.isArray(expected)) return expected.map(String).includes(actual)
    return String(expected) === actual
  })
}

/** Reúne en una sola forma todo lo que una acción puede necesitar del run. */
export async function buildRunContext(
  db: SupabaseClient,
  runId: string,
): Promise<RunContext | null> {
  const { data: run } = await db.from('runs')
    .select(`
      id, client_id, agent_id, started_at, duration_sec, status,
      caller_number, summary, recording_url,
      clients ( name, timezone ),
      agents ( name )
    `)
    .eq('id', runId).maybeSingle()

  if (!run) return null

  const { data: values } = await db.from('extracted_values')
    .select('field_key, value_text, extraction_version')
    .eq('run_id', runId).order('extraction_version', { ascending: true })

  // La versión más alta gana: al reprocesar conviven varias y el correo debe
  // reflejar la extracción vigente, no la primera.
  const fields: Record<string, string> = {}
  for (const v of values ?? []) fields[v.field_key] = v.value_text ?? ''

  const { data: turns } = await db.from('transcript_turns')
    .select('speaker, text').eq('run_id', runId).order('seq')

  const client = run.clients as unknown as { name: string; timezone: string } | null
  const agent = run.agents as unknown as { name: string } | null

  return {
    runId: run.id,
    clientId: run.client_id,
    clientName: client?.name ?? 'Cliente',
    clientTimezone: client?.timezone ?? 'UTC',
    agentId: run.agent_id,
    agentName: agent?.name ?? 'Agente',
    startedAt: run.started_at,
    durationSec: run.duration_sec,
    status: run.status,
    callerNumber: run.caller_number,
    summary: run.summary,
    recordingUrl: run.recording_url,
    fields,
    turns: (turns ?? []) as { speaker: string; text: string }[],
  }
}
```

- [ ] **Step 4: Ejecutar las pruebas**

```bash
npx supabase db reset
npx vitest run tests/ingest/actions-resolve.test.ts
```

Expected: PASS, 7 pruebas.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/actions.ts tests/ingest/actions-resolve.test.ts
git commit -m "feat(actions): contexto del run y evaluación de condiciones"
```

---

### Task 3: Redacción del correo

**Files:**
- Create: `supabase/functions/_shared/email.ts`
- Test: `tests/ingest/email.test.ts`

**Interfaces:**
- Consumes: `RunContext`
- Produces: `renderRunEmail(ctx, labels?)` → `{ subject, html, text }`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ingest/email.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderRunEmail } from '../../supabase/functions/_shared/email'
import type { RunContext } from '../../supabase/functions/_shared/actions'

const ctx: RunContext = {
  runId: 'r1', clientId: 'c1', clientName: 'Magen Insurance Inc',
  clientTimezone: 'America/New_York', agentId: 'a1', agentName: 'Intake general',
  startedAt: '2026-08-02T02:14:05.000Z', durationSec: 216, status: 'completed',
  callerNumber: '+13055550147',
  summary: 'Solicita cancelación de póliza de auto.',
  recordingUrl: 'https://storage.vapi.ai/rec/1.wav',
  fields: {
    caller_name: 'Rosa Elena Domínguez',
    callback_phone: '+13055550147',
    reason_category: 'cancelación',
    urgency: 'normal',
    policy_number: '',
  },
  turns: [
    { speaker: 'agent', text: 'Buenas noches, Magen Insurance.' },
    { speaker: 'caller', text: 'Quiero cancelar mi póliza.' },
  ],
}

describe('correo por llamada', () => {
  it('resume quién llamó y por qué en el asunto', () => {
    const { subject } = renderRunEmail(ctx)
    expect(subject).toContain('Rosa Elena Domínguez')
    expect(subject).toContain('cancelación')
  })

  it('marca el asunto cuando la llamada es urgente', () => {
    const { subject } = renderRunEmail({ ...ctx, fields: { ...ctx.fields, urgency: 'urgente' } })
    expect(subject.toLowerCase()).toContain('urgente')
  })

  it('incluye los datos capturados y la duración', () => {
    const { html, text } = renderRunEmail(ctx)
    expect(html).toContain('Rosa Elena Domínguez')
    expect(html).toContain('+13055550147')
    expect(text).toContain('3m 36s')
  })

  it('omite los campos vacíos en vez de mostrarlos en blanco', () => {
    const { html } = renderRunEmail(ctx)
    expect(html).not.toContain('policy_number')
  })

  it('usa las etiquetas configuradas cuando se le pasan', () => {
    const { html } = renderRunEmail(ctx, { caller_name: 'Nombre', callback_phone: 'Teléfono' })
    expect(html).toContain('Nombre')
    expect(html).toContain('Teléfono')
    expect(html).not.toContain('caller_name')
  })

  it('escapa el contenido para que no rompa el HTML', () => {
    const malicioso = { ...ctx, fields: { caller_name: '<script>alert(1)</script>' } }
    const { html } = renderRunEmail(malicioso)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('incluye la transcripción y el enlace a la grabación', () => {
    const { html } = renderRunEmail(ctx)
    expect(html).toContain('Quiero cancelar mi póliza.')
    expect(html).toContain('https://storage.vapi.ai/rec/1.wav')
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ingest/email.test.ts`
Expected: FAIL — `email.ts` no existe.

- [ ] **Step 3: Implementar**

Crear `supabase/functions/_shared/email.ts`:

```ts
import type { RunContext } from './actions.ts'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** El contenido viene de una llamada telefónica: nada de confiar en él. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function formatDuration(sec: number | null): string {
  if (sec === null) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

/**
 * Redacta el correo de una llamada.
 *
 * `labels` traduce claves técnicas a las etiquetas configuradas en field_defs.
 * Quien lee esto es la recepción del cliente, no un desarrollador: ver
 * `callback_phone` en vez de "Teléfono" es una fuga de la implementación.
 */
export function renderRunEmail(
  ctx: RunContext,
  labels: Record<string, string> = {},
): RenderedEmail {
  const name = ctx.fields.caller_name?.trim() || ctx.callerNumber || 'Alguien'
  const reason = ctx.fields.reason_category?.trim()
  const urgent = ctx.fields.urgency?.trim().toLowerCase() === 'urgente'

  const subject = [
    urgent ? '[URGENTE]' : null,
    `${name} llamó`,
    reason ? `— ${reason}` : null,
  ].filter(Boolean).join(' ')

  const shown = Object.entries(ctx.fields).filter(([, v]) => v && v.trim() !== '')

  const rows = shown.map(([k, v]) =>
    `<tr>
      <td style="padding:6px 12px 6px 0;color:#6d737a;white-space:nowrap;vertical-align:top">${escapeHtml(labels[k] ?? k)}</td>
      <td style="padding:6px 0;color:#1b1e22">${escapeHtml(v)}</td>
    </tr>`,
  ).join('')

  const turns = ctx.turns.map(t =>
    `<p style="margin:0 0 8px"><strong style="color:${t.speaker === 'agent' ? '#2851be' : '#6d737a'}">${t.speaker === 'agent' ? 'Agente' : 'Quien llama'}:</strong> ${escapeHtml(t.text)}</p>`,
  ).join('')

  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;color:#1b1e22">
  <h2 style="margin:0 0 4px;font-size:18px">${escapeHtml(subject)}</h2>
  <p style="margin:0 0 16px;color:#6d737a;font-size:13px">
    ${escapeHtml(ctx.agentName)} · ${formatDuration(ctx.durationSec)}
  </p>
  ${ctx.summary ? `<p style="margin:0 0 16px">${escapeHtml(ctx.summary)}</p>` : ''}
  <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">${rows}</table>
  ${ctx.recordingUrl ? `<p style="margin:0 0 16px"><a href="${escapeHtml(ctx.recordingUrl)}">Escuchar la grabación</a></p>` : ''}
  <details>
    <summary style="cursor:pointer;color:#6d737a;font-size:13px">Transcripción</summary>
    <div style="margin-top:12px;font-size:14px">${turns}</div>
  </details>
</div>`

  const text = [
    subject,
    `${ctx.agentName} · ${formatDuration(ctx.durationSec)}`,
    ctx.summary ?? '',
    '',
    ...shown.map(([k, v]) => `${labels[k] ?? k}: ${v}`),
    '',
    ctx.recordingUrl ? `Grabación: ${ctx.recordingUrl}` : '',
    '',
    ...ctx.turns.map(t => `${t.speaker === 'agent' ? 'Agente' : 'Quien llama'}: ${t.text}`),
  ].filter(l => l !== null).join('\n')

  return { subject, html, text }
}
```

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npx vitest run tests/ingest/email.test.ts`
Expected: PASS, 7 pruebas.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/email.ts tests/ingest/email.test.ts
git commit -m "feat(actions): redacción del correo por llamada con escape de contenido"
```

---

### Task 4: Ejecutor de acciones

**Files:**
- Modify: `supabase/functions/_shared/actions.ts`
- Test: `tests/ingest/actions-run.test.ts`

**Interfaces:**
- Consumes: `buildRunContext`, `matchesCondition`, `renderRunEmail`
- Produces: `runActions(db, runId, deps)` con `deps = { sendEmail: EmailSender }`; `EmailSender = (msg: { to: string[]; subject: string; html: string; text: string }) => Promise<void>`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ingest/actions-run.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from '../db/client'
import { runActions } from '../../supabase/functions/_shared/actions'

async function seed(
  actions: { type: string; config: unknown; condition?: unknown; enabled?: boolean }[],
  fields: Record<string, string> = { caller_name: 'Rosa', urgency: 'normal' },
) {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
  }).select().single()
  const { data: r } = await svc.from('runs').insert({
    client_id: c!.id, agent_id: a!.id, provider: 'vapi', provider_call_id: 'call_act',
    started_at: new Date().toISOString(), status: 'completed', duration_sec: 100,
  }).select().single()
  await svc.from('extracted_values').insert(
    Object.entries(fields).map(([k, v]) => ({
      run_id: r!.id, field_key: k, value_text: v, extraction_version: 1,
    })),
  )
  await svc.from('agent_actions').insert(
    actions.map(x => ({
      agent_id: a!.id, type: x.type, config: x.config,
      condition: x.condition ?? null, enabled: x.enabled ?? true,
    })),
  )
  return { runId: r!.id as string, agentId: a!.id as string }
}

function fakeSender() {
  const sent: { to: string[]; subject: string }[] = []
  return {
    sent,
    sendEmail: async (m: { to: string[]; subject: string }) => { sent.push(m) },
  }
}

describe('ejecutor de acciones', () => {
  beforeEach(resetData)

  it('manda el correo configurado y lo registra', async () => {
    const { runId } = await seed([
      { type: 'email_per_run', config: { recipients: ['frontdesk@magen.test'] } },
    ])
    const svc = serviceClient()
    const s = fakeSender()

    const res = await runActions(svc, runId, { sendEmail: s.sendEmail })

    expect(res.executed).toBe(1)
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0].to).toEqual(['frontdesk@magen.test'])

    const { data } = await svc.from('action_runs').select().eq('run_id', runId)
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('sent')
  })

  it('omite las acciones deshabilitadas', async () => {
    const { runId } = await seed([
      { type: 'email_per_run', config: { recipients: ['a@x.test'] }, enabled: false },
    ])
    const s = fakeSender()
    const res = await runActions(serviceClient(), runId, { sendEmail: s.sendEmail })
    expect(res.executed).toBe(0)
    expect(s.sent).toHaveLength(0)
  })

  it('respeta la condición y deja constancia de lo omitido', async () => {
    const { runId } = await seed([
      { type: 'email_per_run', config: { recipients: ['a@x.test'] }, condition: { urgency: 'urgente' } },
    ])
    const svc = serviceClient()
    const s = fakeSender()

    await runActions(svc, runId, { sendEmail: s.sendEmail })

    expect(s.sent).toHaveLength(0)
    const { data } = await svc.from('action_runs').select().eq('run_id', runId)
    expect(data![0].status).toBe('skipped')
  })

  it('dispara cuando la condición se cumple', async () => {
    const { runId } = await seed(
      [{ type: 'email_per_run', config: { recipients: ['a@x.test'] }, condition: { urgency: 'urgente' } }],
      { caller_name: 'Rosa', urgency: 'urgente' },
    )
    const s = fakeSender()
    await runActions(serviceClient(), runId, { sendEmail: s.sendEmail })
    expect(s.sent).toHaveLength(1)
  })

  // Una acción rota no puede tumbar las demás ni la ingesta.
  it('registra el fallo y continúa con el resto', async () => {
    const { runId } = await seed([
      { type: 'email_per_run', config: { recipients: ['rompe@x.test'] } },
      { type: 'email_per_run', config: { recipients: ['ok@x.test'] } },
    ])
    const svc = serviceClient()
    const sent: string[][] = []
    const sendEmail = async (m: { to: string[] }) => {
      if (m.to[0] === 'rompe@x.test') throw new Error('Resend respondió 429')
      sent.push(m.to)
    }

    const res = await runActions(svc, runId, { sendEmail })

    expect(res.failed).toBe(1)
    expect(sent).toEqual([['ok@x.test']])

    const { data } = await svc.from('action_runs').select().eq('run_id', runId)
    const failed = data!.find(x => x.status === 'failed')!
    expect(failed.error).toContain('429')
  })

  it('omite las acciones sin destinatarios en vez de fallar', async () => {
    const { runId } = await seed([{ type: 'email_per_run', config: { recipients: [] } }])
    const svc = serviceClient()
    const s = fakeSender()

    await runActions(svc, runId, { sendEmail: s.sendEmail })

    expect(s.sent).toHaveLength(0)
    const { data } = await svc.from('action_runs').select().eq('run_id', runId)
    expect(data![0].status).toBe('skipped')
  })

  it('ignora los tipos aún no implementados sin romperse', async () => {
    const { runId } = await seed([
      { type: 'webhook', config: { url: 'https://crm.test/hook' } },
    ])
    const svc = serviceClient()
    const s = fakeSender()

    const res = await runActions(svc, runId, { sendEmail: s.sendEmail })

    expect(res.failed).toBe(0)
    const { data } = await svc.from('action_runs').select().eq('run_id', runId)
    expect(data![0].status).toBe('skipped')
  })

  it('no hace nada si el run no existe', async () => {
    const s = fakeSender()
    const res = await runActions(
      serviceClient(), '00000000-0000-4000-8000-000000000000', { sendEmail: s.sendEmail },
    )
    expect(res.executed).toBe(0)
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ingest/actions-run.test.ts`
Expected: FAIL — `runActions` no existe.

- [ ] **Step 3: Implementar**

Añadir al final de `supabase/functions/_shared/actions.ts`:

```ts
import { renderRunEmail } from './email.ts'

export interface EmailMessage {
  to: string[]
  subject: string
  html: string
  text: string
}

export type EmailSender = (msg: EmailMessage) => Promise<void>

export interface ActionDeps {
  sendEmail: EmailSender
}

export interface ActionsResult {
  executed: number
  skipped: number
  failed: number
}

/**
 * Ejecuta las acciones configuradas del agente para una llamada.
 *
 * Cada acción se aísla en su propio try: una que falle no puede impedir las
 * demás ni propagar el error a la ingesta. Todo intento queda en action_runs,
 * incluidos los omitidos, para que "no llegó el correo" siempre tenga respuesta.
 */
export async function runActions(
  db: SupabaseClient,
  runId: string,
  deps: ActionDeps,
): Promise<ActionsResult> {
  const result: ActionsResult = { executed: 0, skipped: 0, failed: 0 }

  const ctx = await buildRunContext(db, runId)
  if (!ctx) return result

  const { data: actions } = await db.from('agent_actions')
    .select('id, type, config, condition, enabled')
    .eq('agent_id', ctx.agentId).eq('enabled', true).order('sort_order')

  if (!actions?.length) return result

  // Etiquetas legibles para el correo, tomadas de la configuración del agente.
  const { data: defs } = await db.from('field_defs')
    .select('key, label').eq('agent_id', ctx.agentId)
  const labels = Object.fromEntries((defs ?? []).map(d => [d.key, d.label]))

  const record = async (
    action: { id: string; type: string },
    status: 'sent' | 'failed' | 'skipped',
    detail?: Record<string, unknown>,
    error?: string,
  ) => {
    await db.from('action_runs').insert({
      action_id: action.id, client_id: ctx.clientId, agent_id: ctx.agentId,
      run_id: runId, type: action.type, status,
      detail: detail ?? null, error: error ?? null,
    })
  }

  for (const action of actions) {
    try {
      if (!matchesCondition(action.condition as Record<string, unknown> | null, ctx.fields)) {
        await record(action, 'skipped', { reason: 'condición no cumplida' })
        result.skipped++
        continue
      }

      if (action.type !== 'email_per_run') {
        // `webhook` está declarado en el esquema pero aún sin implementación.
        await record(action, 'skipped', { reason: `tipo ${action.type} no implementado` })
        result.skipped++
        continue
      }

      const recipients = ((action.config as { recipients?: string[] })?.recipients ?? [])
        .filter(r => typeof r === 'string' && r.includes('@'))

      if (recipients.length === 0) {
        await record(action, 'skipped', { reason: 'sin destinatarios configurados' })
        result.skipped++
        continue
      }

      const email = renderRunEmail(ctx, labels)
      await deps.sendEmail({ to: recipients, ...email })
      await record(action, 'sent', { recipients, subject: email.subject })
      result.executed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await record(action, 'failed', undefined, message)
      await db.from('events').insert({
        client_id: ctx.clientId, agent_id: ctx.agentId, run_id: runId,
        type: 'action.failed', level: 'error',
        message: `Acción ${action.type}: ${message}`,
      })
      result.failed++
    }
  }

  return result
}
```

- [ ] **Step 4: Ejecutar las pruebas**

```bash
npx supabase db reset
npx vitest run tests/ingest/actions-run.test.ts
```

Expected: PASS, 8 pruebas.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/actions.ts tests/ingest/actions-run.test.ts
git commit -m "feat(actions): ejecutor con aislamiento de fallos y registro de cada intento"
```

---

### Task 5: Conectar las acciones a la ingesta

**Files:**
- Create: `supabase/functions/_shared/email-sender.ts`
- Modify: `supabase/functions/provider-webhook/index.ts`
- Modify: `.env.example`
- Test: `tests/ingest/webhook-actions.test.ts`

**Interfaces:**
- Consumes: `runActions`, `EmailSender`
- Produces: `resendSender(apiKey, from)` → `EmailSender`; el webhook ejecuta acciones tras proyectar

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ingest/webhook-actions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serviceClient, resetData } from '../db/client'
import { supabaseEnv } from '../db/env'

const raw = readFileSync(resolve(__dirname, 'fixtures/vapi-end-of-call.json'), 'utf8')
const SECRET = 'secreto-de-pruebas'

async function seedAgentWithAction() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
    provider_agent_id: 'asst_magen_intake',
  }).select().single()
  await svc.from('agent_actions').insert({
    agent_id: a!.id, type: 'email_per_run',
    config: { recipients: ['frontdesk@magen.test'] },
  })
}

// Requiere `npx supabase functions serve` corriendo en otra terminal.
describe('acciones tras la ingesta', () => {
  beforeEach(resetData)

  it('ejecuta las acciones del agente al proyectar la llamada', async () => {
    await seedAgentWithAction()

    const res = await fetch(
      `${supabaseEnv().url}/functions/v1/provider-webhook/vapi`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-vapi-secret': SECRET },
        body: raw,
      },
    )
    expect(res.status).toBe(200)

    const svc = serviceClient()
    const { data } = await svc.from('action_runs').select('type, status')
    expect(data).toHaveLength(1)
    expect(data![0].type).toBe('email_per_run')
    // Sin RESEND_API_KEY configurada, el emisor deja constancia en vez de mandar.
    expect(['sent', 'skipped', 'failed']).toContain(data![0].status)
  })

  // El correo es un efecto secundario: si falla, la llamada ya está guardada.
  it('registra la llamada aunque la acción no pueda enviarse', async () => {
    await seedAgentWithAction()

    await fetch(`${supabaseEnv().url}/functions/v1/provider-webhook/vapi`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vapi-secret': SECRET },
      body: raw,
    })

    const { data } = await serviceClient().from('runs').select('id, extraction_status')
    expect(data).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

```bash
npx supabase functions serve --env-file supabase/functions/.env.local &
npx vitest run tests/ingest/webhook-actions.test.ts
```

Expected: FAIL — no se crean filas en `action_runs`.

- [ ] **Step 3: Implementar el emisor**

Crear `supabase/functions/_shared/email-sender.ts`:

```ts
import type { EmailSender } from './actions.ts'

/**
 * Emisor real vía Resend.
 *
 * Se construye con la llave en vez de leerla dentro: así el ejecutor de
 * acciones no depende de ninguna variable de entorno y puede probarse con un
 * doble.
 */
export function resendSender(apiKey: string, from: string): EmailSender {
  return async (msg) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Resend respondió ${res.status}: ${detail.slice(0, 200)}`)
    }
  }
}

/**
 * Emisor de reserva mientras no hay cuenta de correo configurada.
 *
 * Falla a propósito en vez de fingir que envió: un correo silenciosamente no
 * enviado es peor que uno que deja su error en action_runs.
 */
export const unconfiguredSender: EmailSender = () => {
  throw new Error('No hay proveedor de correo configurado (falta RESEND_API_KEY)')
}
```

- [ ] **Step 4: Conectar en el webhook**

En `supabase/functions/provider-webhook/index.ts`, añadir imports:

```ts
import { runActions } from '../_shared/actions.ts'
import { resendSender, unconfiguredSender } from '../_shared/email-sender.ts'
```

y sustituir el bloque que devuelve el resultado de la proyección:

```ts
    const parsed = adapter.parseWebhook(payload)
    const result = await projectWebhook(db, { provider, rawBody, parsed })

    // Las acciones son efecto secundario: la llamada ya quedó guardada, así que
    // un fallo aquí no puede cambiar la respuesta al proveedor ni provocar un
    // reintento que volvería a proyectar lo mismo.
    if (result.runId && !result.skipped) {
      const apiKey = Deno.env.get('RESEND_API_KEY')
      const from = Deno.env.get('EMAIL_FROM') ?? 'Switchboard <notificaciones@switchboard.local>'
      const sendEmail = apiKey ? resendSender(apiKey, from) : unconfiguredSender
      try {
        await runActions(db, result.runId, { sendEmail })
      } catch (err) {
        await db.from('events').insert({
          type: 'actions.unhandled', level: 'error', run_id: result.runId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return Response.json({ ok: true, ...result })
```

- [ ] **Step 5: Documentar las variables nuevas**

Añadir a `.env.example`:

```bash
# Clave de API de Vapi, para publicar agentes y aprovisionar números.
VAPI_API_KEY=

# Envío de correo. Sin esto, las acciones quedan registradas como fallidas
# en action_runs en vez de enviarse silenciosamente al vacío.
RESEND_API_KEY=
EMAIL_FROM="Switchboard <notificaciones@tu-dominio.com>"
```

- [ ] **Step 6: Ejecutar las pruebas**

```bash
npx supabase db reset
npx vitest run tests/ingest/webhook-actions.test.ts
```

Expected: PASS, 2 pruebas.

- [ ] **Step 7: Verificar la suite completa**

```bash
npx supabase db reset && npm run test:db && npx tsc -b
```

Expected: todo en verde.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions .env.example tests/ingest
git commit -m "feat(actions): ejecución de acciones tras la ingesta con emisor inyectable"
```

---

## Verificación final

```bash
npx supabase db reset && npm run test:db && npx tsc -b
```

- Un agente se publica en el proveedor y congela su revisión
- Una llamada proyectada dispara las acciones configuradas
- Una acción que falla queda registrada y no afecta a las demás ni a la ingesta
- Ninguna clave real es necesaria para que la suite pase

## Lo que necesita cuentas reales

| Pieza | Qué hace falta |
|---|---|
| Publicar el agente | Cuenta de Vapi y `VAPI_API_KEY` |
| Número de pruebas | Aprovisionarlo en Vapi y apuntarlo al agente |
| Envío de correo | Cuenta de Resend, dominio verificado, `RESEND_API_KEY` |

Sin esas llaves todo el código funciona y la suite pasa: los efectos externos
quedan registrados como fallidos en `action_runs`, nunca enviados en silencio.
