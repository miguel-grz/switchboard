import { describe, it, expect, beforeAll } from 'vitest'
import { serviceClient, createUser, resetData } from '../db/client'
import { supabaseEnv } from '../db/env'

// La fuente lee las variables al importarse: hay que fijarlas antes.
const env = supabaseEnv()
process.env.VITE_SUPABASE_URL = env.url
process.env.VITE_SUPABASE_ANON_KEY = env.anonKey

const { supabase } = await import('../../src/lib/supabase')
const { supabaseSource } = await import('../../src/data/supabase-source')

let clientId: string, agentId: string, runId: string

beforeAll(async () => {
  await resetData()
  const svc = serviceClient()

  const { data: c } = await svc.from('clients').insert({
    name: 'Magen Insurance Inc', industry: 'Insurance', status: 'active',
    contact_name: 'Luis Arenas', contact_email: 'luis@magen.test',
  }).select().single()
  clientId = c!.id

  const { data: a } = await svc.from('agents').insert({
    client_id: clientId, module_type: 'voice', name: 'Intake general',
    description: 'Atiende fuera de horario.', provider: 'vapi',
    channel: '+13055550100', status: 'active', system_prompt: 'Contestas para Magen.',
  }).select().single()
  agentId = a!.id

  await svc.from('field_defs').insert([
    { agent_id: agentId, key: 'caller_name', label: 'Nombre', type: 'text', required: true, sort_order: 0 },
    { agent_id: agentId, key: 'urgency', label: 'Urgencia', type: 'select', required: true, sort_order: 1, options: ['normal', 'urgente'] },
  ])

  const { data: r } = await svc.from('runs').insert({
    client_id: clientId, agent_id: agentId, provider: 'vapi',
    provider_call_id: 'call_ui_1', started_at: new Date().toISOString(),
    duration_sec: 216, status: 'completed', latency_ms: 540,
    summary: 'Solicita cancelación.',
  }).select().single()
  runId = r!.id

  await svc.from('transcript_turns').insert([
    { run_id: runId, seq: 1, speaker: 'agent', text: 'Buenas noches.' },
    { run_id: runId, seq: 2, speaker: 'caller', text: 'Quiero cancelar.' },
  ])
  await svc.from('extracted_values').insert([
    { run_id: runId, field_key: 'caller_name', value_text: 'Rosa', extraction_version: 1 },
  ])
  await svc.from('usage_events').insert([
    {
      client_id: clientId, agent_id: agentId, module_type: 'voice', run_id: runId,
      provider: 'vapi', component: 'llm', quantity: 1, unit: 'calls',
      cost_usd: 0.21, source_event_id: 'evt_ui_1', occurred_at: new Date().toISOString(),
    },
  ])

  await createUser('op@switchboard.test', 'secret123', 'operator')
  await supabase.auth.signInWithPassword({ email: 'op@switchboard.test', password: 'secret123' })
})

describe('fuente de datos real', () => {
  it('lista clientes con sus módulos derivados de los agentes', async () => {
    const list = await supabaseSource.listClients()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Magen Insurance Inc')
    // La base no tiene columna de módulos: se deducen de los agentes.
    expect(list[0].modules).toContain('voice')
  })

  it('trae el agente con sus campos configurados', async () => {
    const agent = await supabaseSource.getAgent(agentId)
    expect(agent!.name).toBe('Intake general')
    expect(agent!.fields).toHaveLength(2)
    expect(agent!.fields[1].options).toEqual(['normal', 'urgente'])
  })

  it('lista runs con su costo sumado del ledger', async () => {
    const runs = await supabaseSource.listRuns({ clientId })
    expect(runs).toHaveLength(1)
    expect(runs[0].costUsd).toBeCloseTo(0.21, 4)
    expect(runs[0].durationSec).toBe(216)
  })

  it('trae el detalle con transcripción y datos extraídos', async () => {
    const run = await supabaseSource.getRun(runId)
    expect(run!.transcript).toHaveLength(2)
    expect(run!.transcript[0].speaker).toBe('agent')
    expect(run!.extracted.caller_name).toBe('Rosa')
  })

  it('filtra por estado', async () => {
    expect(await supabaseSource.listRuns({ status: 'failed' })).toHaveLength(0)
    expect(await supabaseSource.listRuns({ status: 'completed' })).toHaveLength(1)
  })

  it('devuelve null si el run no existe', async () => {
    expect(await supabaseSource.getRun('00000000-0000-4000-8000-000000000000')).toBeNull()
  })

  it('resume métricas del alcance', async () => {
    const s = await supabaseSource.getSummary(clientId)
    expect(s.successRate).toBe(1)
    expect(s.avgLatencyMs).toBe(540)
  })
})
