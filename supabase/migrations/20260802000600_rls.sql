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
-- Políticas
--
-- La RLS ya viene activada desde la migración que crea cada tabla, para no
-- dejar ninguna ventana sin protección entre ambas. Aquí solo se conceden los
-- accesos. service_role evita RLS por diseño: así escriben las Edge Functions.
-- ---------------------------------------------------------------------------

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
