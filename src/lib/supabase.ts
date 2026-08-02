import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Se consultan las dos fuentes, no una u otra: en Vitest `import.meta.env`
// existe pero vacío, así que preferirlo con `??` nunca llegaría a process.env.
const viteEnv = (import.meta as unknown as { env?: Record<string, string> }).env ?? {}
const nodeEnv =
  (globalThis as unknown as { process?: { env: Record<string, string> } }).process?.env ?? {}

const url = viteEnv.VITE_SUPABASE_URL || nodeEnv.VITE_SUPABASE_URL || ''
const anonKey = viteEnv.VITE_SUPABASE_ANON_KEY || nodeEnv.VITE_SUPABASE_ANON_KEY || ''

/** Sin configuración la app cae a datos de muestra (ver src/data/index.ts). */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

// Solo clave anónima: la seguridad la impone RLS, nunca el frontend.
export const supabase = createClient<Database>(url || 'http://localhost', anonKey || 'anon', {
  auth: { persistSession: true, autoRefreshToken: true },
})
