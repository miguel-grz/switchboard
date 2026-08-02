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

-- ---------------------------------------------------------------------------
-- Privilegios y RLS
--
-- Supabase ya no concede privilegios por defecto a las tablas nuevas del
-- schema public: hay que otorgarlos explícitamente. El modelo es en dos capas
-- — el GRANT abre la puerta y la RLS decide qué filas se ven.
--
-- La RLS se activa aquí mismo, no en una migración posterior: entre la
-- creación de la tabla y su activación no debe existir ninguna ventana en la
-- que un cliente pueda leer datos ajenos. Sin políticas, RLS niega todo salvo
-- a service_role, que es el default seguro mientras llegan las políticas.
-- ---------------------------------------------------------------------------
grant select on public.clients, public.profiles, public.client_members to anon;
grant select, insert, update, delete
  on public.clients, public.profiles, public.client_members
  to authenticated;
grant all on public.clients, public.profiles, public.client_members to service_role;

alter table public.clients        enable row level security;
alter table public.profiles       enable row level security;
alter table public.client_members enable row level security;
