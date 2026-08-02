import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from '../db/client'
import { runActions } from '../../supabase/functions/_shared/actions'

async function seed(
  actions: { type: string; config: unknown; condition?: unknown; enabled?: boolean }[],
  fields: Record<string, string> = { caller_name: 'Rosa', urgency: 'normal' },
) {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
  }).select().single()
  const { data: r } = await svc.from('runs').insert({
    client_id: c!.id, agent_id: a!.id, provider: 'vapi', provider_call_id: 'call_act',
    started_at: new Date().toISOString(), status: 'completed', duration_sec: 100,
  }).select().single()
  await svc.from('extracted_values').insert(
    Object.entries(fields).map(([k, v]) => ({
      run_id: r!.id, field_key: k, value_text: v, extraction_version: 1,
    })),
  )
  await svc.from('agent_actions').insert(
    actions.map((x, i) => ({
      agent_id: a!.id, type: x.type, config: x.config,
      condition: x.condition ?? null, enabled: x.enabled ?? true, sort_order: i,
    })),
  )
  return { runId: r!.id as string, agentId: a!.id as string }
}

function fakeSender() {
  const sent: { to: string[]; subject: string }[] = []
  return {
    sent,
    sendEmail: async (m: { to: string[]; subject: string }) => { sent.push(m) },
  }
}

describe('ejecutor de acciones', () => {
  beforeEach(resetData)

  it('manda el correo configurado y lo registra', async () => {
    const { runId } = await seed([
      { type: 'email_per_run', config: { recipients: ['frontdesk@magen.test'] } },
    ])
    const svc = serviceClient()
    const s = fakeSender()

    const res = await runActions(svc, runId, { sendEmail: s.sendEmail })

    expect(res.executed).toBe(1)
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0].to).toEqual(['frontdesk@magen.test'])

    const { data } = await svc.from('action_runs').select().eq('run_id', runId)
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('sent')
  })

  it('omite las acciones deshabilitadas', async () => {
    const { runId } = await seed([
      { type: 'email_per_run', config: { recipients: ['a@x.test'] }, enabled: false },
    ])
    const s = fakeSender()
    const res = await runActions(serviceClient(), runId, { sendEmail: s.sendEmail })
    expect(res.executed).toBe(0)
    expect(s.sent).toHaveLength(0)
  })

  it('respeta la condición y deja constancia de lo omitido', async () => {
    const { runId } = await seed([
      { type: 'email_per_run', config: { recipients: ['a@x.test'] }, condition: { urgency: 'urgente' } },
    ])
    const svc = serviceClient()
    const s = fakeSender()

    await runActions(svc, runId, { sendEmail: s.sendEmail })

    expect(s.sent).toHaveLength(0)
    const { data } = await svc.from('action_runs').select().eq('run_id', runId)
    expect(data![0].status).toBe('skipped')
  })

  it('dispara cuando la condición se cumple', async () => {
    const { runId } = await seed(
      [{ type: 'email_per_run', config: { recipients: ['a@x.test'] }, condition: { urgency: 'urgente' } }],
      { caller_name: 'Rosa', urgency: 'urgente' },
    )
    const s = fakeSender()
    await runActions(serviceClient(), runId, { sendEmail: s.sendEmail })
    expect(s.sent).toHaveLength(1)
  })

  // Una acción rota no puede tumbar las demás ni la ingesta.
  it('registra el fallo y continúa con el resto', async () => {
    const { runId } = await seed([
      { type: 'email_per_run', config: { recipients: ['rompe@x.test'] } },
      { type: 'email_per_run', config: { recipients: ['ok@x.test'] } },
    ])
    const svc = serviceClient()
    const sent: string[][] = []
    const sendEmail = async (m: { to: string[] }) => {
      if (m.to[0] === 'rompe@x.test') throw new Error('Resend respondió 429')
      sent.push(m.to)
    }

    const res = await runActions(svc, runId, { sendEmail })

    expect(res.failed).toBe(1)
    expect(sent).toEqual([['ok@x.test']])

    const { data } = await svc.from('action_runs').select().eq('run_id', runId)
    const failed = data!.find(x => x.status === 'failed')!
    expect(failed.error).toContain('429')
  })

  it('omite las acciones sin destinatarios en vez de fallar', async () => {
    const { runId } = await seed([{ type: 'email_per_run', config: { recipients: [] } }])
    const svc = serviceClient()
    const s = fakeSender()

    await runActions(svc, runId, { sendEmail: s.sendEmail })

    expect(s.sent).toHaveLength(0)
    const { data } = await svc.from('action_runs').select().eq('run_id', runId)
    expect(data![0].status).toBe('skipped')
  })

  it('ignora los tipos aún no implementados sin romperse', async () => {
    const { runId } = await seed([
      { type: 'webhook', config: { url: 'https://crm.test/hook' } },
    ])
    const svc = serviceClient()
    const s = fakeSender()

    const res = await runActions(svc, runId, { sendEmail: s.sendEmail })

    expect(res.failed).toBe(0)
    const { data } = await svc.from('action_runs').select().eq('run_id', runId)
    expect(data![0].status).toBe('skipped')
  })

  it('no hace nada si el run no existe', async () => {
    const s = fakeSender()
    const res = await runActions(
      serviceClient(), '00000000-0000-4000-8000-000000000000', { sendEmail: s.sendEmail },
    )
    expect(res.executed).toBe(0)
  })
})
