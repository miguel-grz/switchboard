import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from './client'

async function makeAgentAndClient() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents')
    .insert({ client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi' })
    .select().single()
  return { clientId: c!.id as string, agentId: a!.id as string }
}

function runRow(clientId: string, agentId: string, callId: string) {
  return {
    client_id: clientId, agent_id: agentId, provider: 'vapi',
    provider_call_id: callId, started_at: new Date().toISOString(),
    status: 'completed',
  }
}

describe('ejecuciones', () => {
  beforeEach(resetData)

  it('guarda un evento crudo con su payload íntegro', async () => {
    const { error } = await serviceClient().from('run_raw_events').insert({
      provider: 'vapi', provider_call_id: 'call_1',
      event_type: 'end-of-call-report',
      payload: { message: { type: 'end-of-call-report', cost: 0.42 } },
      signature_verified: true,
    })
    expect(error).toBeNull()
  })

  // Vapi reintenta los webhooks: el mismo evento puede llegar dos veces.
  it('rechaza el mismo evento crudo dos veces', async () => {
    const row = {
      provider: 'vapi', provider_call_id: 'call_1',
      event_type: 'end-of-call-report', payload: {},
    }
    await serviceClient().from('run_raw_events').insert(row)
    const { error } = await serviceClient().from('run_raw_events').insert(row)
    expect(error!.code).toBe('23505')
  })

  it('rechaza dos runs para la misma llamada del proveedor', async () => {
    const { clientId, agentId } = await makeAgentAndClient()
    await serviceClient().from('runs').insert(runRow(clientId, agentId, 'call_9'))
    const { error } = await serviceClient().from('runs').insert(runRow(clientId, agentId, 'call_9'))
    expect(error!.code).toBe('23505')
  })

  it('arranca con extraction_status pendiente', async () => {
    const { clientId, agentId } = await makeAgentAndClient()
    const { data } = await serviceClient()
      .from('runs').insert(runRow(clientId, agentId, 'call_2')).select().single()
    expect(data!.extraction_status).toBe('pending')
    expect(data!.direction).toBe('inbound')
  })

  it('conserva dos versiones de extracción del mismo campo', async () => {
    const { clientId, agentId } = await makeAgentAndClient()
    const svc = serviceClient()
    const { data: run } = await svc
      .from('runs').insert(runRow(clientId, agentId, 'call_3')).select().single()

    await svc.from('extracted_values').insert({
      run_id: run!.id, field_key: 'caller_name', value_text: 'Jon', extraction_version: 1,
    })
    const { error } = await svc.from('extracted_values').insert({
      run_id: run!.id, field_key: 'caller_name', value_text: 'John', extraction_version: 2,
    })
    expect(error).toBeNull()

    const { data } = await svc.from('extracted_values').select().eq('run_id', run!.id)
    expect(data).toHaveLength(2)
  })

  it('borra turnos y valores al borrar el run', async () => {
    const { clientId, agentId } = await makeAgentAndClient()
    const svc = serviceClient()
    const { data: run } = await svc
      .from('runs').insert(runRow(clientId, agentId, 'call_4')).select().single()
    await svc.from('transcript_turns').insert({
      run_id: run!.id, seq: 1, speaker: 'agent', text: 'Buenas noches, Magen Insurance.',
    })

    await svc.from('runs').delete().eq('id', run!.id)

    const { data } = await svc.from('transcript_turns').select().eq('run_id', run!.id)
    expect(data).toEqual([])
  })
})
