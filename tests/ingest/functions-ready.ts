import { supabaseEnv } from '../db/env'

/**
 * Comprueba que el runtime de Edge Functions está sirviendo.
 *
 * Sin él, las pruebas del webhook reciben 401 del gateway y el fallo parece un
 * problema de autenticación cuando en realidad la función no está corriendo.
 * Un mensaje claro ahorra ese rato de diagnóstico.
 */
export async function requireFunctionsServer(): Promise<void> {
  const { url } = supabaseEnv()
  try {
    const res = await fetch(`${url}/functions/v1/provider-webhook/vapi`, { method: 'POST' })
    // 404 significa que el gateway responde pero no hay función publicada.
    if (res.status === 404) {
      throw new Error('sin función')
    }
  } catch {
    throw new Error(
      'Estas pruebas necesitan el runtime de funciones. En otra terminal:\n' +
      '  npx supabase functions serve --env-file supabase/functions/.env.local',
    )
  }
}
