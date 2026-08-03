/**
 * Publica un agente en su proveedor.
 *
 *   npx tsx scripts/sync-agent.ts <agent-id>
 *
 * Lee la configuración del entorno. Contra la nube, exporta antes:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPI_API_KEY,
 *   WEBHOOK_URL y VAPI_WEBHOOK_SECRET
 *
 * Sin esas variables usa la instancia local, que sirve para ver el payload que
 * se enviaría sin tocar ninguna cuenta real.
 */
import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { syncAgent } from '../supabase/functions/_shared/sync'

function local() {
  const s = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8' }))
  return { url: s.API_URL as string, key: s.SERVICE_ROLE_KEY as string }
}

async function main() {
  const agentId = process.argv[2]
  if (!agentId) {
    console.error('Falta el id del agente: npx tsx scripts/sync-agent.ts <agent-id>')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL ?? local().url
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? local().key
  const apiKey = process.env.VAPI_API_KEY

  if (!apiKey) {
    console.error('Falta VAPI_API_KEY. Sin ella no hay a quién publicar.')
    process.exit(1)
  }

  const webhookUrl = process.env.WEBHOOK_URL
  const webhookSecret = process.env.VAPI_WEBHOOK_SECRET
  if (!webhookUrl) {
    // Publicar sin servidor deja un agente que contesta pero cuyas llamadas
    // nunca llegan a la base. Mejor decirlo que descubrirlo después.
    console.warn('Aviso: sin WEBHOOK_URL el agente no enviará sus llamadas a Switchboard.')
  }

  const db = createClient(url, key, { auth: { persistSession: false } })
  const result = await syncAgent(db, agentId, {
    http: (u, init) => fetch(u, init),
    apiKey,
    webhook: webhookUrl && webhookSecret
      ? { url: webhookUrl, secret: webhookSecret }
      : undefined,
  })

  console.log('Publicado:', result)
}

main().catch((err) => {
  console.error('Falló la publicación:', err instanceof Error ? err.message : err)
  console.error('El detalle queda en la tabla events con tipo agent.sync_failed.')
  process.exit(1)
})
