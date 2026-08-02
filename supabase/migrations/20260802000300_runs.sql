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

-- Privilegios y RLS (ver nota en la migración de tenencia).
--
-- run_raw_events no se concede a anon: los payloads del proveedor son internos.
-- A authenticated sí, porque los operadores deben leerlos; la política de RLS
-- es la que restringe esa lectura solo a ellos. Sin este GRANT, ninguna
-- política podría concedérselos.
grant select on public.runs, public.transcript_turns, public.extracted_values to anon;
grant select
  on public.run_raw_events, public.runs, public.transcript_turns, public.extracted_values
  to authenticated;
grant all
  on public.run_raw_events, public.runs, public.transcript_turns, public.extracted_values
  to service_role;

alter table public.run_raw_events   enable row level security;
alter table public.runs             enable row level security;
alter table public.transcript_turns enable row level security;
alter table public.extracted_values enable row level security;
