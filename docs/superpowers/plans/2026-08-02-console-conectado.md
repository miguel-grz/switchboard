# Console conectado (Plan 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el Operator Console muestre las llamadas reales de la base en vez de datos de muestra, sin romper el demo publicado.

**Architecture:** Una capa de datos con un contrato único y dos implementaciones — mocks y Supabase — elegidas por variable de entorno. Los componentes no cambian de forma: la capa devuelve exactamente los tipos que ya consumen, así que la adaptación ocurre en un solo sitio. El acceso pasa por RLS con la sesión del operador, de modo que la misma pantalla servirá al dashboard de cliente sin cambios de consulta.

**Tech Stack:** React · TypeScript · `@supabase/supabase-js` · Vitest

## Global Constraints

- **Los componentes de pantalla no importan `supabase-js` ni `src/mocks/`.** Solo consumen la capa de datos.
- **La capa devuelve los tipos de `src/types.ts` tal cual.** Si un dato de la base no encaja, se adapta en la capa, nunca en el componente.
- **Sin `VITE_SUPABASE_URL` la app funciona con mocks.** Es lo que mantiene vivo el demo de GitHub Pages.
- **Ninguna clave de servicio en el frontend.** Solo la clave anónima; la seguridad la da RLS.
- Identificadores en inglés; comentarios y documentación en español.
- Toda pantalla conectada maneja los tres estados: cargando, error y vacío.

---

### Task 1: Contrato de datos y fuente mock

**Files:**
- Create: `src/data/source.ts`
- Create: `src/data/mock-source.ts`
- Create: `src/data/index.ts`
- Test: `tests/ui/mock-source.test.ts`

**Interfaces:**
- Produces: `DataSource` con `listClients`, `getClient`, `listAgents`, `getAgent`, `listRuns`, `getRun`, `getSummary`; `getDataSource()` que elige implementación

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ui/mock-source.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mockSource } from '../../src/data/mock-source'

describe('fuente de datos mock', () => {
  it('lista los clientes del prototipo', async () => {
    const clients = await mockSource.listClients()
    expect(clients).toHaveLength(4)
    expect(clients[0]).toHaveProperty('industry')
  })

  it('devuelve null para un cliente inexistente', async () => {
    expect(await mockSource.getClient('no-existe')).toBeNull()
  })

  it('filtra los runs por cliente', async () => {
    const runs = await mockSource.listRuns({ clientId: 'cl-meridian' })
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.every(r => r.clientId === 'cl-meridian')).toBe(true)
  })

  it('filtra los runs por estado', async () => {
    const runs = await mockSource.listRuns({ status: 'failed' })
    expect(runs.every(r => r.status === 'failed')).toBe(true)
  })

  it('devuelve el detalle de un run con transcripción', async () => {
    const [first] = await mockSource.listRuns({})
    const run = await mockSource.getRun(first.id)
    expect(run!.transcript.length).toBeGreaterThan(0)
  })

  it('resume métricas del alcance pedido', async () => {
    const s = await mockSource.getSummary(null)
    expect(s.today).toBeGreaterThanOrEqual(0)
    expect(s.successRate).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ui/mock-source.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Definir el contrato**

Crear `src/data/source.ts`:

```ts
import type { Agent, Client, Run, RunStatus } from '../types'
import type { Summary, DayPoint } from '../lib/metrics'

export interface RunFilter {
  clientId?: string | null
  agentId?: string | null
  status?: RunStatus | 'all'
  limit?: number
}

/**
 * Contrato único de datos del console.
 *
 * Devuelve los mismos tipos que ya consumen las pantallas: adaptar aquí y no
 * en los componentes es lo que permite cambiar de fuente sin tocar la UI.
 */
export interface DataSource {
  readonly name: 'mock' | 'supabase'
  listClients(): Promise<Client[]>
  getClient(id: string): Promise<Client | null>
  listAgents(clientId?: string | null): Promise<Agent[]>
  getAgent(id: string): Promise<Agent | null>
  listRuns(filter: RunFilter): Promise<Run[]>
  getRun(id: string): Promise<Run | null>
  getSummary(clientId: string | null): Promise<Summary>
  getDailySeries(clientId: string | null, days: number): Promise<DayPoint[]>
}
```

- [ ] **Step 4: Implementar la fuente mock**

Crear `src/data/mock-source.ts`:

```ts
import type { DataSource, RunFilter } from './source'
import { clients } from '../mocks/clients'
import { agents } from '../mocks/agents'
import { runs } from '../mocks/runs'
import { dailySeries, scopedRuns, summarize } from '../lib/metrics'

/** Envuelve los datos de muestra tras el mismo contrato que la fuente real. */
export const mockSource: DataSource = {
  name: 'mock',

  async listClients() { return clients },
  async getClient(id) { return clients.find(c => c.id === id) ?? null },

  async listAgents(clientId) {
    return clientId ? agents.filter(a => a.clientId === clientId) : agents
  },
  async getAgent(id) { return agents.find(a => a.id === id) ?? null },

  async listRuns(filter: RunFilter) {
    let out = runs
    if (filter.clientId) out = out.filter(r => r.clientId === filter.clientId)
    if (filter.agentId) out = out.filter(r => r.agentId === filter.agentId)
    if (filter.status && filter.status !== 'all') {
      out = out.filter(r => r.status === filter.status)
    }
    return filter.limit ? out.slice(0, filter.limit) : out
  },

  async getRun(id) { return runs.find(r => r.id === id) ?? null },

  async getSummary(clientId) { return summarize(scopedRuns(clientId)) },
  async getDailySeries(clientId, days) { return dailySeries(scopedRuns(clientId), days) },
}
```

- [ ] **Step 5: Escribir el selector de fuente**

Crear `src/data/index.ts`:

```ts
import type { DataSource } from './source'
import { mockSource } from './mock-source'
import { supabaseSource } from './supabase-source'
import { isSupabaseConfigured } from '../lib/supabase'

let cached: DataSource | null = null

/**
 * Elige la fuente según la configuración.
 *
 * Sin variables de Supabase la app corre con datos de muestra: es lo que
 * mantiene funcionando el demo publicado en GitHub Pages, que no puede
 * alcanzar ninguna base.
 */
export function getDataSource(): DataSource {
  if (!cached) cached = isSupabaseConfigured() ? supabaseSource : mockSource
  return cached
}

export type { DataSource, RunFilter } from './source'
```

> `supabase-source` y `lib/supabase` se crean en la Task 2; hasta entonces esta
> importación falla y el selector no se puede usar. La prueba de este paso solo
> ejercita `mockSource` directamente.

- [ ] **Step 6: Ejecutar la prueba**

Run: `npx vitest run tests/ui/mock-source.test.ts`
Expected: PASS, 6 pruebas.

- [ ] **Step 7: Commit**

```bash
git add src/data tests/ui
git commit -m "feat(console): contrato de datos y fuente de respaldo con mocks"
```

---

### Task 2: Cliente de Supabase y fuente real

**Files:**
- Create: `src/lib/supabase.ts`
- Create: `src/data/supabase-source.ts`
- Modify: `.env.example`
- Test: `tests/ui/supabase-source.test.ts`

**Interfaces:**
- Consumes: `DataSource`, `src/lib/database.types`
- Produces: `supabase`, `isSupabaseConfigured()`, `supabaseSource`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/ui/supabase-source.test.ts`. Siembra por `service_role` y lee por la
fuente real, que usa la clave anónima con sesión de operador:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { serviceClient, createUser, resetData } from '../db/client'
import { supabaseEnv } from '../db/env'

// La fuente lee las variables al importarse: hay que fijarlas antes.
const env = supabaseEnv()
process.env.VITE_SUPABASE_URL = env.url
process.env.VITE_SUPABASE_ANON_KEY = env.anonKey

const { supabase } = await import('../../src/lib/supabase')
const { supabaseSource } = await import('../../src/data/supabase-source')

let clientId: string, agentId: string, runId: string

beforeAll(async () => {
  await resetData()
  const svc = serviceClient()

  const { data: c } = await svc.from('clients').insert({
    name: 'Magen Insurance Inc', industry: 'Insurance', status: 'active',
    contact_name: 'Luis Arenas', contact_email: 'luis@magen.test',
  }).select().single()
  clientId = c!.id

  const { data: a } = await svc.from('agents').insert({
    client_id: clientId, module_type: 'voice', name: 'Intake general',
    description: 'Atiende fuera de horario.', provider: 'vapi',
    channel: '+13055550100', status: 'active', system_prompt: 'Contestas para Magen.',
  }).select().single()
  agentId = a!.id

  await svc.from('field_defs').insert([
    { agent_id: agentId, key: 'caller_name', label: 'Nombre', type: 'text', required: true, sort_order: 0 },
    { agent_id: agentId, key: 'urgency', label: 'Urgencia', type: 'select', required: true, sort_order: 1, options: ['normal', 'urgente'] },
  ])

  const { data: r } = await svc.from('runs').insert({
    client_id: clientId, agent_id: agentId, provider: 'vapi',
    provider_call_id: 'call_ui_1', started_at: new Date().toISOString(),
    duration_sec: 216, status: 'completed', latency_ms: 540,
    summary: 'Solicita cancelación.',
  }).select().single()
  runId = r!.id

  await svc.from('transcript_turns').insert([
    { run_id: runId, seq: 1, speaker: 'agent', text: 'Buenas noches.' },
    { run_id: runId, seq: 2, speaker: 'caller', text: 'Quiero cancelar.' },
  ])
  await svc.from('extracted_values').insert([
    { run_id: runId, field_key: 'caller_name', value_text: 'Rosa', extraction_version: 1 },
  ])
  await svc.from('usage_events').insert([
    {
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', component: 'llm', quantity: 1, unit: 'calls',
      cost_usd: 0.21, source_event_id: 'evt_ui_1', occurred_at: new Date().toISOString(),
    },
  ])

  await createUser('op@switchboard.test', 'secret123', 'operator')
  await supabase.auth.signInWithPassword({ email: 'op@switchboard.test', password: 'secret123' })
})

describe('fuente de datos real', () => {
  it('lista clientes con sus módulos derivados de los agentes', async () => {
    const list = await supabaseSource.listClients()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Magen Insurance Inc')
    // La base no tiene columna de módulos: se deducen de los agentes.
    expect(list[0].modules).toContain('voice')
  })

  it('trae el agente con sus campos configurados', async () => {
    const agent = await supabaseSource.getAgent(agentId)
    expect(agent!.name).toBe('Intake general')
    expect(agent!.fields).toHaveLength(2)
    expect(agent!.fields[1].options).toEqual(['normal', 'urgente'])
  })

  it('lista runs con su costo sumado del ledger', async () => {
    const runs = await supabaseSource.listRuns({ clientId })
    expect(runs).toHaveLength(1)
    expect(runs[0].costUsd).toBeCloseTo(0.21, 4)
    expect(runs[0].durationSec).toBe(216)
  })

  it('trae el detalle con transcripción y datos extraídos', async () => {
    const run = await supabaseSource.getRun(runId)
    expect(run!.transcript).toHaveLength(2)
    expect(run!.transcript[0].speaker).toBe('agent')
    expect(run!.extracted.caller_name).toBe('Rosa')
  })

  it('filtra por estado', async () => {
    expect(await supabaseSource.listRuns({ status: 'failed' })).toHaveLength(0)
    expect(await supabaseSource.listRuns({ status: 'completed' })).toHaveLength(1)
  })

  it('devuelve null si el run no existe', async () => {
    expect(await supabaseSource.getRun('00000000-0000-4000-8000-000000000000')).toBeNull()
  })

  it('resume métricas del alcance', async () => {
    const s = await supabaseSource.getSummary(clientId)
    expect(s.successRate).toBe(1)
    expect(s.avgLatencyMs).toBe(540)
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/ui/supabase-source.test.ts`
Expected: FAIL — los módulos no existen.

- [ ] **Step 3: Escribir el cliente**

Crear `src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// En pruebas se leen de process.env; en el navegador, de import.meta.env.
const env = (import.meta as unknown as { env?: Record<string, string> }).env
  ?? (globalThis as unknown as { process?: { env: Record<string, string> } }).process?.env
  ?? {}

const url = env.VITE_SUPABASE_URL ?? ''
const anonKey = env.VITE_SUPABASE_ANON_KEY ?? ''

/** Sin configuración la app cae a datos de muestra (ver src/data/index.ts). */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

// Solo clave anónima: la seguridad la impone RLS, nunca el frontend.
export const supabase = createClient<Database>(url || 'http://localhost', anonKey || 'anon', {
  auth: { persistSession: true, autoRefreshToken: true },
})
```

- [ ] **Step 4: Implementar la fuente real**

Crear `src/data/supabase-source.ts`:

```ts
import type { DataSource, RunFilter } from './source'
import type { Agent, Client, FieldDef, ModuleType, Run, RunStatus, TranscriptTurn } from '../types'
import type { DayPoint, Summary } from '../lib/metrics'
import { supabase } from '../lib/supabase'

/** Columnas de un run más lo necesario para calcular su costo. */
const RUN_COLUMNS = `
  id, client_id, agent_id, started_at, duration_sec, status, latency_ms,
  summary, recording_url, ended_reason, extraction_status,
  usage_events ( cost_usd )
`

function sumCost(rows: { cost_usd: number | string | null }[] | null): number {
  return (rows ?? []).reduce((s, u) => s + Number(u.cost_usd ?? 0), 0)
}

interface RunRow {
  id: string
  client_id: string
  agent_id: string
  started_at: string
  duration_sec: number | null
  status: string
  latency_ms: number | null
  summary: string | null
  ended_reason: string | null
  extraction_status: string
  usage_events: { cost_usd: number | string | null }[] | null
}

function toRun(row: RunRow, transcript: TranscriptTurn[] = [], extracted: Record<string, string> = {}): Run {
  return {
    id: row.id,
    clientId: row.client_id,
    agentId: row.agent_id,
    startedAt: row.started_at,
    durationSec: row.duration_sec ?? 0,
    status: row.status as RunStatus,
    costUsd: sumCost(row.usage_events),
    latencyMs: row.latency_ms ?? 0,
    // El console muestra un mensaje de error por run; la razón de fin del
    // proveedor es lo más cercano que tiene la base.
    errorMessage: row.status === 'failed' ? (row.ended_reason ?? 'Fallo sin detalle') : undefined,
    transcript,
    extracted,
  }
}

export const supabaseSource: DataSource = {
  name: 'supabase',

  async listClients(): Promise<Client[]> {
    const { data, error } = await supabase
      .from('clients')
      .select('*, agents ( module_type )')
      .order('name')
    if (error) throw new Error(error.message)

    return (data ?? []).map(c => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      status: c.status as Client['status'],
      // La base no guarda módulos por cliente: se deducen de sus agentes.
      modules: [...new Set(
        ((c.agents ?? []) as { module_type: string }[]).map(a => a.module_type as ModuleType),
      )],
      contactName: c.contact_name ?? '',
      contactEmail: c.contact_email ?? '',
      timezone: c.timezone,
      createdAt: c.created_at.slice(0, 10),
      notes: c.notes ?? '',
    }))
  },

  async getClient(id: string): Promise<Client | null> {
    const all = await this.listClients()
    return all.find(c => c.id === id) ?? null
  },

  async listAgents(clientId?: string | null): Promise<Agent[]> {
    let q = supabase.from('agents').select('*, field_defs ( * )').order('name')
    if (clientId) q = q.eq('client_id', clientId)
    const { data, error } = await q
    if (error) throw new Error(error.message)

    return (data ?? []).map(a => ({
      id: a.id,
      clientId: a.client_id,
      name: a.name,
      description: a.description ?? '',
      module: a.module_type as ModuleType,
      provider: a.provider as Agent['provider'],
      channel: a.channel ?? '',
      status: a.status as Agent['status'],
      systemPrompt: a.system_prompt,
      fields: ((a.field_defs ?? []) as Record<string, unknown>[])
        .filter(f => f.intent_id === null)
        .sort((x, y) => Number(x.sort_order) - Number(y.sort_order))
        .map(f => ({
          id: String(f.id),
          name: String(f.key),
          type: f.type as FieldDef['type'],
          required: Boolean(f.required),
          description: (f.description as string) ?? '',
          options: (f.options as string[]) ?? undefined,
        })),
      lastRunAt: null,
      createdAt: a.created_at.slice(0, 10),
    }))
  },

  async getAgent(id: string): Promise<Agent | null> {
    const { data } = await supabase.from('agents').select('client_id').eq('id', id).maybeSingle()
    if (!data) return null
    const list = await this.listAgents(data.client_id)
    return list.find(a => a.id === id) ?? null
  },

  async listRuns(filter: RunFilter): Promise<Run[]> {
    let q = supabase.from('runs').select(RUN_COLUMNS).order('started_at', { ascending: false })
    if (filter.clientId) q = q.eq('client_id', filter.clientId)
    if (filter.agentId) q = q.eq('agent_id', filter.agentId)
    if (filter.status && filter.status !== 'all') q = q.eq('status', filter.status)
    if (filter.limit) q = q.limit(filter.limit)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    return (data as unknown as RunRow[] ?? []).map(r => toRun(r))
  },

  async getRun(id: string): Promise<Run | null> {
    const { data } = await supabase.from('runs').select(RUN_COLUMNS).eq('id', id).maybeSingle()
    if (!data) return null

    const [{ data: turns }, { data: values }] = await Promise.all([
      supabase.from('transcript_turns').select('speaker, text').eq('run_id', id).order('seq'),
      supabase.from('extracted_values')
        .select('field_key, value_text, extraction_version')
        .eq('run_id', id).order('extraction_version'),
    ])

    // La versión más alta gana: al reprocesar conviven varias.
    const extracted: Record<string, string> = {}
    for (const v of values ?? []) extracted[v.field_key] = v.value_text ?? ''

    return toRun(
      data as unknown as RunRow,
      (turns ?? []) as TranscriptTurn[],
      extracted,
    )
  },

  async getSummary(clientId: string | null): Promise<Summary> {
    const runs = await this.listRuns({ clientId })
    const today = new Date().toDateString()
    const todayRuns = runs.filter(r => new Date(r.startedAt).toDateString() === today)
    const finished = runs.filter(r => r.status !== 'in_progress')
    const completed = finished.filter(r => r.status === 'completed')

    return {
      today: todayRuns.length,
      successRate: finished.length ? completed.length / finished.length : 0,
      avgLatencyMs: finished.length
        ? finished.reduce((a, r) => a + r.latencyMs, 0) / finished.length : 0,
      totalCostToday: todayRuns.reduce((a, r) => a + r.costUsd, 0),
      failedToday: todayRuns.filter(r => r.status === 'failed').length,
    }
  },

  async getDailySeries(clientId: string | null, days: number): Promise<DayPoint[]> {
    const runs = await this.listRuns({ clientId })
    const out: DayPoint[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const dayRuns = runs.filter(r => new Date(r.startedAt).toDateString() === d.toDateString())
      out.push({
        label: i === 0 ? 'Today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        completed: dayRuns.filter(r => r.status === 'completed').length,
        failed: dayRuns.filter(r => r.status === 'failed').length,
        total: dayRuns.length,
      })
    }
    return out
  },
}
```

- [ ] **Step 5: Documentar las variables del frontend**

Añadir a `.env.example`:

```bash
# Frontend. Sin estas dos, el console corre con datos de muestra — que es
# como se mantiene vivo el demo publicado en GitHub Pages.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

- [ ] **Step 6: Ejecutar las pruebas**

```bash
npx supabase db reset
npx vitest run tests/ui/supabase-source.test.ts
```

Expected: PASS, 7 pruebas.

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase.ts src/data/supabase-source.ts .env.example tests/ui
git commit -m "feat(console): fuente de datos real sobre Supabase con RLS"
```

---

### Task 3: Sesión de operador

Obligatoria: las políticas de RLS son `to authenticated`, así que sin sesión el
console no vería ninguna fila.

**Files:**
- Create: `src/context/AuthContext.tsx`
- Create: `src/pages/Login.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/layout/AppShell.tsx`

**Interfaces:**
- Produces: `AuthProvider`, `useAuth()` → `{ session, loading, signIn, signOut, requiresAuth }`

- [ ] **Step 1: Escribir el contexto**

Crear `src/context/AuthContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

interface AuthState {
  session: Session | null
  loading: boolean
  /** false cuando la app corre con datos de muestra: no hay nada que proteger. */
  requiresAuth: boolean
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null, loading: false, requiresAuth: false,
  signIn: async () => {}, signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const requiresAuth = isSupabaseConfigured()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(requiresAuth)

  useEffect(() => {
    if (!requiresAuth) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [requiresAuth])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    // El mensaje de Supabase es genérico a propósito: no revela si el correo
    // existe. Se traduce sin añadir información.
    if (error) throw new Error('Correo o contraseña incorrectos.')
  }

  const signOut = async () => { await supabase.auth.signOut() }

  return (
    <AuthContext.Provider value={{ session, loading, requiresAuth, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() { return useContext(AuthContext) }
```

- [ ] **Step 2: Escribir la pantalla de acceso**

Crear `src/pages/Login.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.')
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] focus:border-cobalt focus:outline-none'

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-[340px]">
        <div className="mb-6 flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--color-cobalt)" />
            <circle cx="11" cy="11" r="3" fill="#fff" />
            <circle cx="21" cy="21" r="3" fill="#fff" />
            <path d="M11 14v3a4 4 0 0 0 4 4h3" stroke="#fff" strokeWidth="2" fill="none" />
          </svg>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">Switchboard</div>
            <div className="data text-[10px] uppercase tracking-[0.14em] text-mute">operator console</div>
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-line bg-surface p-5">
          <label className="block text-xs font-medium text-mute">
            Correo
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="username" required className={`${field} mt-1`}
            />
          </label>
          <label className="block text-xs font-medium text-mute">
            Contraseña
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password" required className={`${field} mt-1`}
            />
          </label>

          {error && (
            <p role="alert" className="rounded border border-fail/25 bg-fail-soft px-3 py-2 text-[13px] text-fail">
              {error}
            </p>
          )}

          <button
            type="submit" disabled={busy}
            className="w-full rounded-md bg-cobalt px-4 py-2 text-[13px] font-medium text-white hover:bg-cobalt-dark disabled:opacity-60"
          >
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Proteger las rutas**

En `src/App.tsx`, envolver el árbol:

```tsx
import { useAuth } from './context/AuthContext'
import Login from './pages/Login'

export default function App() {
  const { session, loading, requiresAuth } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="skeleton h-4 w-32" />
      </div>
    )
  }

  // Con datos de muestra no hay sesión que exigir: el demo publicado entra directo.
  if (requiresAuth && !session) return <Login />

  return (
    <Routes>
      {/* …rutas existentes sin cambios… */}
    </Routes>
  )
}
```

y en `src/main.tsx`, añadir `AuthProvider` por dentro de `HashRouter` y por fuera
de `ScopeProvider`.

- [ ] **Step 4: Añadir salida de sesión al shell**

En `src/components/layout/AppShell.tsx`, sustituir el avatar fijo por un botón que
cierre sesión cuando haya sesión activa, e indicar la fuente de datos:

```tsx
const { session, signOut, requiresAuth } = useAuth()
```

```tsx
<div className="ml-auto flex shrink-0 items-center gap-3">
  {!requiresAuth && (
    <span className="data hidden rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-mute sm:inline">
      demo
    </span>
  )}
  {session ? (
    <button
      onClick={() => void signOut()}
      title={session.user.email ?? undefined}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-cobalt text-[11px] font-semibold text-white"
    >
      {(session.user.email ?? '?').slice(0, 2).toUpperCase()}
    </button>
  ) : (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cobalt text-[11px] font-semibold text-white">
      MA
    </div>
  )}
</div>
```

- [ ] **Step 5: Verificar que compila y que el demo sigue entrando sin sesión**

```bash
npx tsc -b
npm run build
```

Expected: sin errores. Sin variables de Supabase, `requiresAuth` es false y la app
entra directo a los datos de muestra.

- [ ] **Step 6: Commit**

```bash
git add src/context/AuthContext.tsx src/pages/Login.tsx src/App.tsx src/main.tsx src/components/layout/AppShell.tsx
git commit -m "feat(console): sesión de operador exigida solo cuando hay base configurada"
```

---

### Task 4: Conectar las pantallas

**Files:**
- Create: `src/data/hooks.ts`
- Modify: `src/pages/Runs.tsx`, `src/pages/Clients.tsx`, `src/pages/ClientDetail.tsx`, `src/pages/AgentConfig.tsx`, `src/pages/Dashboard.tsx`
- Modify: `src/components/RunDetail.tsx`

**Interfaces:**
- Produces: `useAsync<T>(fn, deps)` → `{ data, error, loading }`

- [ ] **Step 1: Escribir el hook**

Crear `src/data/hooks.ts`:

```ts
import { useEffect, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/**
 * Ejecuta una consulta y expone los tres estados que toda pantalla conectada
 * debe manejar. Descarta el resultado si las dependencias cambiaron mientras
 * viajaba, para que una respuesta lenta no pise a una más nueva.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))
    fn()
      .then(data => { if (!cancelled) setState({ data, error: null, loading: false }) })
      .catch((e: unknown) => {
        if (cancelled) return
        setState({
          data: null,
          error: e instanceof Error ? e.message : 'No se pudieron cargar los datos.',
          loading: false,
        })
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
```

- [ ] **Step 2: Conectar la pantalla de Runs**

En `src/pages/Runs.tsx`, sustituir la lectura de mocks por la fuente:

```tsx
import { getDataSource } from '../data'
import { useAsync } from '../data/hooks'
```

```tsx
  const source = getDataSource()
  const { data: base, error, loading } = useAsync(
    () => source.listRuns({ clientId: scopeClientId, agentId: agentId === 'all' ? null : agentId, status }),
    [scopeClientId, agentId, status],
  )
  const { data: agentOptions } = useAsync(() => source.listAgents(scopeClientId), [scopeClientId])
  const filtered = base ?? []
```

y envolver la tabla con los tres estados:

```tsx
      <Panel pad={false}>
        {loading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : error ? (
          <EmptyState title="No se pudieron cargar los runs" hint={error} />
        ) : (
          <RunsTable
            runs={filtered}
            onSelect={setSelected}
            showClient={!scopeClientId}
            emptyHint="No hay runs con estos filtros. Bórralos o amplía el alcance de cliente."
          />
        )}
      </Panel>
```

> El filtrado deja de hacerse en el cliente: ahora lo hace la consulta. Es lo que
> permitirá paginar cuando haya miles de llamadas.

- [ ] **Step 3: Conectar el detalle del run**

En `src/components/RunDetail.tsx`, la transcripción y los datos extraídos ya no
vienen en el objeto de lista. Aceptar un `runId` y cargar el detalle:

```tsx
  const source = getDataSource()
  const { data: full, loading } = useAsync(
    () => (run ? source.getRun(run.id) : Promise.resolve(null)),
    [run?.id],
  )
  const detail = full ?? run
```

y usar `detail` donde antes usaba `run` para transcripción y extraídos, mostrando
`SkeletonRows` mientras `loading`.

- [ ] **Step 4: Conectar Clients, ClientDetail, AgentConfig y Dashboard**

Mismo patrón en cada uno: `getDataSource()` + `useAsync` + los tres estados.
`Dashboard` usa `getSummary` y `getDailySeries`; `AgentConfig` inicializa su estado
local desde `getAgent` cuando llega.

- [ ] **Step 5: Verificar**

```bash
npx tsc -b && npm run build && npm run test:db
```

Expected: sin errores, todas las pruebas en verde.

- [ ] **Step 6: Verificación en navegador**

Con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` apuntando a la instancia local,
un operador creado y la semilla aplicada:

1. Abrir la app: debe pedir sesión.
2. Entrar: el dashboard muestra los datos de la base, no los de muestra.
3. Sin las variables: entra directo y muestra los datos de muestra.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat(console): pantallas leyendo de la fuente de datos con estados de carga y error"
```

---

## Verificación final

```bash
npx supabase db reset && npm run test:db && npx tsc -b && npm run build
```

- Con variables de Supabase: pide sesión y muestra datos reales
- Sin ellas: entra directo con datos de muestra, como el demo publicado
- Ningún componente de pantalla importa `supabase-js` ni `src/mocks/`

## Deuda registrada

Las dos fuentes de datos existen para no romper el demo de GitHub Pages mientras
no haya un proyecto de Supabase en la nube. **Cuando exista, la fuente mock se
elimina** junto con `src/mocks/`, y el demo pasa a apuntar a datos reales de
prueba.
