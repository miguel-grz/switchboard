/**
 * Ata un número ya comprado en el proveedor a un agente publicado.
 *
 *   npx tsx scripts/attach-number.ts <agent-id> <phone-number-id>
 *
 * El número se compra a mano en el panel del proveedor: comprarlo por API gasta
 * dinero real y no debe poder dispararlo un despliegue por accidente.
 */
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { attachPhoneNumber } from '../supabase/functions/_shared/sync'

function local() {
  const s = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' }))
  return { url: s.API_URL as string, key: s.SERVICE_ROLE_KEY as string }
}

async function main() {
  const [agentId, phoneNumberId] = process.argv.slice(2)
  if (!agentId || !phoneNumberId) {
    console.error('Uso: npx tsx scripts/attach-number.ts <agent-id> <phone-number-id>')
    process.exit(1)
  }

  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) {
    console.error('Falta VAPI_API_KEY.')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL ?? local().url
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? local().key
  const db = createClient(url, key, { auth: { persistSession: false } })

  await attachPhoneNumber(db, agentId, phoneNumberId, {
    http: (u, init) => fetch(u, init),
    apiKey,
  })

  console.log('Número atado. Llama al número para comprobarlo.')
}

main().catch((err) => {
  console.error('Falló:', err instanceof Error ? err.message : err)
  process.exit(1)
})
