import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from '../db/client'
import { getAdapter } from '../../supabase/functions/_shared/providers/index'
import { syncAgent, attachPhoneNumber } from '../../supabase/functions/_shared/sync'
import type { FieldDef } from '../../supabase/functions/_shared/types'

const vapi = getAdapter('vapi')
const fields: FieldDef[] = [
  { key: 'caller_name', label: 'Nombre', type: 'text', required: true, description: 'Nombre completo', options: null },
]

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

describe('configuración del assistant', () => {
  it('incluye voz, transcriptor y saludo, que Vapi necesita para funcionar', () => {
    const cfg = vapi.buildAssistantConfig({ name: 'Intake', systemPrompt: 'Hola', fields }) as any
    expect(cfg.voice.provider).toBeTruthy()
    expect(cfg.voice.voiceId).toBeTruthy()
    expect(cfg.transcriber.provider).toBeTruthy()
    expect(cfg.transcriber.language).toBe('en')
    expect(cfg.firstMessage).toContain('automated assistant')
    expect(cfg.firstMessageMode).toBe('assistant-speaks-first')
  })

  // Sin límites, una llamada que nadie cuelga se sigue facturando.
  it('pone cortes de duración y de silencio', () => {
    const cfg = vapi.buildAssistantConfig({ name: 'Intake', systemPrompt: 'Hola', fields }) as any
    expect(cfg.maxDurationSeconds).toBeGreaterThan(0)
    expect(cfg.silenceTimeoutSeconds).toBeGreaterThan(0)
  })

  it('deja sobreescribir cualquier ajuste desde la config del agente', () => {
    const cfg = vapi.buildAssistantConfig({
      name: 'Intake', systemPrompt: 'Hola', fields,
      config: {
        language: 'es', voiceId: 'sarah', llmModel: 'gpt-4o-mini',
        greeting: 'Gracias por llamar a Magen.', maxDurationSeconds: 300,
      },
    }) as any

    expect(cfg.transcriber.language).toBe('es')
    expect(cfg.voice.voiceId).toBe('sarah')
    expect(cfg.model.model).toBe('gpt-4o-mini')
    expect(cfg.firstMessage).toBe('Gracias por llamar a Magen.')
    expect(cfg.maxDurationSeconds).toBe(300)
  })

  it('declara el servidor solo cuando se le da una URL', () => {
    const sin = vapi.buildAssistantConfig({ name: 'A', systemPrompt: 'x', fields }) as any
    expect(sin.server).toBeUndefined()

    const con = vapi.buildAssistantConfig({
      name: 'A', systemPrompt: 'x', fields,
      webhook: { url: 'https://x.supabase.co/functions/v1/provider-webhook/vapi', secret: 's' },
    }) as any
    expect(con.server.url).toContain('provider-webhook')
    expect(con.server.secret).toBe('s')
    expect(con.serverMessages).toContain('end-of-call-report')
  })
})

describe('sincronización con config', () => {
  beforeEach(resetData)

  async function seedAgent(config: Record<string, unknown> = {}) {
    const svc = serviceClient()
    const { data: c } = await svc.from('clients')
      .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
    const { data: a } = await svc.from('agents').insert({
      client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
      system_prompt: 'Contestas para Magen.', config,
    }).select().single()
    return { agentId: a!.id as string }
  }

  it('manda al proveedor la config guardada del agente', async () => {
    const { agentId } = await seedAgent({ language: 'es', voiceId: 'sarah' })
    const { http, calls } = fakeHttp({ id: 'asst_1' })

    await syncAgent(serviceClient(), agentId, { http, apiKey: 'k' })

    const body = JSON.parse(calls[0].init.body as string)
    expect(body.transcriber.language).toBe('es')
    expect(body.voice.voiceId).toBe('sarah')
  })

  // Sin esto se sabría con qué prompt corrió una llamada, pero no con qué voz.
  it('congela la config en la revisión', async () => {
    const { agentId } = await seedAgent({ language: 'es' })
    const { http } = fakeHttp({ id: 'asst_1' })
    const svc = serviceClient()

    await syncAgent(svc, agentId, { http, apiKey: 'k' })

    const { data } = await svc.from('agent_revisions').select('config').eq('agent_id', agentId).single()
    expect((data!.config as Record<string, unknown>).language).toBe('es')
  })

  it('pasa la URL del webhook cuando se le da', async () => {
    const { agentId } = await seedAgent()
    const { http, calls } = fakeHttp({ id: 'asst_1' })

    await syncAgent(serviceClient(), agentId, {
      http, apiKey: 'k',
      webhook: { url: 'https://x.supabase.co/functions/v1/provider-webhook/vapi', secret: 'sec' },
    })

    const body = JSON.parse(calls[0].init.body as string)
    expect(body.server.url).toContain('provider-webhook')
  })
})

describe('vínculo del número', () => {
  beforeEach(resetData)

  async function seedPublished() {
    const svc = serviceClient()
    const { data: c } = await svc.from('clients')
      .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
    const { data: a } = await svc.from('agents').insert({
      client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
      provider_agent_id: 'asst_pub',
    }).select().single()
    return { agentId: a!.id as string }
  }

  it('ata el número y guarda el que devuelve el proveedor', async () => {
    const { agentId } = await seedPublished()
    const svc = serviceClient()
    const { http, calls } = fakeHttp({ id: 'pn_1', number: '+13055550199' })

    await attachPhoneNumber(svc, agentId, 'pn_1', { http, apiKey: 'k' })

    expect(calls[0].init.method).toBe('PATCH')
    expect(calls[0].url).toMatch(/\/phone-number\/pn_1$/)
    expect(JSON.parse(calls[0].init.body as string).assistantId).toBe('asst_pub')

    const { data } = await svc.from('agents').select('channel').eq('id', agentId).single()
    expect(data!.channel).toBe('+13055550199')
  })

  // Atar un número a un agente que no existe en el proveedor deja una línea muda.
  it('se niega si el agente no está publicado', async () => {
    const svc = serviceClient()
    const { data: c } = await svc.from('clients')
      .insert({ name: 'X', industry: 'Y' }).select().single()
    const { data: a } = await svc.from('agents').insert({
      client_id: c!.id, module_type: 'voice', name: 'Sin publicar', provider: 'vapi',
    }).select().single()

    const { http } = fakeHttp({})
    await expect(
      attachPhoneNumber(svc, a!.id, 'pn_1', { http, apiKey: 'k' }),
    ).rejects.toThrow(/no está publicado/i)
  })

  it('registra el fallo del proveedor en events', async () => {
    const { agentId } = await seedPublished()
    const svc = serviceClient()
    const { http } = fakeHttp({ message: 'not found' }, 404)

    await expect(
      attachPhoneNumber(svc, agentId, 'pn_x', { http, apiKey: 'k' }),
    ).rejects.toThrow(/404/)

    const { data } = await svc.from('events').select().eq('type', 'agent.phone_attach_failed')
    expect(data).toHaveLength(1)
  })
})
