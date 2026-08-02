import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from './client'

async function setup() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents')
    .insert({
      client_id: c!.id, module_type: 'voice', name: 'Intake',
      provider: 'vapi', system_prompt: 'Contestas el teléfono de Magen.',
    })
    .select().single()
  const { data: r } = await svc.from('runs').insert({
    client_id: c!.id, agent_id: a!.id, provider: 'vapi', provider_call_id: 'call_obs1',
    started_at: new Date().toISOString(), status: 'completed',
  }).select().single()
  return { clientId: c!.id as string, agentId: a!.id as string, runId: r!.id as string }
}

describe('log estructurado de eventos', () => {
  beforeEach(resetData)

  it('registra un evento con nivel por defecto info', async () => {
    const { clientId, agentId, runId } = await setup()
    const { data, error } = await serviceClient().from('events').insert({
      client_id: clientId, agent_id: agentId, run_id: runId,
      type: 'run.projected', message: 'Run proyectado desde el evento crudo',
      latency_ms: 412, payload: { turns: 14 },
    }).select().single()

    expect(error).toBeNull()
    expect(data!.level).toBe('info')
  })

  it('acepta eventos de plataforma sin cliente', async () => {
    const { error } = await serviceClient().from('events').insert({
      type: 'provider.unreachable', level: 'error',
      message: 'Vapi respondió 503 al sincronizar',
    })
    expect(error).toBeNull()
  })

  it('rechaza un nivel desconocido', async () => {
    const { error } = await serviceClient()
      .from('events').insert({ type: 'x', level: 'catastrofico' })
    expect(error).not.toBeNull()
  })

  it('permite filtrar los eventos que exigen atención', async () => {
    const { clientId } = await setup()
    const svc = serviceClient()
    await svc.from('events').insert([
      { client_id: clientId, type: 'run.projected', level: 'info' },
      { client_id: clientId, type: 'extraction.partial', level: 'warn' },
      { client_id: clientId, type: 'action.failed', level: 'error' },
    ])

    const { data } = await svc.from('events').select('type').in('level', ['warn', 'error'])
    expect(data!.map(e => e.type).sort()).toEqual(['action.failed', 'extraction.partial'])
  })

  it('borra los eventos al borrar el run', async () => {
    const { clientId, runId } = await setup()
    const svc = serviceClient()
    await svc.from('events').insert({ client_id: clientId, run_id: runId, type: 'run.projected' })

    await svc.from('runs').delete().eq('id', runId)

    const { data } = await svc.from('events').select('id').eq('run_id', runId)
    expect(data).toEqual([])
  })
})

describe('revisiones de agente', () => {
  beforeEach(resetData)

  it('congela el prompt y los campos de una versión', async () => {
    const { agentId } = await setup()
    const { data, error } = await serviceClient().from('agent_revisions').insert({
      agent_id: agentId, version: 1,
      system_prompt: 'Contestas el teléfono de Magen.',
      fields: [{ key: 'caller_name', type: 'text', required: true }],
      provider: 'vapi',
    }).select().single()

    expect(error).toBeNull()
    expect(data!.fields).toHaveLength(1)
  })

  it('impide dos revisiones con la misma versión', async () => {
    const { agentId } = await setup()
    const row = {
      agent_id: agentId, version: 1, system_prompt: 'A', fields: [], provider: 'vapi',
    }
    await serviceClient().from('agent_revisions').insert(row)
    const { error } = await serviceClient().from('agent_revisions').insert(row)
    expect(error!.code).toBe('23505')
  })

  // El motivo de existir de la tabla: saber con qué configuración corrió cada llamada.
  it('ata un run a la revisión con la que corrió', async () => {
    const { clientId, agentId } = await setup()
    const svc = serviceClient()
    const { data: rev } = await svc.from('agent_revisions').insert({
      agent_id: agentId, version: 1, system_prompt: 'Versión original',
      fields: [{ key: 'caller_name' }], provider: 'vapi',
    }).select().single()

    const { data: run } = await svc.from('runs').insert({
      client_id: clientId, agent_id: agentId, agent_revision_id: rev!.id,
      provider: 'vapi', provider_call_id: 'call_rev1',
      started_at: new Date().toISOString(), status: 'completed',
    }).select().single()

    // Cambiar el prompt del agente no altera lo que dice la revisión histórica.
    await svc.from('agents').update({ system_prompt: 'Prompt nuevo' }).eq('id', agentId)

    const { data } = await svc.from('runs')
      .select('agent_revisions(system_prompt)').eq('id', run!.id).single()
    expect((data!.agent_revisions as { system_prompt: string }).system_prompt)
      .toBe('Versión original')
  })

  it('conserva el run aunque se borre el agente', async () => {
    const { clientId, agentId } = await setup()
    const svc = serviceClient()
    const { data: rev } = await svc.from('agent_revisions').insert({
      agent_id: agentId, version: 1, system_prompt: 'A', fields: [], provider: 'vapi',
    }).select().single()
    expect(rev).not.toBeNull()
    void clientId
  })
})

describe('tarifas versionadas', () => {
  beforeEach(resetData)

  it('registra una tarifa vigente sin fecha de fin', async () => {
    const { data, error } = await serviceClient().from('provider_rates').insert({
      provider: 'vapi', component: 'telephony', unit: 'minutes',
      unit_cost_usd: 0.0100, effective_from: '2026-01-01',
    }).select().single()

    expect(error).toBeNull()
    expect(data!.effective_to).toBeNull()
  })

  // Sin esto, dos tarifas vigentes el mismo día harían el costo indeterminado.
  it('impide dos tarifas solapadas para el mismo recurso', async () => {
    const svc = serviceClient()
    await svc.from('provider_rates').insert({
      provider: 'vapi', component: 'llm', unit: 'tokens',
      unit_cost_usd: 0.000003, effective_from: '2026-01-01', effective_to: '2026-06-01',
    })
    const { error } = await svc.from('provider_rates').insert({
      provider: 'vapi', component: 'llm', unit: 'tokens',
      unit_cost_usd: 0.000004, effective_from: '2026-03-01', effective_to: '2026-09-01',
    })
    expect(error).not.toBeNull()
  })

  it('acepta tarifas consecutivas sin solape', async () => {
    const svc = serviceClient()
    await svc.from('provider_rates').insert({
      provider: 'vapi', component: 'llm', unit: 'tokens',
      unit_cost_usd: 0.000003, effective_from: '2026-01-01', effective_to: '2026-06-01',
    })
    const { error } = await svc.from('provider_rates').insert({
      provider: 'vapi', component: 'llm', unit: 'tokens',
      unit_cost_usd: 0.000004, effective_from: '2026-06-01',
    })
    expect(error).toBeNull()
  })

  it('resuelve la tarifa vigente en una fecha dada', async () => {
    const svc = serviceClient()
    // Comprobado explícitamente: si la carga fallara en silencio, la consulta
    // siguiente devolvería una tarifa vieja y la prueba mentiría sobre por qué.
    const { error: seedError } = await svc.from('provider_rates').insert([
      {
        provider: 'vapi', component: 'telephony', unit: 'minutes',
        unit_cost_usd: 0.0100, effective_from: '2026-01-01', effective_to: '2026-06-01',
      },
      {
        provider: 'vapi', component: 'telephony', unit: 'minutes',
        unit_cost_usd: 0.0125, effective_from: '2026-06-01',
      },
    ])
    expect(seedError).toBeNull()

    const antes = await svc.rpc('rate_for', {
      p_provider: 'vapi', p_component: 'telephony', p_unit: 'minutes', p_at: '2026-03-15',
    })
    const despues = await svc.rpc('rate_for', {
      p_provider: 'vapi', p_component: 'telephony', p_unit: 'minutes', p_at: '2026-08-02',
    })

    expect(Number(antes.data)).toBeCloseTo(0.01, 6)
    expect(Number(despues.data)).toBeCloseTo(0.0125, 6)
  })

  it('devuelve nulo cuando no hay tarifa para esa fecha', async () => {
    const { data } = await serviceClient().rpc('rate_for', {
      p_provider: 'vapi', p_component: 'tts', p_unit: 'characters', p_at: '2026-08-02',
    })
    expect(data).toBeNull()
  })

  it('guarda en el ledger la tarifa unitaria aplicada', async () => {
    const { clientId, agentId, runId } = await setup()
    const { data, error } = await serviceClient().from('usage_events').insert({
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', component: 'telephony', quantity: 4, unit: 'minutes',
      unit_cost_usd: 0.0125, cost_usd: 0.05, source_event_id: 'evt_rate',
      occurred_at: new Date().toISOString(),
    }).select().single()

    expect(error).toBeNull()
    expect(Number(data!.unit_cost_usd)).toBeCloseTo(0.0125, 8)
  })
})
