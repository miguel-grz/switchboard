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

-- Privilegios y RLS (ver nota en la migración de tenencia).
--
-- Sin GRANT a anon: el costo interno nunca se expone sin sesión. A
-- authenticated solo SELECT, porque los operadores lo consultan desde el
-- console; la política lo restringe a ellos. La escritura es exclusiva de
-- service_role, que es lo que mantiene el ledger append-only en la práctica.
grant select on public.usage_events to authenticated;
grant all on public.usage_events to service_role;

alter table public.usage_events enable row level security;
