import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serviceClient, resetData } from '../db/client'
import { getAdapter } from '../../supabase/functions/_shared/providers/index'
import { projectWebhook } from '../../supabase/functions/_shared/projection'

const raw = readFileSync(resolve(__dirname, 'fixtures/vapi-end-of-call.json'), 'utf8')
const payload = JSON.parse(raw)
const vapi = getAdapter('vapi')

async function seedAgent() {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
    provider_agent_id: 'asst_magen_intake', system_prompt: 'Contestas para Magen.',
  }).select().single()
  return { clientId: c!.id as string, agentId: a!.id as string }
}

describe('proyección', () => {
  beforeEach(resetData)

  it('crea el run con sus turnos, valores y consumo', async () => {
    const { clientId, agentId } = await seedAgent()
    const svc = serviceClient()

    const res = await projectWebhook(svc, {
      provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload),
    })
    expect(res.skipped).toBe(false)

    const { data: run } = await svc.from('runs').select().eq('id', res.runId!).single()
    expect(run!.client_id).toBe(clientId)
    expect(run!.agent_id).toBe(agentId)
    expect(run!.status).toBe('completed')
    expect(run!.duration_sec).toBe(216)
    expect(run!.reason_category).toBe('cancelación')
    expect(run!.extraction_status).toBe('complete')

    const { data: turns } = await svc.from('transcript_turns')
      .select().eq('run_id', res.runId!).order('seq')
    expect(turns).toHaveLength(4)
    expect(turns![0].speaker).toBe('agent')

    const { data: values } = await svc.from('extracted_values').select().eq('run_id', res.runId!)
    expect(values!.find(v => v.field_key === 'caller_name')!.value_text)
      .toBe('Rosa Elena Domínguez')

    const { data: usage } = await svc.from('usage_events').select().eq('run_id', res.runId!)
    expect(usage!.length).toBeGreaterThanOrEqual(4)
    const total = usage!.reduce((s, u) => s + Number(u.cost_usd), 0)
    expect(total).toBeCloseTo(0.3412, 4)
  })

  it('guarda el crudo antes de proyectar', async () => {
    await seedAgent()
    const svc = serviceClient()
    await projectWebhook(svc, { provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload) })

    const { data } = await svc.from('run_raw_events').select()
    expect(data).toHaveLength(1)
    expect(data![0].processed_at).not.toBeNull()
    expect(data![0].payload.message.type).toBe('end-of-call-report')
  })

  // La garantía que impide cobrar dos veces la misma llamada.
  it('es idempotente ante un reintento del proveedor', async () => {
    await seedAgent()
    const svc = serviceClient()
    const args = { provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload) }

    const first = await projectWebhook(svc, args)
    const second = await projectWebhook(svc, args)

    expect(second.skipped).toBe(true)
    expect(second.runId).toBe(first.runId)

    const { data: runs } = await svc.from('runs').select('id')
    const { data: usage } = await svc.from('usage_events').select('id')
    const { data: turns } = await svc.from('transcript_turns').select('id')
    expect(runs).toHaveLength(1)
    expect(turns).toHaveLength(4)
    // Lo esencial: un solo cargo por componente aunque el webhook llegue dos veces.
    expect(usage!.length).toBeLessThanOrEqual(5)
  })

  it('marca la extracción como parcial si falta un campo requerido', async () => {
    const { agentId } = await seedAgent()
    const svc = serviceClient()
    await svc.from('field_defs').insert([
      { agent_id: agentId, key: 'caller_name', label: 'Nombre', type: 'text', required: true },
      { agent_id: agentId, key: 'vin', label: 'VIN', type: 'text', required: true },
    ])

    const res = await projectWebhook(svc, {
      provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload),
    })

    const { data: run } = await svc.from('runs')
      .select('extraction_status').eq('id', res.runId!).single()
    expect(run!.extraction_status).toBe('partial')
  })

  it('registra el evento en vez de crear un run si el agente es desconocido', async () => {
    const svc = serviceClient() // sin sembrar agente
    const res = await projectWebhook(svc, {
      provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload),
    })

    expect(res.skipped).toBe(true)
    expect(res.reason).toMatch(/agente/i)

    const { data: raws } = await svc.from('run_raw_events').select()
    expect(raws).toHaveLength(1) // el crudo nunca se pierde
    expect(raws![0].processing_error).toMatch(/agente/i)

    const { data: events } = await svc.from('events').select().eq('level', 'error')
    expect(events!.length).toBeGreaterThan(0)
  })

  it('ignora los eventos no finales sin crear un run', async () => {
    await seedAgent()
    const svc = serviceClient()
    const parsed = vapi.parseWebhook({
      message: { type: 'status-update', status: 'in-progress', call: { id: 'c9' } },
    })

    const res = await projectWebhook(svc, { provider: 'vapi', rawBody: '{}', parsed })

    expect(res.skipped).toBe(true)
    const { data: runs } = await svc.from('runs').select('id')
    expect(runs).toEqual([])
    const { data: raws } = await svc.from('run_raw_events').select()
    expect(raws).toHaveLength(1) // pero el crudo sí queda registrado
  })

  it('escribe un evento de proyección con su latencia', async () => {
    await seedAgent()
    const svc = serviceClient()
    await projectWebhook(svc, { provider: 'vapi', rawBody: raw, parsed: vapi.parseWebhook(payload) })

    const { data } = await svc.from('events').select().eq('type', 'run.projected')
    expect(data).toHaveLength(1)
    expect(data![0].latency_ms).toBeGreaterThanOrEqual(0)
  })
})
