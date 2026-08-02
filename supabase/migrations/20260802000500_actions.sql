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

-- Privilegios y RLS (ver nota en la migración de tenencia).
grant select on public.agent_actions, public.action_runs to anon;
grant select, insert, update, delete on public.agent_actions to authenticated;
grant select on public.action_runs to authenticated;
grant all on public.agent_actions, public.action_runs to service_role;

alter table public.agent_actions enable row level security;
alter table public.action_runs   enable row level security;
