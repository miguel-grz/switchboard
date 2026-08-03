import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serviceClient, resetData } from '../db/client'
import { supabaseEnv } from '../db/env'
import { requireFunctionsServer } from './functions-ready'

const raw = readFileSync(resolve(__dirname, 'fixtures/vapi-end-of-call.json'), 'utf8')
const SECRET = 'secreto-de-pruebas'

async function seedAgentWithAction() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
    provider_agent_id: 'asst_magen_intake',
  }).select().single()
  await svc.from('agent_actions').insert({
    agent_id: a!.id, type: 'email_per_run',
    config: { recipients: ['frontdesk@magen.test'] },
  })
}

function send() {
  return fetch(`${supabaseEnv().url}/functions/v1/provider-webhook/vapi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vapi-secret': SECRET },
    body: raw,
  })
}

// Requiere `npx supabase functions serve` corriendo en otra terminal.
describe('acciones tras la ingesta', () => {
  beforeAll(requireFunctionsServer)
  beforeEach(resetData)

  it('ejecuta las acciones del agente al proyectar la llamada', async () => {
    await seedAgentWithAction()

    const res = await send()
    expect(res.status).toBe(200)

    const { data } = await serviceClient().from('action_runs').select('type, status')
    expect(data).toHaveLength(1)
    expect(data![0].type).toBe('email_per_run')
    // Sin RESEND_API_KEY configurada, el emisor deja constancia en vez de mandar.
    expect(['sent', 'skipped', 'failed']).toContain(data![0].status)
  })

  // El correo es un efecto secundario: si falla, la llamada ya está guardada.
  it('registra la llamada aunque la acción no pueda enviarse', async () => {
    await seedAgentWithAction()

    await send()

    const { data } = await serviceClient().from('runs').select('id, extraction_status')
    expect(data).toHaveLength(1)
  })
})
