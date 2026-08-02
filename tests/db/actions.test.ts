import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from './client'

async function setup() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents')
    .insert({ client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi' })
    .select().single()
  return { clientId: c!.id as string, agentId: a!.id as string }
}

describe('acciones', () => {
  beforeEach(resetData)

  it('configura un correo por llamada con destinatarios', async () => {
    const { agentId } = await setup()
    const { data, error } = await serviceClient().from('agent_actions').insert({
      agent_id: agentId, type: 'email_per_run',
      config: { recipients: ['frontdesk@magen.test'] },
    }).select().single()

    expect(error).toBeNull()
    expect(data!.enabled).toBe(true)
    expect(data!.condition).toBeNull()   // sin condición = siempre
    expect(data!.config.recipients).toEqual(['frontdesk@magen.test'])
  })

  it('acepta una condición para disparar solo en urgentes', async () => {
    const { agentId } = await setup()
    const { data, error } = await serviceClient().from('agent_actions').insert({
      agent_id: agentId, type: 'webhook',
      config: { url: 'https://crm.magen.test/hook' },
      condition: { urgency: 'urgente' },
    }).select().single()

    expect(error).toBeNull()
    expect(data!.condition).toEqual({ urgency: 'urgente' })
  })

  it('rechaza un tipo de acción desconocido', async () => {
    const { agentId } = await setup()
    const { error } = await serviceClient()
      .from('agent_actions').insert({ agent_id: agentId, type: 'paloma_mensajera' })
    expect(error).not.toBeNull()
  })

  it('registra un intento fallido con su error', async () => {
    const { clientId, agentId } = await setup()
    const svc = serviceClient()
    const { data: action } = await svc.from('agent_actions')
      .insert({ agent_id: agentId, type: 'email_per_run', config: {} }).select().single()

    const { data, error } = await svc.from('action_runs').insert({
      action_id: action!.id, client_id: clientId, agent_id: agentId,
      type: 'email_per_run', status: 'failed',
      error: 'Resend respondió 429', attempt: 2,
    }).select().single()

    expect(error).toBeNull()
    expect(data!.attempt).toBe(2)
  })

  // El histórico de ejecuciones sobrevive al borrado de su configuración.
  it('conserva el registro si se borra la acción', async () => {
    const { clientId, agentId } = await setup()
    const svc = serviceClient()
    const { data: action } = await svc.from('agent_actions')
      .insert({ agent_id: agentId, type: 'email_per_run', config: {} }).select().single()
    await svc.from('action_runs').insert({
      action_id: action!.id, client_id: clientId, agent_id: agentId,
      type: 'email_per_run', status: 'sent',
    })

    await svc.from('agent_actions').delete().eq('id', action!.id)

    const { data } = await svc.from('action_runs').select().eq('agent_id', agentId)
    expect(data).toHaveLength(1)
    expect(data![0].action_id).toBeNull()
  })
})
