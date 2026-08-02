import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from './client'

async function makeClient() {
  const { data } = await serviceClient()
    .from('clients').insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  return data!.id as string
}

async function makeAgent(clientId: string) {
  const { data } = await serviceClient()
    .from('agents')
    .insert({
      client_id: clientId, module_type: 'voice', name: 'Intake general',
      provider: 'vapi', channel: '+13125550142',
    })
    .select().single()
  return data!.id as string
}

describe('agentes y campos', () => {
  beforeEach(resetData)

  it('crea un agente pausado por defecto', async () => {
    const clientId = await makeClient()
    const { data, error } = await serviceClient()
      .from('agents')
      .insert({ client_id: clientId, module_type: 'voice', name: 'Intake', provider: 'vapi' })
      .select().single()
    expect(error).toBeNull()
    expect(data!.status).toBe('paused')
    expect(data!.extraction_version).toBe(1)
  })

  it('acepta campos universales con intent_id nulo', async () => {
    const agentId = await makeAgent(await makeClient())
    const { error } = await serviceClient().from('field_defs').insert({
      agent_id: agentId, key: 'caller_name', label: 'Nombre',
      type: 'text', required: true, sort_order: 0,
    })
    expect(error).toBeNull()
  })

  // La prueba que justifica `nulls not distinct`: sin eso, Postgres considera
  // distintos dos NULL y permitiría duplicar un campo universal.
  it('impide dos campos universales con la misma clave', async () => {
    const agentId = await makeAgent(await makeClient())
    const row = { agent_id: agentId, key: 'caller_name', label: 'Nombre', type: 'text' }
    await serviceClient().from('field_defs').insert(row)
    const { error } = await serviceClient().from('field_defs').insert(row)
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23505')
  })

  it('permite la misma clave en dos motivos distintos', async () => {
    const agentId = await makeAgent(await makeClient())
    const svc = serviceClient()
    const { data: a } = await svc.from('agent_intents')
      .insert({ agent_id: agentId, key: 'cancelacion', label: 'Cancelación' }).select().single()
    const { data: b } = await svc.from('agent_intents')
      .insert({ agent_id: agentId, key: 'cotizacion', label: 'Cotización' }).select().single()

    await svc.from('field_defs').insert({
      agent_id: agentId, intent_id: a!.id, key: 'effective_date', label: 'Fecha', type: 'date',
    })
    const { error } = await svc.from('field_defs').insert({
      agent_id: agentId, intent_id: b!.id, key: 'effective_date', label: 'Fecha', type: 'date',
    })
    expect(error).toBeNull()
  })

  it('rechaza un tipo de campo desconocido', async () => {
    const agentId = await makeAgent(await makeClient())
    const { error } = await serviceClient().from('field_defs').insert({
      agent_id: agentId, key: 'x', label: 'X', type: 'telepatia',
    })
    expect(error).not.toBeNull()
  })
})
