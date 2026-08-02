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
const MANAGED_TABLES = [
  'action_runs', 'agent_actions', 'usage_events', 'extracted_values',
  'transcript_turns', 'runs', 'run_raw_events', 'field_defs',
  'agent_intents', 'agents', 'client_members', 'clients', 'profiles',
] as const

export async function resetData(): Promise<void> {
  const { dbUrl } = supabaseEnv()
  const pg = new Client({ connectionString: dbUrl })
  await pg.connect()
  try {
    // Solo trunca lo que ya existe: el esquema se construye por migraciones
    // sucesivas, así que durante las primeras tareas faltan tablas de la lista
    // y un TRUNCATE sobre una tabla ausente aborta toda la sentencia.
    const { rows } = await pg.query<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and tablename = any($1::text[])`,
      [MANAGED_TABLES as unknown as string[]],
    )
    if (rows.length === 0) return
    const present = rows.map((r) => `public.${r.tablename}`).join(', ')
    await pg.query(`truncate table ${present} restart identity cascade`)
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
