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

-- Privilegios y RLS (ver nota en la migración de tenencia).
grant select on public.agents, public.agent_intents, public.field_defs to anon;
grant select, insert, update, delete
  on public.agents, public.agent_intents, public.field_defs
  to authenticated;
grant all on public.agents, public.agent_intents, public.field_defs to service_role;

alter table public.agents        enable row level security;
alter table public.agent_intents enable row level security;
alter table public.field_defs    enable row level security;
