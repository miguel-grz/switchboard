-- ---------------------------------------------------------------------------
-- Log estructurado de eventos
--
-- Sustituye a la observabilidad dispersa en columnas de error. El sistema
-- central de monitoreo será una vista sobre esta tabla, no un rediseño.
--
-- client_id es nullable a propósito: hay eventos de plataforma que no
-- pertenecen a ningún cliente (el proveedor caído, un cron que falló).
-- ---------------------------------------------------------------------------
create table public.events (
  id bigserial primary key,
  client_id uuid references public.clients(id) on delete cascade,
  run_id    uuid references public.runs(id)    on delete cascade,
  agent_id  uuid references public.agents(id)  on delete set null,
  type text not null,                 -- 'run.projected', 'extraction.partial', 'action.failed'
  level text not null default 'info' check (level in ('debug','info','warn','error')),
  message text,
  latency_ms int,
  payload jsonb,
  occurred_at timestamptz not null default now()
);

create index events_client_time_idx on public.events (client_id, occurred_at desc);
create index events_run_idx on public.events (run_id);
-- El monitoreo pregunta casi siempre por lo que exige atención.
create index events_attention_idx on public.events (occurred_at desc)
  where level in ('warn','error');

-- ---------------------------------------------------------------------------
-- Revisiones de agente
--
-- Histórico inmutable de prompt y campos. Sin esto solo se sabe qué versión
-- corrió una llamada, no qué decía esa versión — y al depurar una extracción
-- mala, eso es justo lo que hace falta.
--
-- `fields` es un snapshot de field_defs, no una referencia: si mañana se borra
-- un campo, la revisión debe seguir contando la verdad de aquel momento.
-- ---------------------------------------------------------------------------
create table public.agent_revisions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  version int not null,
  system_prompt text not null,
  fields jsonb not null default '[]'::jsonb,
  provider text not null,
  provider_agent_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);

create index agent_revisions_agent_idx on public.agent_revisions (agent_id, version desc);

-- Qué configuración produjo cada ejecución.
alter table public.runs
  add column agent_revision_id uuid references public.agent_revisions(id) on delete set null;

comment on column public.runs.agent_revision_id is
  'Configuración del agente vigente durante la llamada. Distinto de '
  'extraction_version, que versiona la lógica de extracción sobre un mismo run.';

-- ---------------------------------------------------------------------------
-- Tarifas por proveedor, versionadas por fecha de vigencia
--
-- Necesarias cuando el proveedor no reporta costo, y para que un cambio de
-- tarifa no reescriba el histórico ya registrado.
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist;

create table public.provider_rates (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  component text not null check (component in ('telephony','stt','llm','tts','other')),
  unit text not null check (unit in ('minutes','tokens','characters','calls')),
  unit_cost_usd numeric(12,8) not null check (unit_cost_usd >= 0),
  effective_from date not null,
  effective_to date,                  -- nulo = vigente
  notes text,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  -- Dos tarifas vigentes el mismo día para el mismo recurso harían el costo
  -- indeterminado. La base lo impide en vez de confiar en que nadie se
  -- equivoque al cargarlas.
  constraint provider_rates_no_overlap exclude using gist (
    provider  with =,
    component with =,
    unit      with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);

-- Tarifa unitaria efectivamente aplicada, para que el cargo sea auditable
-- aunque la tarifa cambie después.
alter table public.usage_events add column unit_cost_usd numeric(12,8);

-- Resuelve la tarifa vigente en una fecha. Devuelve null si no hay ninguna:
-- quien llama decide si eso es un costo pendiente de conciliar o un error.
create or replace function public.rate_for(
  p_provider text, p_component text, p_unit text, p_at date
) returns numeric
language sql stable
as $$
  select unit_cost_usd
  from public.provider_rates
  where provider = p_provider
    and component = p_component
    and unit = p_unit
    and daterange(effective_from, effective_to, '[)') @> p_at
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios y RLS (ver nota en la migración de tenencia).
--
-- Las tres son internas: eventos de sistema, configuración histórica y costos
-- de proveedor. Ningún cliente las lee. Si algún día el dashboard de cliente
-- necesita una bitácora, será una vista con lo que sí puede ver.
-- ---------------------------------------------------------------------------
grant select on public.events, public.agent_revisions, public.provider_rates to authenticated;
grant all on public.events, public.agent_revisions, public.provider_rates to service_role;

alter table public.events          enable row level security;
alter table public.agent_revisions enable row level security;
alter table public.provider_rates  enable row level security;

create policy events_select on public.events
  for select to authenticated using (public.is_operator());

create policy agent_revisions_select on public.agent_revisions
  for select to authenticated using (public.is_operator());

create policy provider_rates_select on public.provider_rates
  for select to authenticated using (public.is_operator());
