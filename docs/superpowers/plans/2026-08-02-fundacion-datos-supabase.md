# Fundación de datos en Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar en Supabase el esquema multi-tenant completo, con seguridad a nivel de fila probada y el cliente Magen sembrado, listo para que la ingesta de llamadas escriba sobre él.

**Architecture:** Postgres sobre Supabase local, con migraciones SQL versionadas. Toda tabla lleva RLS habilitada; el acceso lo deciden dos funciones `security definer` (`is_operator`, `has_client_access`) en vez de repetir lógica en cada política. Las pruebas corren contra Postgres real con usuarios autenticados de verdad, no con mocks, porque una política de RLS solo se puede verificar ejecutándola.

**Tech Stack:** Supabase CLI · PostgreSQL 15+ · `@supabase/supabase-js` · Vitest · TypeScript

## Global Constraints

- **PostgreSQL 15 o superior**: el esquema usa `unique nulls not distinct`, que no existe antes.
- **Toda tabla nueva lleva `enable row level security`**, sin excepción. Una tabla sin RLS en Supabase queda expuesta a cualquiera con la clave anónima.
- Las migraciones viven en `supabase/migrations/` y **nunca se editan una vez aplicadas**: los cambios van en una migración nueva.
- Todas las tablas en el schema `public`.
- Identificadores del esquema en inglés (coinciden con `src/types.ts` del console); documentación y comentarios en español.
- **Dinero siempre `numeric(12,6)`**, nunca `float` ni `real`: los flotantes acumulan error de redondeo y esto alimenta cálculos de margen.
- **Fechas siempre `timestamptz`**, nunca `timestamp`.
- Las Edge Functions usarán `service_role`, que evita RLS por diseño. RLS protege el acceso desde el SPA.

---

### Task 1: Supabase local y arnés de pruebas

Sin esto no se puede probar nada más. Termina con una prueba que se conecta a una base real y falla o pasa de verdad.

**Files:**
- Create: `supabase/config.toml` (lo genera el CLI)
- Create: `tests/db/env.ts`
- Create: `tests/db/client.ts`
- Create: `tests/db/smoke.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nada
- Produces: `supabaseEnv(): { url, anonKey, serviceKey, dbUrl }`, `serviceClient(): SupabaseClient`, `userClient(email, password): Promise<SupabaseClient>`, `createUser(email, password, role: 'operator' | 'client_user'): Promise<string>`, `resetData(): Promise<void>`, `applySeed(): Promise<void>`

- [ ] **Step 1: Instalar dependencias**

```bash
npm install -D vitest @supabase/supabase-js supabase pg @types/pg
```

`pg` se usa solo en las pruebas: limpiar la base entre casos requiere `TRUNCATE`, que la API REST de Supabase no expone.

- [ ] **Step 2: Inicializar y arrancar Supabase**

```bash
npx supabase init
npx supabase start
```

Expected: imprime `API URL`, `DB URL`, `anon key`, `service_role key`. La primera vez descarga imágenes de Docker y tarda varios minutos. Si falla con `Cannot connect to the Docker daemon`, hay que abrir Docker Desktop antes.

- [ ] **Step 3: Ignorar artefactos locales**

Añadir al final de `.gitignore`:

```
supabase/.branches
supabase/.temp
.env.test
```

- [ ] **Step 4: Escribir el lector de configuración**

Crear `tests/db/env.ts`:

```ts
import { execSync } from 'node:child_process'

export interface SupabaseEnv {
  url: string
  anonKey: string
  serviceKey: string
  dbUrl: string
}

let cached: SupabaseEnv | null = null

/** Lee la configuración de la instancia local. Cachea: `supabase status` tarda ~1s. */
export function supabaseEnv(): SupabaseEnv {
  if (cached) return cached
  let raw: string
  try {
    raw = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    throw new Error('Supabase local no está corriendo. Ejecuta: npx supabase start')
  }
  const s = JSON.parse(raw)
  cached = {
    url: s.API_URL,
    anonKey: s.ANON_KEY,
    serviceKey: s.SERVICE_ROLE_KEY,
    dbUrl: s.DB_URL,
  }
  return cached
}
```

- [ ] **Step 5: Escribir el arnés de clientes**

Crear `tests/db/client.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseEnv } from './env'

/** Cliente con service_role: evita RLS. Para preparar datos de prueba. */
export function serviceClient(): SupabaseClient {
  const { url, serviceKey } = supabaseEnv()
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Cliente autenticado como un usuario real. Es el camino que recorre el SPA. */
export async function userClient(email: string, password: string): Promise<SupabaseClient> {
  const { url, anonKey } = supabaseEnv()
  const c = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`No se pudo autenticar ${email}: ${error.message}`)
  return c
}

/** Crea un usuario en auth y su fila en profiles. Devuelve el id. */
export async function createUser(
  email: string,
  password: string,
  role: 'operator' | 'client_user',
): Promise<string> {
  const svc = serviceClient()
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`No se pudo crear ${email}: ${error.message}`)
  const id = data.user!.id
  const { error: pErr } = await svc.from('profiles').insert({ id, email, role })
  if (pErr) throw new Error(`No se pudo crear el perfil de ${email}: ${pErr.message}`)
  return id
}

/**
 * Deja la base limpia entre pruebas.
 *
 * Vía SQL directo y no por la API REST: `client_members` tiene clave primaria
 * compuesta (sin columna `id`) y varias tablas usan `bigserial`, así que un
 * `.delete().neq('id', ...)` genérico falla o compara tipos incompatibles.
 * TRUNCATE resuelve las tres cosas de una vez y reinicia las secuencias.
 */
export async function resetData(): Promise<void> {
  const { dbUrl } = supabaseEnv()
  const pg = new Client({ connectionString: dbUrl })
  await pg.connect()
  try {
    await pg.query(`
      truncate table
        public.action_runs, public.agent_actions, public.usage_events,
        public.extracted_values, public.transcript_turns, public.runs,
        public.run_raw_events, public.field_defs, public.agent_intents,
        public.agents, public.client_members, public.clients, public.profiles
      restart identity cascade
    `)
  } finally {
    await pg.end()
  }

  // Los usuarios viven en el schema auth, fuera del truncate.
  const svc = serviceClient()
  const { data } = await svc.auth.admin.listUsers()
  for (const u of data?.users ?? []) await svc.auth.admin.deleteUser(u.id)
}

/**
 * Aplica supabase/seed.sql. Necesario porque `resetData` borra la semilla que
 * `db reset` había insertado, y las pruebas de semilla deben poder correr en
 * cualquier orden respecto a las demás.
 */
export async function applySeed(): Promise<void> {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/seed.sql'), 'utf8')
  const { dbUrl } = supabaseEnv()
  const pg = new Client({ connectionString: dbUrl })
  await pg.connect()
  try {
    await pg.query(sql)
  } finally {
    await pg.end()
  }
}
```

- [ ] **Step 6: Configurar Vitest**

Crear `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Las pruebas comparten una sola base; en paralelo se pisan entre sí.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
```

Añadir a `package.json` en `"scripts"`:

```json
"db:start": "supabase start",
"db:stop": "supabase stop",
"db:reset": "supabase db reset",
"db:types": "supabase gen types typescript --local > src/lib/database.types.ts",
"test:db": "vitest run"
```

- [ ] **Step 7: Escribir la prueba de humo (debe fallar)**

Crear `tests/db/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { serviceClient } from './client'

describe('instancia local', () => {
  it('responde y todavía no tiene la tabla clients', async () => {
    const { error } = await serviceClient().from('clients').select('id').limit(1)
    expect(error?.message).toMatch(/relation .* does not exist|Could not find the table/)
  })
})
```

- [ ] **Step 8: Ejecutar la prueba**

Run: `npm run test:db`
Expected: PASS. Confirma dos cosas a la vez: que hay conexión real y que el esquema todavía no existe — el punto de partida correcto.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts .gitignore supabase/ tests/
git commit -m "chore: supabase local y arnés de pruebas contra Postgres real"
```

---

### Task 2: Esquema de tenencia

Las tres tablas que hacen posible el punto 1 de Luis: cada dato nace con dueño.

**Files:**
- Create: `supabase/migrations/20260802000100_tenancy.sql`
- Create: `tests/db/tenancy.test.ts`

**Interfaces:**
- Consumes: `serviceClient`, `createUser`, `resetData` (Task 1)
- Produces: tablas `clients`, `profiles`, `client_members`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/db/tenancy.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, createUser, resetData } from './client'

describe('tenencia', () => {
  beforeEach(resetData)

  it('crea un cliente con estado por defecto onboarding', async () => {
    const { data, error } = await serviceClient()
      .from('clients')
      .insert({ name: 'Magen Insurance', industry: 'Insurance' })
      .select()
      .single()
    expect(error).toBeNull()
    expect(data!.status).toBe('onboarding')
    expect(data!.timezone).toBe('America/New_York')
  })

  it('rechaza un estado inválido', async () => {
    const { error } = await serviceClient()
      .from('clients')
      .insert({ name: 'X', industry: 'Y', status: 'zombie' })
    expect(error).not.toBeNull()
  })

  it('vincula un usuario a un cliente', async () => {
    const svc = serviceClient()
    const { data: client } = await svc
      .from('clients').insert({ name: 'Magen', industry: 'Insurance' }).select().single()
    const userId = await createUser('luis@magen.test', 'secret123', 'client_user')

    const { error } = await svc
      .from('client_members')
      .insert({ profile_id: userId, client_id: client!.id, role: 'owner' })
    expect(error).toBeNull()
  })

  it('borra la membresía al borrar el cliente', async () => {
    const svc = serviceClient()
    const { data: client } = await svc
      .from('clients').insert({ name: 'Temp', industry: 'Logistics' }).select().single()
    const userId = await createUser('temp@x.test', 'secret123', 'client_user')
    await svc.from('client_members').insert({ profile_id: userId, client_id: client!.id })

    await svc.from('clients').delete().eq('id', client!.id)

    const { data } = await svc.from('client_members').select().eq('profile_id', userId)
    expect(data).toEqual([])
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/db/tenancy.test.ts`
Expected: FAIL — las tablas no existen.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/20260802000100_tenancy.sql`:

```sql
-- Negocios cliente de la plataforma.
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text not null,
  status text not null default 'onboarding'
    check (status in ('active','paused','onboarding')),
  timezone text not null default 'America/New_York',
  contact_name text,
  contact_email text,
  notes text,
  created_at timestamptz not null default now()
);

-- Extiende auth.users con el rol de plataforma.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text not null,
  role text not null check (role in ('operator','client_user')),
  created_at timestamptz not null default now()
);

-- Qué usuario pertenece a qué cliente. Base de los dashboards por cliente.
create table public.client_members (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  client_id  uuid not null references public.clients(id)  on delete cascade,
  role text not null default 'viewer' check (role in ('owner','viewer')),
  created_at timestamptz not null default now(),
  primary key (profile_id, client_id)
);

create index client_members_client_id_idx on public.client_members (client_id);
```

- [ ] **Step 4: Aplicar y ejecutar las pruebas**

```bash
npx supabase db reset
npx vitest run tests/db/tenancy.test.ts
```

Expected: PASS, 4 pruebas.

> `db reset` reaplica todas las migraciones desde cero. Es el comando a usar siempre tras añadir una migración: garantiza que la secuencia completa funciona en una base virgen, que es lo que ocurrirá en producción.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260802000100_tenancy.sql tests/db/tenancy.test.ts
git commit -m "feat(db): esquema de tenencia con clientes, perfiles y membresías"
```

---

### Task 3: Esquema de agentes y campos configurables

Aquí vive la exigencia de Luis de que nada sea específico de seguros. `field_defs.intent_id` nullable es la bisagra que permite añadir motivos después sin migrar.

**Files:**
- Create: `supabase/migrations/20260802000200_agents.sql`
- Create: `tests/db/agents.test.ts`

**Interfaces:**
- Consumes: `clients` (Task 2)
- Produces: tablas `agents`, `agent_intents`, `field_defs`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/db/agents.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from './client'

async function makeClient() {
  const { data } = await serviceClient()
    .from('clients').insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  return data!.id as string
}

async function makeAgent(clientId: string) {
  const { data } = await serviceClient()
    .from('agents')
    .insert({
      client_id: clientId, module_type: 'voice', name: 'Intake general',
      provider: 'vapi', channel: '+13125550142',
    })
    .select().single()
  return data!.id as string
}

describe('agentes y campos', () => {
  beforeEach(resetData)

  it('crea un agente pausado por defecto', async () => {
    const clientId = await makeClient()
    const { data, error } = await serviceClient()
      .from('agents')
      .insert({ client_id: clientId, module_type: 'voice', name: 'Intake', provider: 'vapi' })
      .select().single()
    expect(error).toBeNull()
    expect(data!.status).toBe('paused')
    expect(data!.extraction_version).toBe(1)
  })

  it('acepta campos universales con intent_id nulo', async () => {
    const agentId = await makeAgent(await makeClient())
    const { error } = await serviceClient().from('field_defs').insert({
      agent_id: agentId, key: 'caller_name', label: 'Nombre',
      type: 'text', required: true, sort_order: 0,
    })
    expect(error).toBeNull()
  })

  // La prueba que justifica `nulls not distinct`: sin eso, Postgres considera
  // distintos dos NULL y permitiría duplicar un campo universal.
  it('impide dos campos universales con la misma clave', async () => {
    const agentId = await makeAgent(await makeClient())
    const row = { agent_id: agentId, key: 'caller_name', label: 'Nombre', type: 'text' }
    await serviceClient().from('field_defs').insert(row)
    const { error } = await serviceClient().from('field_defs').insert(row)
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23505')
  })

  it('permite la misma clave en dos motivos distintos', async () => {
    const agentId = await makeAgent(await makeClient())
    const svc = serviceClient()
    const { data: a } = await svc.from('agent_intents')
      .insert({ agent_id: agentId, key: 'cancelacion', label: 'Cancelación' }).select().single()
    const { data: b } = await svc.from('agent_intents')
      .insert({ agent_id: agentId, key: 'cotizacion', label: 'Cotización' }).select().single()

    await svc.from('field_defs').insert({
      agent_id: agentId, intent_id: a!.id, key: 'effective_date', label: 'Fecha', type: 'date',
    })
    const { error } = await svc.from('field_defs').insert({
      agent_id: agentId, intent_id: b!.id, key: 'effective_date', label: 'Fecha', type: 'date',
    })
    expect(error).toBeNull()
  })

  it('rechaza un tipo de campo desconocido', async () => {
    const agentId = await makeAgent(await makeClient())
    const { error } = await serviceClient().from('field_defs').insert({
      agent_id: agentId, key: 'x', label: 'X', type: 'telepatia',
    })
    expect(error).not.toBeNull()
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/db/agents.test.ts`
Expected: FAIL — no existe la tabla `agents`.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/20260802000200_agents.sql`:

```sql
-- Un agente es un canal (número, inbox) más un prompt y los campos que captura.
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  module_type text not null check (module_type in ('voice','email','sms','documents')),
  name text not null,
  description text,
  channel text,                       -- número E.164 o dirección
  provider text not null check (provider in ('vapi','retell','custom')),
  provider_agent_id text,             -- id del assistant en el proveedor
  status text not null default 'paused' check (status in ('active','paused')),
  system_prompt text not null default '',
  extraction_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agents_client_id_idx on public.agents (client_id);

-- Un agente por assistant del proveedor. Parcial: provider_agent_id es nulo
-- hasta que el agente se aprovisiona.
create unique index agents_provider_assistant_uniq
  on public.agents (provider, provider_agent_id)
  where provider_agent_id is not null;

-- Motivos de llamada. Vacío en v1: el esquema los soporta desde ya.
create table public.agent_intents (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (agent_id, key)
);

-- Qué debe capturar el agente. intent_id nulo = campo universal.
create table public.field_defs (
  id uuid primary key default gen_random_uuid(),
  agent_id  uuid not null references public.agents(id) on delete cascade,
  intent_id uuid references public.agent_intents(id) on delete cascade,
  key text not null,
  label text not null,
  type text not null check (type in ('text','number','boolean','date','select','phone')),
  required boolean not null default false,
  description text,
  options jsonb,                      -- solo para type = 'select'
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  -- `nulls not distinct` (PG15+) es imprescindible: sin él, dos campos
  -- universales con la misma clave no colisionarían.
  constraint field_defs_agent_intent_key_uniq
    unique nulls not distinct (agent_id, intent_id, key)
);

create index field_defs_agent_id_idx on public.field_defs (agent_id);
```

- [ ] **Step 4: Aplicar y ejecutar**

```bash
npx supabase db reset
npx vitest run tests/db/agents.test.ts
```

Expected: PASS, 5 pruebas. Si la tercera falla con "duplicate key" ausente, la versión de Postgres es anterior a 15: revisar `supabase/config.toml` y subir `major_version`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260802000200_agents.sql tests/db/agents.test.ts
git commit -m "feat(db): agentes, motivos y campos configurables por agente"
```

---

### Task 4: Esquema de ejecuciones

El crudo inmutable y la proyección. La idempotencia se prueba aquí porque es lo que impide cobrar dos veces la misma llamada.

**Files:**
- Create: `supabase/migrations/20260802000300_runs.sql`
- Create: `tests/db/runs.test.ts`

**Interfaces:**
- Consumes: `clients`, `agents`
- Produces: tablas `run_raw_events`, `runs`, `transcript_turns`, `extracted_values`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/db/runs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from './client'

async function makeAgentAndClient() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents')
    .insert({ client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi' })
    .select().single()
  return { clientId: c!.id as string, agentId: a!.id as string }
}

function runRow(clientId: string, agentId: string, callId: string) {
  return {
    client_id: clientId, agent_id: agentId, provider: 'vapi',
    provider_call_id: callId, started_at: new Date().toISOString(),
    status: 'completed',
  }
}

describe('ejecuciones', () => {
  beforeEach(resetData)

  it('guarda un evento crudo con su payload íntegro', async () => {
    const { error } = await serviceClient().from('run_raw_events').insert({
      provider: 'vapi', provider_call_id: 'call_1',
      event_type: 'end-of-call-report',
      payload: { message: { type: 'end-of-call-report', cost: 0.42 } },
      signature_verified: true,
    })
    expect(error).toBeNull()
  })

  // Vapi reintenta los webhooks: el mismo evento puede llegar dos veces.
  it('rechaza el mismo evento crudo dos veces', async () => {
    const row = {
      provider: 'vapi', provider_call_id: 'call_1',
      event_type: 'end-of-call-report', payload: {},
    }
    await serviceClient().from('run_raw_events').insert(row)
    const { error } = await serviceClient().from('run_raw_events').insert(row)
    expect(error!.code).toBe('23505')
  })

  it('rechaza dos runs para la misma llamada del proveedor', async () => {
    const { clientId, agentId } = await makeAgentAndClient()
    await serviceClient().from('runs').insert(runRow(clientId, agentId, 'call_9'))
    const { error } = await serviceClient().from('runs').insert(runRow(clientId, agentId, 'call_9'))
    expect(error!.code).toBe('23505')
  })

  it('arranca con extraction_status pendiente', async () => {
    const { clientId, agentId } = await makeAgentAndClient()
    const { data } = await serviceClient()
      .from('runs').insert(runRow(clientId, agentId, 'call_2')).select().single()
    expect(data!.extraction_status).toBe('pending')
    expect(data!.direction).toBe('inbound')
  })

  it('conserva dos versiones de extracción del mismo campo', async () => {
    const { clientId, agentId } = await makeAgentAndClient()
    const svc = serviceClient()
    const { data: run } = await svc
      .from('runs').insert(runRow(clientId, agentId, 'call_3')).select().single()

    await svc.from('extracted_values').insert({
      run_id: run!.id, field_key: 'caller_name', value_text: 'Jon', extraction_version: 1,
    })
    const { error } = await svc.from('extracted_values').insert({
      run_id: run!.id, field_key: 'caller_name', value_text: 'John', extraction_version: 2,
    })
    expect(error).toBeNull()

    const { data } = await svc.from('extracted_values').select().eq('run_id', run!.id)
    expect(data).toHaveLength(2)
  })

  it('borra turnos y valores al borrar el run', async () => {
    const { clientId, agentId } = await makeAgentAndClient()
    const svc = serviceClient()
    const { data: run } = await svc
      .from('runs').insert(runRow(clientId, agentId, 'call_4')).select().single()
    await svc.from('transcript_turns').insert({
      run_id: run!.id, seq: 1, speaker: 'agent', text: 'Buenas noches, Magen Insurance.',
    })

    await svc.from('runs').delete().eq('id', run!.id)

    const { data } = await svc.from('transcript_turns').select().eq('run_id', run!.id)
    expect(data).toEqual([])
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/db/runs.test.ts`
Expected: FAIL — no existen las tablas.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/20260802000300_runs.sql`:

```sql
-- Payload íntegro tal como llegó del proveedor. Append-only: es la fuente de
-- verdad que permite reprocesar llamadas viejas con mejores prompts.
create table public.run_raw_events (
  id bigserial primary key,
  provider text not null,
  provider_call_id text,
  event_type text not null,
  payload jsonb not null,
  signature_verified boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  -- Idempotencia: el proveedor reintenta los webhooks.
  constraint run_raw_events_idempotency
    unique nulls not distinct (provider, provider_call_id, event_type)
);

create index run_raw_events_unprocessed_idx
  on public.run_raw_events (received_at)
  where processed_at is null;

-- Proyección canónica de una ejecución. Neutra respecto al proveedor.
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  agent_id  uuid not null references public.agents(id),
  provider text not null,
  provider_call_id text not null,
  direction text not null default 'inbound' check (direction in ('inbound','outbound')),
  caller_number text,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_sec int,
  status text not null check (status in ('in_progress','completed','failed','no_answer')),
  ended_reason text,
  recording_url text,
  summary text,
  reason_category text,               -- copia desnormalizada para filtrar
  urgency text,                       -- idem
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','complete','partial','failed')),
  extraction_version int,
  latency_ms int,
  created_at timestamptz not null default now(),
  unique (provider, provider_call_id)
);

create index runs_client_started_idx on public.runs (client_id, started_at desc);
create index runs_agent_started_idx  on public.runs (agent_id,  started_at desc);

create table public.transcript_turns (
  id bigserial primary key,
  run_id uuid not null references public.runs(id) on delete cascade,
  seq int not null,
  speaker text not null check (speaker in ('agent','caller')),
  text text not null,
  offset_ms int,
  unique (run_id, seq)
);

-- Clave-valor a propósito: cambiar los campos de un agente nunca altera el esquema.
create table public.extracted_values (
  id bigserial primary key,
  run_id uuid not null references public.runs(id) on delete cascade,
  field_key text not null,
  intent_key text,
  value_text text,
  confidence numeric(4,3),
  extraction_version int not null,
  created_at timestamptz not null default now(),
  unique (run_id, field_key, extraction_version)
);

create index extracted_values_run_idx on public.extracted_values (run_id);
```

- [ ] **Step 4: Aplicar y ejecutar**

```bash
npx supabase db reset
npx vitest run tests/db/runs.test.ts
```

Expected: PASS, 6 pruebas.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260802000300_runs.sql tests/db/runs.test.ts
git commit -m "feat(db): eventos crudos, runs, transcripciones y valores extraídos"
```

---

### Task 5: Ledger de usage y costo

El punto 2 de Luis. Append-only y con costo y precio separados.

**Files:**
- Create: `supabase/migrations/20260802000400_usage.sql`
- Create: `tests/db/usage.test.ts`

**Interfaces:**
- Consumes: `clients`, `agents`, `runs`
- Produces: tabla `usage_events`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/db/usage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from './client'

async function setup() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents')
    .insert({ client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi' })
    .select().single()
  const { data: r } = await svc.from('runs').insert({
    client_id: c!.id, agent_id: a!.id, provider: 'vapi', provider_call_id: 'call_u1',
    started_at: new Date().toISOString(), status: 'completed',
  }).select().single()
  return { clientId: c!.id as string, agentId: a!.id as string, runId: r!.id as string }
}

describe('ledger de usage', () => {
  beforeEach(resetData)

  it('registra costo por componente sin precio todavía', async () => {
    const { clientId, agentId, runId } = await setup()
    const { data, error } = await serviceClient().from('usage_events').insert({
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', component: 'llm', quantity: 1420, unit: 'tokens',
      cost_usd: 0.004260, source_event_id: 'evt_1',
      occurred_at: new Date().toISOString(),
    }).select().single()

    expect(error).toBeNull()
    expect(Number(data!.cost_usd)).toBeCloseTo(0.00426, 6)
    expect(data!.billed_usd).toBeNull()   // no hay planes todavía
    expect(data!.reconciled).toBe(false)
  })

  // Reprocesar una llamada no debe volver a cobrarla.
  it('rechaza el mismo evento de costo dos veces', async () => {
    const { clientId, agentId, runId } = await setup()
    const row = {
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', component: 'telephony', quantity: 4.5, unit: 'minutes',
      cost_usd: 0.045, source_event_id: 'evt_dup', occurred_at: new Date().toISOString(),
    }
    await serviceClient().from('usage_events').insert(row)
    const { error } = await serviceClient().from('usage_events').insert(row)
    expect(error!.code).toBe('23505')
  })

  it('acepta el mismo evento para componentes distintos', async () => {
    const { clientId, agentId, runId } = await setup()
    const base = {
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', quantity: 1, unit: 'minutes' as const,
      source_event_id: 'evt_multi', occurred_at: new Date().toISOString(),
    }
    await serviceClient().from('usage_events').insert({ ...base, component: 'stt', cost_usd: 0.01 })
    const { error } = await serviceClient()
      .from('usage_events').insert({ ...base, component: 'tts', cost_usd: 0.02 })
    expect(error).toBeNull()
  })

  it('permite costo nulo cuando el proveedor no lo reporta', async () => {
    const { clientId, agentId, runId } = await setup()
    const { error } = await serviceClient().from('usage_events').insert({
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', component: 'other', quantity: 1, unit: 'calls',
      cost_usd: null, source_event_id: 'evt_nocost',
      occurred_at: new Date().toISOString(),
    })
    expect(error).toBeNull()
  })

  it('agrega costo por cliente y módulo', async () => {
    const { clientId, agentId, runId } = await setup()
    const svc = serviceClient()
    const base = {
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', quantity: 1, unit: 'minutes' as const,
      occurred_at: new Date().toISOString(),
    }
    await svc.from('usage_events').insert([
      { ...base, component: 'telephony', cost_usd: 0.10, source_event_id: 'a' },
      { ...base, component: 'llm',       cost_usd: 0.25, source_event_id: 'b' },
      { ...base, component: 'tts',       cost_usd: 0.15, source_event_id: 'c' },
    ])

    const { data } = await svc.from('usage_events')
      .select('cost_usd').eq('client_id', clientId).eq('module_type', 'voice')
    const total = data!.reduce((sum, r) => sum + Number(r.cost_usd), 0)
    expect(total).toBeCloseTo(0.5, 6)
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/db/usage.test.ts`
Expected: FAIL — no existe `usage_events`.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/20260802000400_usage.sql`:

```sql
-- Ledger append-only. Nunca se actualiza ni se borra: es el respaldo auditable
-- del costo y la base para calcular márgenes cuando existan planes.
create table public.usage_events (
  id bigserial primary key,
  client_id uuid not null references public.clients(id),
  agent_id  uuid references public.agents(id),
  module_type text not null,
  run_id uuid references public.runs(id),
  provider text not null,
  component text not null check (component in ('telephony','stt','llm','tts','other')),
  quantity numeric not null,
  unit text not null check (unit in ('minutes','tokens','characters','calls')),
  cost_usd   numeric(12,6),           -- lo que nos cuesta
  billed_usd numeric(12,6),           -- lo que cobramos; nulo hasta que haya planes
  currency text not null default 'USD',
  source_event_id text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  reconciled boolean not null default false,
  -- Un evento del proveedor produce como mucho un cargo por componente.
  constraint usage_events_idempotency
    unique nulls not distinct (provider, source_event_id, component)
);

create index usage_events_client_time_idx on public.usage_events (client_id, occurred_at desc);
create index usage_events_agent_time_idx  on public.usage_events (agent_id,  occurred_at desc);
create index usage_events_run_idx         on public.usage_events (run_id);
create index usage_events_unreconciled_idx on public.usage_events (occurred_at) where not reconciled;
```

- [ ] **Step 4: Aplicar y ejecutar**

```bash
npx supabase db reset
npx vitest run tests/db/usage.test.ts
```

Expected: PASS, 5 pruebas.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260802000400_usage.sql tests/db/usage.test.ts
git commit -m "feat(db): ledger append-only de usage con costo y precio separados"
```

---

### Task 6: Acciones configurables

Los workflows como datos. El correo es solo el primer tipo.

**Files:**
- Create: `supabase/migrations/20260802000500_actions.sql`
- Create: `tests/db/actions.test.ts`

**Interfaces:**
- Consumes: `agents`, `runs`
- Produces: tablas `agent_actions`, `action_runs`

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/db/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from './client'

async function setup() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents')
    .insert({ client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi' })
    .select().single()
  return { clientId: c!.id as string, agentId: a!.id as string }
}

describe('acciones', () => {
  beforeEach(resetData)

  it('configura un correo por llamada con destinatarios', async () => {
    const { agentId } = await setup()
    const { data, error } = await serviceClient().from('agent_actions').insert({
      agent_id: agentId, type: 'email_per_run',
      config: { recipients: ['frontdesk@magen.test'] },
    }).select().single()

    expect(error).toBeNull()
    expect(data!.enabled).toBe(true)
    expect(data!.condition).toBeNull()   // sin condición = siempre
    expect(data!.config.recipients).toEqual(['frontdesk@magen.test'])
  })

  it('acepta una condición para disparar solo en urgentes', async () => {
    const { agentId } = await setup()
    const { data, error } = await serviceClient().from('agent_actions').insert({
      agent_id: agentId, type: 'webhook',
      config: { url: 'https://crm.magen.test/hook' },
      condition: { urgency: 'urgente' },
    }).select().single()

    expect(error).toBeNull()
    expect(data!.condition).toEqual({ urgency: 'urgente' })
  })

  it('rechaza un tipo de acción desconocido', async () => {
    const { agentId } = await setup()
    const { error } = await serviceClient()
      .from('agent_actions').insert({ agent_id: agentId, type: 'paloma_mensajera' })
    expect(error).not.toBeNull()
  })

  it('registra un intento fallido con su error', async () => {
    const { clientId, agentId } = await setup()
    const svc = serviceClient()
    const { data: action } = await svc.from('agent_actions')
      .insert({ agent_id: agentId, type: 'email_per_run', config: {} }).select().single()

    const { data, error } = await svc.from('action_runs').insert({
      action_id: action!.id, client_id: clientId, agent_id: agentId,
      type: 'email_per_run', status: 'failed',
      error: 'Resend respondió 429', attempt: 2,
    }).select().single()

    expect(error).toBeNull()
    expect(data!.attempt).toBe(2)
  })

  // El histórico de ejecuciones sobrevive al borrado de su configuración.
  it('conserva el registro si se borra la acción', async () => {
    const { clientId, agentId } = await setup()
    const svc = serviceClient()
    const { data: action } = await svc.from('agent_actions')
      .insert({ agent_id: agentId, type: 'email_per_run', config: {} }).select().single()
    await svc.from('action_runs').insert({
      action_id: action!.id, client_id: clientId, agent_id: agentId,
      type: 'email_per_run', status: 'sent',
    })

    await svc.from('agent_actions').delete().eq('id', action!.id)

    const { data } = await svc.from('action_runs').select().eq('agent_id', agentId)
    expect(data).toHaveLength(1)
    expect(data![0].action_id).toBeNull()
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/db/actions.test.ts`
Expected: FAIL — no existe `agent_actions`.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/20260802000500_actions.sql`:

```sql
-- Qué ocurre al terminar una ejecución. Es configuración, no código: añadir
-- una integración futura es insertar una fila.
create table public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  type text not null check (type in ('email_per_run','email_digest','webhook')),
  config jsonb not null default '{}'::jsonb,   -- destinatarios, hora, url, cabeceras
  condition jsonb,                             -- nulo = siempre
  enabled boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index agent_actions_enabled_idx on public.agent_actions (agent_id) where enabled;

-- Registro append-only de cada ejecución de acción. action_id queda nulo si la
-- configuración se borra: el histórico no se pierde.
create table public.action_runs (
  id bigserial primary key,
  action_id uuid references public.agent_actions(id) on delete set null,
  client_id uuid not null references public.clients(id),
  agent_id  uuid not null references public.agents(id),
  run_id    uuid references public.runs(id) on delete cascade,
  type text not null,
  status text not null check (status in ('sent','failed','skipped')),
  detail jsonb,
  error text,
  attempt int not null default 1,
  executed_at timestamptz not null default now()
);

create index action_runs_run_idx    on public.action_runs (run_id);
create index action_runs_failed_idx on public.action_runs (executed_at) where status = 'failed';
```

- [ ] **Step 4: Aplicar y ejecutar**

```bash
npx supabase db reset
npx vitest run tests/db/actions.test.ts
```

Expected: PASS, 5 pruebas.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260802000500_actions.sql tests/db/actions.test.ts
git commit -m "feat(db): acciones configurables por agente y su registro de ejecución"
```

---

### Task 7: Seguridad a nivel de fila

La tarea de mayor valor del plan. Si esto falla, un cliente ve los datos de otro.

**Files:**
- Create: `supabase/migrations/20260802000600_rls.sql`
- Create: `tests/db/rls.test.ts`

**Interfaces:**
- Consumes: todas las tablas anteriores
- Produces: funciones `public.is_operator()`, `public.has_client_access(uuid)`; RLS activa en todas las tablas

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/db/rls.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { serviceClient, userClient, createUser, resetData } from './client'
import type { SupabaseClient } from '@supabase/supabase-js'

let magenId: string, otroId: string
let magenAgentId: string
let operador: SupabaseClient
let usuarioMagen: SupabaseClient

beforeAll(async () => {
  await resetData()
  const svc = serviceClient()

  const { data: m } = await svc.from('clients')
    .insert({ name: 'Magen Insurance', industry: 'Insurance' }).select().single()
  const { data: o } = await svc.from('clients')
    .insert({ name: 'Cargoline', industry: 'Logistics' }).select().single()
  magenId = m!.id; otroId = o!.id

  const { data: a } = await svc.from('agents')
    .insert({ client_id: magenId, module_type: 'voice', name: 'Intake', provider: 'vapi' })
    .select().single()
  magenAgentId = a!.id

  // Un run y un costo para cada cliente.
  for (const [cid, call] of [[magenId, 'call_m'], [otroId, 'call_o']] as const) {
    const { data: ag } = await svc.from('agents')
      .insert({ client_id: cid, module_type: 'voice', name: 'A', provider: 'vapi' })
      .select().single()
    const { data: run } = await svc.from('runs').insert({
      client_id: cid, agent_id: ag!.id, provider: 'vapi', provider_call_id: call,
      started_at: new Date().toISOString(), status: 'completed',
    }).select().single()
    await svc.from('usage_events').insert({
      client_id: cid, agent_id: ag!.id, module_type: 'voice', run_id: run!.id,
      provider: 'vapi', component: 'llm', quantity: 100, unit: 'tokens',
      cost_usd: 0.05, source_event_id: `evt_${call}`, occurred_at: new Date().toISOString(),
    })
  }

  const opId = await createUser('operador@switchboard.test', 'secret123', 'operator')
  const cuId = await createUser('luis@magen.test', 'secret123', 'client_user')
  await svc.from('client_members').insert({ profile_id: cuId, client_id: magenId, role: 'owner' })
  void opId

  operador = await userClient('operador@switchboard.test', 'secret123')
  usuarioMagen = await userClient('luis@magen.test', 'secret123')
})

describe('RLS — operador', () => {
  it('ve todos los clientes', async () => {
    const { data } = await operador.from('clients').select('id')
    expect(data).toHaveLength(2)
  })

  it('ve los costos internos', async () => {
    const { data } = await operador.from('usage_events').select('cost_usd')
    expect(data!.length).toBe(2)
  })
})

describe('RLS — usuario de cliente', () => {
  it('ve solo su propio cliente', async () => {
    const { data } = await usuarioMagen.from('clients').select('id, name')
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(magenId)
  })

  it('no ve los runs de otro cliente', async () => {
    const { data } = await usuarioMagen.from('runs').select('client_id')
    expect(data!.every(r => r.client_id === magenId)).toBe(true)
    expect(data!.length).toBe(1)
  })

  // El costo interno no se expone jamás a un cliente.
  it('no lee ninguna fila de usage_events, ni la suya', async () => {
    const { data } = await usuarioMagen.from('usage_events').select('cost_usd')
    expect(data).toEqual([])
  })

  it('no lee los eventos crudos del proveedor', async () => {
    const { data } = await usuarioMagen.from('run_raw_events').select('id')
    expect(data).toEqual([])
  })

  it('no puede crear agentes', async () => {
    const { error } = await usuarioMagen.from('agents').insert({
      client_id: magenId, module_type: 'voice', name: 'Pirata', provider: 'vapi',
    })
    expect(error).not.toBeNull()
  })

  it('no puede añadirse a otro cliente', async () => {
    const { data: me } = await usuarioMagen.auth.getUser()
    const { error } = await usuarioMagen.from('client_members')
      .insert({ profile_id: me.user!.id, client_id: otroId })
    expect(error).not.toBeNull()
  })

  it('no ve los campos configurados de otro cliente', async () => {
    const svc = serviceClient()
    const { data: otroAgent } = await svc.from('agents').select('id').eq('client_id', otroId).limit(1)
    await svc.from('field_defs').insert({
      agent_id: otroAgent![0].id, key: 'secreto', label: 'Secreto', type: 'text',
    })
    await svc.from('field_defs').insert({
      agent_id: magenAgentId, key: 'caller_name', label: 'Nombre', type: 'text',
    })

    const { data } = await usuarioMagen.from('field_defs').select('key')
    expect(data!.map(f => f.key)).toEqual(['caller_name'])
  })
})

describe('RLS — anónimo', () => {
  it('no ve absolutamente nada', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const { supabaseEnv } = await import('./env')
    const { url, anonKey } = supabaseEnv()
    const anon = createClient(url, anonKey, { auth: { persistSession: false } })
    const { data } = await anon.from('clients').select('id')
    expect(data).toEqual([])
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx vitest run tests/db/rls.test.ts`
Expected: FAIL — sin RLS, el usuario de cliente ve los 2 clientes en vez de 1.

> Este fallo es la demostración de por qué la tarea existe: hoy cualquiera con la clave anónima lee todo.

- [ ] **Step 3: Escribir la migración**

Crear `supabase/migrations/20260802000600_rls.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Funciones auxiliares
--
-- `security definer` es imprescindible: is_operator() consulta profiles, que a
-- su vez tiene RLS. Sin definer, la política de profiles se evaluaría a sí
-- misma en bucle infinito.
-- ---------------------------------------------------------------------------
create or replace function public.is_operator()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'operator'
  );
$$;

create or replace function public.has_client_access(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_operator() or exists (
    select 1 from public.client_members
    where profile_id = auth.uid() and client_id = cid
  );
$$;

revoke execute on function public.is_operator() from anon;
revoke execute on function public.has_client_access(uuid) from anon;

-- ---------------------------------------------------------------------------
-- RLS en todas las tablas. Sin política = sin acceso: service_role la evita
-- por diseño, que es como escriben las Edge Functions.
-- ---------------------------------------------------------------------------
alter table public.clients          enable row level security;
alter table public.profiles         enable row level security;
alter table public.client_members   enable row level security;
alter table public.agents           enable row level security;
alter table public.agent_intents    enable row level security;
alter table public.field_defs       enable row level security;
alter table public.runs             enable row level security;
alter table public.transcript_turns enable row level security;
alter table public.extracted_values enable row level security;
alter table public.usage_events     enable row level security;
alter table public.run_raw_events   enable row level security;
alter table public.agent_actions    enable row level security;
alter table public.action_runs      enable row level security;

-- Clientes
create policy clients_select on public.clients
  for select to authenticated using (public.has_client_access(id));
create policy clients_write on public.clients
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- Perfiles: cada quien el suyo; el operador todos.
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_operator());
create policy profiles_write on public.profiles
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- Membresías: solo el operador las administra.
create policy client_members_select on public.client_members
  for select to authenticated using (profile_id = auth.uid() or public.is_operator());
create policy client_members_write on public.client_members
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- Configuración de agentes: lectura por pertenencia, escritura solo operador.
create policy agents_select on public.agents
  for select to authenticated using (public.has_client_access(client_id));
create policy agents_write on public.agents
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

create policy agent_intents_select on public.agent_intents
  for select to authenticated using (exists (
    select 1 from public.agents a
    where a.id = agent_id and public.has_client_access(a.client_id)
  ));
create policy agent_intents_write on public.agent_intents
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

create policy field_defs_select on public.field_defs
  for select to authenticated using (exists (
    select 1 from public.agents a
    where a.id = agent_id and public.has_client_access(a.client_id)
  ));
create policy field_defs_write on public.field_defs
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

-- Ejecuciones: lectura por pertenencia. La escritura es de service_role.
create policy runs_select on public.runs
  for select to authenticated using (public.has_client_access(client_id));

create policy transcript_turns_select on public.transcript_turns
  for select to authenticated using (exists (
    select 1 from public.runs r
    where r.id = run_id and public.has_client_access(r.client_id)
  ));

create policy extracted_values_select on public.extracted_values
  for select to authenticated using (exists (
    select 1 from public.runs r
    where r.id = run_id and public.has_client_access(r.client_id)
  ));

-- Costo interno y payloads del proveedor: SOLO operadores, jamás un cliente.
create policy usage_events_select on public.usage_events
  for select to authenticated using (public.is_operator());

create policy run_raw_events_select on public.run_raw_events
  for select to authenticated using (public.is_operator());

-- Acciones
create policy agent_actions_select on public.agent_actions
  for select to authenticated using (exists (
    select 1 from public.agents a
    where a.id = agent_id and public.has_client_access(a.client_id)
  ));
create policy agent_actions_write on public.agent_actions
  for all to authenticated using (public.is_operator()) with check (public.is_operator());

create policy action_runs_select on public.action_runs
  for select to authenticated using (public.has_client_access(client_id));
```

- [ ] **Step 4: Aplicar y ejecutar toda la suite**

```bash
npx supabase db reset
npm run test:db
```

Expected: PASS en todos los archivos. Las pruebas previas siguen pasando porque usan `service_role`, que evita RLS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260802000600_rls.sql tests/db/rls.test.ts
git commit -m "feat(db): RLS con aislamiento entre clientes y costos solo para operadores"
```

---

### Task 8: Semilla de Magen

Deja la base utilizable: el cliente real, su agente de intake, los ocho campos universales del spec y la acción de correo.

**Files:**
- Create: `supabase/seed.sql`
- Create: `tests/db/seed.test.ts`

**Interfaces:**
- Consumes: todo el esquema
- Produces: cliente `Magen Insurance Inc` con un agente `voice` y 8 `field_defs` universales

- [ ] **Step 1: Escribir la prueba (debe fallar)**

Crear `tests/db/seed.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { serviceClient, resetData, applySeed } from './client'

// Aplica la semilla explícitamente: las otras pruebas llaman resetData y
// borrarían la que insertó `db reset`, según el orden en que corran.
beforeAll(async () => {
  await resetData()
  await applySeed()
})

describe('semilla', () => {
  it('crea a Magen activo', async () => {
    const { data } = await serviceClient()
      .from('clients').select().eq('name', 'Magen Insurance Inc').single()
    expect(data!.status).toBe('active')
    expect(data!.industry).toBe('Insurance')
  })

  it('crea el agente de intake en voz', async () => {
    const { data } = await serviceClient()
      .from('agents').select('name, module_type, provider, status').single()
    expect(data!.module_type).toBe('voice')
    expect(data!.provider).toBe('vapi')
  })

  it('crea los ocho campos universales del spec', async () => {
    const { data } = await serviceClient()
      .from('field_defs').select('key, required, intent_id').order('sort_order')
    expect(data!.map(f => f.key)).toEqual([
      'caller_name', 'callback_phone', 'reason_verbatim', 'reason_category',
      'is_existing_client', 'policy_number', 'urgency', 'summary',
    ])
    // Todos universales: ningún motivo activo en v1.
    expect(data!.every(f => f.intent_id === null)).toBe(true)
    // policy_number es el único opcional.
    expect(data!.filter(f => !f.required).map(f => f.key)).toEqual(['policy_number'])
  })

  it('deja el prompt con los tres guardrails del spec', async () => {
    const { data } = await serviceClient().from('agents').select('system_prompt').single()
    const p = data!.system_prompt.toLowerCase()
    expect(p).toContain('asistente automático')
    expect(p).toContain('911')
    expect(p).toContain('no procesa')
  })

  it('configura el correo por llamada', async () => {
    const { data } = await serviceClient()
      .from('agent_actions').select('type, enabled').eq('type', 'email_per_run')
    expect(data).toHaveLength(1)
    expect(data![0].enabled).toBe(true)
  })

  it('no crea ningún motivo todavía', async () => {
    const { data } = await serviceClient().from('agent_intents').select('id')
    expect(data).toEqual([])
  })
})
```

- [ ] **Step 2: Ejecutar para verificar que falla**

Run: `npx supabase db reset && npx vitest run tests/db/seed.test.ts`
Expected: FAIL — no hay datos sembrados.

- [ ] **Step 3: Escribir la semilla**

Crear `supabase/seed.sql`:

```sql
-- Semilla de desarrollo. La ejecuta `supabase db reset` automáticamente.
-- Los textos legales son provisionales: Luis debe confirmarlos antes de producción.

with c as (
  insert into public.clients (name, industry, status, timezone, contact_name, contact_email, notes)
  values (
    'Magen Insurance Inc', 'Insurance', 'active', 'America/New_York',
    'Luis Arenas', 'luis@mageninsurance.example',
    'Primer cliente y campo de prueba. Intake general fuera de horario en número de pruebas.'
  )
  returning id
), a as (
  insert into public.agents (
    client_id, module_type, name, description, provider, status, system_prompt
  )
  select c.id, 'voice', 'Intake general',
    'Atiende fuera de horario, entiende el motivo de la llamada y captura los datos.',
    'vapi', 'paused',
$prompt$Contestas el teléfono de Magen Insurance fuera del horario de oficina. Eres claro, cálido y breve.

Al contestar, di que eres un asistente automático de Magen Insurance y que la llamada se graba.

Tu trabajo es entender por qué llama la persona y tomar sus datos para que el equipo la contacte. Atiendes cualquier motivo: cancelaciones, cotizaciones, pagos, cambios de póliza, siniestros, documentos o preguntas generales.

Haz una pregunta a la vez. Confirma el teléfono de devolución repitiéndolo dígito por dígito.

Límites que no puedes cruzar:
- No confirmas cobertura ni das precios.
- No procesas cancelaciones, cambios ni pagos. Los registras para que una persona los gestione, y se lo dices así a quien llama.
- Si hay una emergencia en curso o alguien está herido, indica colgar y llamar al 911 de inmediato.

Cierra confirmando que alguien de Magen devolverá la llamada el siguiente día hábil.$prompt$
  from c
  returning id, client_id
)
insert into public.field_defs (agent_id, key, label, type, required, description, options, sort_order)
select a.id, f.key, f.label, f.type, f.required, f.description, f.options, f.sort_order
from a, (values
  ('caller_name',        'Nombre',              'text',    true,  'Nombre completo de quien llama', null::jsonb, 0),
  ('callback_phone',     'Teléfono',            'phone',   true,  'Mejor número para devolver la llamada', null, 1),
  ('reason_verbatim',    'Motivo (textual)',    'text',    true,  'El motivo en palabras de quien llama', null, 2),
  ('reason_category',    'Categoría',           'select',  true,  'Clasificación gruesa del motivo',
     '["cancelación","cotización","pago","cambio de póliza","siniestro","documentos","otro"]'::jsonb, 3),
  ('is_existing_client', '¿Cliente actual?',    'boolean', true,  'Si ya es asegurado de Magen', null, 4),
  ('policy_number',      'Número de póliza',    'text',    false, 'Solo si es cliente actual y lo tiene a mano', null, 5),
  ('urgency',            'Urgencia',            'select',  true,  'Si puede esperar al siguiente día hábil',
     '["normal","urgente"]'::jsonb, 6),
  ('summary',            'Resumen',             'text',    true,  'Resumen de la llamada para el equipo', null, 7)
) as f(key, label, type, required, description, options, sort_order);

insert into public.agent_actions (agent_id, type, config)
select id, 'email_per_run', '{"recipients":["pendiente@mageninsurance.example"]}'::jsonb
from public.agents;

insert into public.agent_actions (agent_id, type, config)
select id, 'email_digest', '{"recipients":["pendiente@mageninsurance.example"],"hour":7}'::jsonb
from public.agents;
```

- [ ] **Step 4: Aplicar y ejecutar**

```bash
npx supabase db reset
npx vitest run tests/db/seed.test.ts
```

Expected: PASS, 6 pruebas.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql tests/db/seed.test.ts
git commit -m "feat(db): semilla de Magen con campos universales y guardrails del prompt"
```

---

### Task 9: Tipos TypeScript y verificación completa

Cierra el ciclo: el SPA pasa a compartir tipos con la base real.

**Files:**
- Create: `src/lib/database.types.ts` (generado)
- Modify: `README.md`

**Interfaces:**
- Consumes: el esquema completo
- Produces: `Database` type exportado desde `src/lib/database.types.ts`

- [ ] **Step 1: Generar los tipos**

```bash
npm run db:types
```

Expected: crea `src/lib/database.types.ts` con `export type Database = { public: { Tables: { clients: ..., agents: ... } } }`.

- [ ] **Step 2: Verificar que compilan**

```bash
npx tsc -b
```

Expected: sin errores.

- [ ] **Step 3: Verificar que el tipo refleja el esquema**

Crear `tests/db/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Se inspecciona el archivo generado en vez de usar expectTypeOf: las
// aserciones de tipo se borran en runtime y `tsconfig.app.json` solo incluye
// `src/`, así que `tsc -b` nunca las comprobaría y la prueba pasaría vacía.
const generated = readFileSync(resolve(process.cwd(), 'src/lib/database.types.ts'), 'utf8')

describe('tipos generados', () => {
  it('mantiene billed_usd nullable', () => {
    // Si dejara de serlo, alguien habría roto la separación costo/precio.
    expect(generated).toMatch(/billed_usd: number \| null/)
  })

  it('mantiene intent_id nullable', () => {
    // Es la bisagra que permite añadir motivos sin migrar.
    expect(generated).toMatch(/intent_id: string \| null/)
  })

  it('expone las trece tablas del esquema', () => {
    for (const t of [
      'clients', 'profiles', 'client_members', 'agents', 'agent_intents',
      'field_defs', 'run_raw_events', 'runs', 'transcript_turns',
      'extracted_values', 'usage_events', 'agent_actions', 'action_runs',
    ]) {
      expect(generated).toContain(`${t}: {`)
    }
  })
})
```

- [ ] **Step 4: Ejecutar la suite completa**

```bash
npx supabase db reset
npm run test:db
```

Expected: PASS en los 7 archivos de prueba.

- [ ] **Step 5: Documentar el arranque**

Añadir a `README.md` antes de la sección `## What's here`:

```markdown
## Base de datos (desarrollo)

Requiere Docker en ejecución.

```bash
npm run db:start     # levanta Postgres, Auth y API en local
npm run db:reset     # reaplica migraciones y siembra datos de Magen
npm run test:db      # ejecuta las pruebas de esquema y RLS
npm run db:types     # regenera src/lib/database.types.ts
```

Las migraciones viven en `supabase/migrations/` y no se editan una vez aplicadas:
cada cambio va en una migración nueva.
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/database.types.ts tests/db/types.test.ts README.md
git commit -m "feat(db): tipos TypeScript generados y documentación de arranque"
```

---

## Verificación final del plan

Al terminar las 9 tareas debe cumplirse:

```bash
npx supabase db reset && npm run test:db && npx tsc -b
```

- 7 archivos de prueba en verde
- 13 tablas con RLS habilitada
- Un `client_user` no lee datos de otro cliente ni una sola fila de `usage_events`
- Magen sembrado con 8 campos universales, 0 motivos y 2 acciones

## Planes siguientes

| Plan | Entrega |
|---|---|
| 2 — Ingesta | Adaptador de Vapi, webhook, proyección canónica y escritura del ledger |
| 3 — Acciones | Ejecutor de `email_per_run` y `email_digest` con reintentos |
| 4 — Console conectado | Runs, detalle, cliente y agente leyendo de Supabase en vez de mocks |
