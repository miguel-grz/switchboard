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
