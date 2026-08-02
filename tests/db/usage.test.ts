import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from './client'

async function setup() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents')
    .insert({ client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi' })
    .select().single()
  const { data: r } = await svc.from('runs').insert({
    client_id: c!.id, agent_id: a!.id, provider: 'vapi', provider_call_id: 'call_u1',
    started_at: new Date().toISOString(), status: 'completed',
  }).select().single()
  return { clientId: c!.id as string, agentId: a!.id as string, runId: r!.id as string }
}

describe('ledger de usage', () => {
  beforeEach(resetData)

  it('registra costo por componente sin precio todavía', async () => {
    const { clientId, agentId, runId } = await setup()
    const { data, error } = await serviceClient().from('usage_events').insert({
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', component: 'llm', quantity: 1420, unit: 'tokens',
      cost_usd: 0.004260, source_event_id: 'evt_1',
      occurred_at: new Date().toISOString(),
    }).select().single()

    expect(error).toBeNull()
    expect(Number(data!.cost_usd)).toBeCloseTo(0.00426, 6)
    expect(data!.billed_usd).toBeNull()   // no hay planes todavía
    expect(data!.reconciled).toBe(false)
  })

  // Reprocesar una llamada no debe volver a cobrarla.
  it('rechaza el mismo evento de costo dos veces', async () => {
    const { clientId, agentId, runId } = await setup()
    const row = {
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', component: 'telephony', quantity: 4.5, unit: 'minutes',
      cost_usd: 0.045, source_event_id: 'evt_dup', occurred_at: new Date().toISOString(),
    }
    await serviceClient().from('usage_events').insert(row)
    const { error } = await serviceClient().from('usage_events').insert(row)
    expect(error!.code).toBe('23505')
  })

  it('acepta el mismo evento para componentes distintos', async () => {
    const { clientId, agentId, runId } = await setup()
    const base = {
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', quantity: 1, unit: 'minutes' as const,
      source_event_id: 'evt_multi', occurred_at: new Date().toISOString(),
    }
    await serviceClient().from('usage_events').insert({ ...base, component: 'stt', cost_usd: 0.01 })
    const { error } = await serviceClient()
      .from('usage_events').insert({ ...base, component: 'tts', cost_usd: 0.02 })
    expect(error).toBeNull()
  })

  it('permite costo nulo cuando el proveedor no lo reporta', async () => {
    const { clientId, agentId, runId } = await setup()
    const { error } = await serviceClient().from('usage_events').insert({
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', component: 'other', quantity: 1, unit: 'calls',
      cost_usd: null, source_event_id: 'evt_nocost',
      occurred_at: new Date().toISOString(),
    })
    expect(error).toBeNull()
  })

  it('agrega costo por cliente y módulo', async () => {
    const { clientId, agentId, runId } = await setup()
    const svc = serviceClient()
    const base = {
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', quantity: 1, unit: 'minutes' as const,
      occurred_at: new Date().toISOString(),
    }
    await svc.from('usage_events').insert([
      { ...base, component: 'telephony', cost_usd: 0.10, source_event_id: 'a' },
      { ...base, component: 'llm',       cost_usd: 0.25, source_event_id: 'b' },
      { ...base, component: 'tts',       cost_usd: 0.15, source_event_id: 'c' },
    ])

    const { data } = await svc.from('usage_events')
      .select('cost_usd').eq('client_id', clientId).eq('module_type', 'voice')
    const total = data!.reduce((sum, r) => sum + Number(r.cost_usd), 0)
    expect(total).toBeCloseTo(0.5, 6)
  })
})
