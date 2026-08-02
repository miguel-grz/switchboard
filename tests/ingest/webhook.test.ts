import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serviceClient, resetData } from '../db/client'
import { supabaseEnv } from '../db/env'

const raw = readFileSync(resolve(__dirname, 'fixtures/vapi-end-of-call.json'), 'utf8')
const SECRET = 'secreto-de-pruebas'

function url(provider = 'vapi') {
  return `${supabaseEnv().url}/functions/v1/provider-webhook/${provider}`
}

async function post(body: string, headers: Record<string, string>) {
  return fetch(url(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

async function seedAgent() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
    provider_agent_id: 'asst_magen_intake',
  })
}

// Requiere `npx supabase functions serve` corriendo en otra terminal.
describe('webhook del proveedor', () => {
  beforeEach(resetData)

  it('rechaza una petición sin credencial', async () => {
    const res = await post(raw, {})
    expect(res.status).toBe(401)
  })

  it('rechaza un proveedor desconocido', async () => {
    const res = await fetch(url('paloma'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vapi-secret': SECRET },
      body: raw,
    })
    expect(res.status).toBe(404)
  })

  it('acepta y proyecta un reporte válido', async () => {
    await seedAgent()
    const res = await post(raw, { 'x-vapi-secret': SECRET })
    expect(res.status).toBe(200)

    const { data } = await serviceClient().from('runs').select('id, status')
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('completed')
  })

  // Vapi reintenta ante cualquier respuesta que no sea 2xx: devolver 500 por un
  // payload que nunca va a funcionar provoca reintentos infinitos.
  it('responde 200 ante un payload que no puede proyectar', async () => {
    const res = await post(raw, { 'x-vapi-secret': SECRET }) // sin agente sembrado
    expect(res.status).toBe(200)

    const { data } = await serviceClient().from('run_raw_events').select('processing_error')
    expect(data![0].processing_error).toMatch(/agente/i)
  })

  it('responde 400 ante un cuerpo que no es JSON', async () => {
    const res = await post('esto no es json', { 'x-vapi-secret': SECRET })
    expect(res.status).toBe(400)
  })
})
