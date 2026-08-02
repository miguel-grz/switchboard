import { supabaseEnv } from './db/env'

/**
 * Espera a que la API local esté sirviendo antes de la primera prueba.
 *
 * `supabase db reset` devuelve en cuanto aplica las migraciones, pero reinicia
 * los contenedores por detrás: auth puede tardar unos segundos más. Sin esta
 * espera, la primera prueba que crea un usuario falla con un error de red que
 * parece un fallo del código y no lo es.
 */
export async function setup(): Promise<void> {
  const { url, anonKey } = supabaseEnv()
  const deadline = Date.now() + 60_000

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anonKey } })
      if (res.ok) return
    } catch {
      // Todavía no responde: se reintenta hasta agotar el plazo.
    }
    await new Promise(r => setTimeout(r, 500))
  }

  throw new Error('La API local de Supabase no respondió en 60s. ¿Está corriendo `supabase start`?')
}
