import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from '../db/client'
import { matchesCondition, buildRunContext } from '../../supabase/functions/_shared/actions'

async function seedRun(extracted: Record<string, string>) {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen Insurance Inc', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
  }).select().single()
  const { data: r } = await svc.from('runs').insert({
    client_id: c!.id, agent_id: a!.id, provider: 'vapi', provider_call_id: 'call_ctx',
    started_at: '2026-08-02T02:14:05.000Z', ended_at: '2026-08-02T02:17:41.000Z',
    duration_sec: 216, status: 'completed', caller_number: '+13055550147',
    summary: 'Solicita cancelación.',
  }).select().single()
  await svc.from('extracted_values').insert(
    Object.entries(extracted).map(([k, v]) => ({
      run_id: r!.id, field_key: k, value_text: v, extraction_version: 1,
    })),
  )
  return { clientId: c!.id as string, agentId: a!.id as string, runId: r!.id as string }
}

describe('condiciones de acción', () => {
  const ctx = { urgency: 'urgente', reason_category: 'siniestro' }

  it('sin condición se dispara siempre', () => {
    expect(matchesCondition(null, ctx)).toBe(true)
  })

  it('coincide cuando todos los pares casan', () => {
    expect(matchesCondition({ urgency: 'urgente' }, ctx)).toBe(true)
    expect(matchesCondition({ urgency: 'urgente', reason_category: 'siniestro' }, ctx)).toBe(true)
  })

  it('no coincide si algún par difiere', () => {
    expect(matchesCondition({ urgency: 'normal' }, ctx)).toBe(false)
    expect(matchesCondition({ urgency: 'urgente', reason_category: 'pago' }, ctx)).toBe(false)
  })

  it('no coincide si el campo no existe', () => {
    expect(matchesCondition({ inexistente: 'x' }, ctx)).toBe(false)
  })

  it('acepta una lista de valores admitidos', () => {
    expect(matchesCondition({ reason_category: ['siniestro', 'cancelación'] }, ctx)).toBe(true)
    expect(matchesCondition({ reason_category: ['pago'] }, ctx)).toBe(false)
  })
})

describe('contexto del run', () => {
  beforeEach(resetData)

  it('reúne cliente, agente, campos y transcripción', async () => {
    const { runId } = await seedRun({ caller_name: 'Rosa', urgency: 'normal' })
    const svc = serviceClient()
    await svc.from('transcript_turns').insert([
      { run_id: runId, seq: 1, speaker: 'agent', text: 'Buenas noches.' },
      { run_id: runId, seq: 2, speaker: 'caller', text: 'Quiero cancelar.' },
    ])

    const ctx = await buildRunContext(svc, runId)

    expect(ctx!.clientName).toBe('Magen Insurance Inc')
    expect(ctx!.agentName).toBe('Intake')
    expect(ctx!.durationSec).toBe(216)
    expect(ctx!.callerNumber).toBe('+13055550147')
    expect(ctx!.fields.caller_name).toBe('Rosa')
    expect(ctx!.turns).toHaveLength(2)
    expect(ctx!.turns[0].speaker).toBe('agent')
  })

  it('devuelve null si el run no existe', async () => {
    const ctx = await buildRunContext(serviceClient(), '00000000-0000-4000-8000-000000000000')
    expect(ctx).toBeNull()
  })
})
