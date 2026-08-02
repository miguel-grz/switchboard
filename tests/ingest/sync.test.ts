import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from '../db/client'
import { getAdapter } from '../../supabase/functions/_shared/providers/index'
import { syncAgent } from '../../supabase/functions/_shared/sync'

async function seedAgent(providerAgentId: string | null = null) {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake general',
    provider: 'vapi', provider_agent_id: providerAgentId,
    system_prompt: 'Contestas para Magen fuera de horario.',
  }).select().single()
  await svc.from('field_defs').insert([
    { agent_id: a!.id, key: 'caller_name', label: 'Nombre', type: 'text', required: true, sort_order: 0 },
    { agent_id: a!.id, key: 'urgency', label: 'Urgencia', type: 'select', required: true, sort_order: 1, options: ['normal', 'urgente'] },
  ])
  return { clientId: c!.id as string, agentId: a!.id as string }
}

/** Doble del HTTP del proveedor: registra las llamadas y devuelve lo pactado. */
function fakeHttp(response: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const http = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(response), {
      status, headers: { 'content-type': 'application/json' },
    })
  }
  return { http, calls }
}

describe('construcción del assistant', () => {
  it('incluye el prompt y el esquema derivado de los campos', () => {
    const vapi = getAdapter('vapi')
    const cfg = vapi.buildAssistantConfig({
      name: 'Intake general',
      systemPrompt: 'Contestas para Magen.',
      fields: [
        { key: 'caller_name', label: 'Nombre', type: 'text', required: true, description: 'Nombre completo', options: null },
        { key: 'urgency', label: 'Urgencia', type: 'select', required: true, description: null, options: ['normal', 'urgente'] },
      ],
    }) as any

    expect(cfg.name).toBe('Intake general')
    expect(cfg.model.messages[0].role).toBe('system')
    expect(cfg.model.messages[0].content).toContain('Contestas para Magen.')

    const schema = cfg.analysisPlan.structuredDataPlan.schema
    expect(schema.properties.caller_name.type).toBe('string')
    expect(schema.properties.urgency.enum).toEqual(['normal', 'urgente'])
    expect(schema.required).toEqual(['caller_name', 'urgency'])
    // Sin esto Vapi no genera structuredData y la extracción llega vacía.
    expect(cfg.analysisPlan.structuredDataPlan.enabled).toBe(true)
  })
})

describe('sincronización', () => {
  beforeEach(resetData)

  it('crea el assistant y guarda su id cuando el agente es nuevo', async () => {
    const { agentId } = await seedAgent(null)
    const svc = serviceClient()
    const { http, calls } = fakeHttp({ id: 'asst_creado_123' })

    const res = await syncAgent(svc, agentId, { http, apiKey: 'llave' })

    expect(res.providerAgentId).toBe('asst_creado_123')
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].url).toMatch(/\/assistant$/)
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer llave')

    const { data } = await svc.from('agents').select('provider_agent_id').eq('id', agentId).single()
    expect(data!.provider_agent_id).toBe('asst_creado_123')
  })

  it('actualiza en vez de crear cuando el agente ya está publicado', async () => {
    const { agentId } = await seedAgent('asst_existente')
    const { http, calls } = fakeHttp({ id: 'asst_existente' })

    await syncAgent(serviceClient(), agentId, { http, apiKey: 'llave' })

    expect(calls[0].init.method).toBe('PATCH')
    expect(calls[0].url).toMatch(/\/assistant\/asst_existente$/)
  })

  it('congela una revisión con el prompt y los campos de ese momento', async () => {
    const { agentId } = await seedAgent(null)
    const svc = serviceClient()
    const { http } = fakeHttp({ id: 'asst_1' })

    await syncAgent(svc, agentId, { http, apiKey: 'llave' })

    const { data } = await svc.from('agent_revisions').select().eq('agent_id', agentId)
    expect(data).toHaveLength(1)
    expect(data![0].version).toBe(1)
    expect(data![0].system_prompt).toContain('Contestas para Magen')
    expect(data![0].fields).toHaveLength(2)
  })

  it('numera las revisiones de forma incremental', async () => {
    const { agentId } = await seedAgent(null)
    const svc = serviceClient()
    const { http } = fakeHttp({ id: 'asst_1' })

    await syncAgent(svc, agentId, { http, apiKey: 'llave' })
    await svc.from('agents').update({ system_prompt: 'Prompt nuevo' }).eq('id', agentId)
    await syncAgent(svc, agentId, { http, apiKey: 'llave' })

    const { data } = await svc.from('agent_revisions')
      .select('version, system_prompt').eq('agent_id', agentId).order('version')
    expect(data!.map(r => r.version)).toEqual([1, 2])
    expect(data![1].system_prompt).toBe('Prompt nuevo')
  })

  it('no crea revisión ni guarda id si el proveedor rechaza', async () => {
    const { agentId } = await seedAgent(null)
    const svc = serviceClient()
    const { http } = fakeHttp({ message: 'clave inválida' }, 401)

    await expect(syncAgent(svc, agentId, { http, apiKey: 'mala' })).rejects.toThrow(/401/)

    const { data: revs } = await svc.from('agent_revisions').select()
    expect(revs).toEqual([])
    const { data: agent } = await svc.from('agents')
      .select('provider_agent_id').eq('id', agentId).single()
    expect(agent!.provider_agent_id).toBeNull()

    const { data: events } = await svc.from('events').select().eq('type', 'agent.sync_failed')
    expect(events!.length).toBe(1)
  })

  it('registra el evento de sincronización exitosa', async () => {
    const { agentId } = await seedAgent(null)
    const svc = serviceClient()
    const { http } = fakeHttp({ id: 'asst_1' })

    await syncAgent(svc, agentId, { http, apiKey: 'llave' })

    const { data } = await svc.from('events').select().eq('type', 'agent.synced')
    expect(data).toHaveLength(1)
    expect(data![0].agent_id).toBe(agentId)
  })
})
