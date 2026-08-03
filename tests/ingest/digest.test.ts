import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, resetData } from '../db/client'
import { runDigest } from '../../supabase/functions/_shared/actions'
import { renderDigestEmail } from '../../supabase/functions/_shared/email'

async function seed(opts: {
  recipients?: string[]
  calls?: { name: string; urgency: string; hoursAgo: number }[]
} = {}) {
  const svc = serviceClient()
  const { data: c } = await svc.from('clients')
    .insert({ name: 'Magen Insurance Inc', industry: 'Insurance' }).select().single()
  const { data: a } = await svc.from('agents').insert({
    client_id: c!.id, module_type: 'voice', name: 'Intake', provider: 'vapi',
  }).select().single()
  await svc.from('agent_actions').insert({
    agent_id: a!.id, type: 'email_digest',
    config: { recipients: opts.recipients ?? ['frontdesk@magen.test'], hour: 7 },
  })

  for (const [i, call] of (opts.calls ?? []).entries()) {
    const started = new Date(Date.now() - call.hoursAgo * 3600_000).toISOString()
    const { data: r } = await svc.from('runs').insert({
      client_id: c!.id, agent_id: a!.id, provider: 'vapi',
      provider_call_id: `call_dig_${i}`, started_at: started,
      duration_sec: 120, status: 'completed', caller_number: '+13055550100',
    }).select().single()
    await svc.from('extracted_values').insert([
      { run_id: r!.id, field_key: 'caller_name', value_text: call.name, extraction_version: 1 },
      { run_id: r!.id, field_key: 'urgency', value_text: call.urgency, extraction_version: 1 },
      { run_id: r!.id, field_key: 'callback_phone', value_text: '+13055550100', extraction_version: 1 },
    ])
  }
  return { clientId: c!.id as string, agentId: a!.id as string }
}

function fakeSender() {
  const sent: { to: string[]; subject: string; text: string }[] = []
  return { sent, sendEmail: async (m: typeof sent[number]) => { sent.push(m) } }
}

describe('resumen diario', () => {
  beforeEach(resetData)

  it('manda un resumen con las llamadas de las últimas 24 horas', async () => {
    await seed({ calls: [
      { name: 'Rosa', urgency: 'normal', hoursAgo: 3 },
      { name: 'Diego', urgency: 'normal', hoursAgo: 8 },
    ] })
    const svc = serviceClient()
    const s = fakeSender()

    const res = await runDigest(svc, { sendEmail: s.sendEmail })

    expect(res.sent).toBe(1)
    expect(s.sent[0].subject).toContain('2 llamadas')
    expect(s.sent[0].text).toContain('Rosa')
    expect(s.sent[0].text).toContain('Diego')

    const { data } = await svc.from('action_runs').select().eq('type', 'email_digest')
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('sent')
  })

  // Una llamada vieja ya salió en el resumen de ayer: repetirla confunde.
  it('excluye las llamadas de hace más de 24 horas', async () => {
    await seed({ calls: [
      { name: 'Reciente', urgency: 'normal', hoursAgo: 5 },
      { name: 'Anteayer', urgency: 'normal', hoursAgo: 40 },
    ] })
    const s = fakeSender()

    await runDigest(serviceClient(), { sendEmail: s.sendEmail })

    expect(s.sent[0].text).toContain('Reciente')
    expect(s.sent[0].text).not.toContain('Anteayer')
  })

  it('avisa en el asunto cuántas son urgentes', async () => {
    await seed({ calls: [
      { name: 'Rosa', urgency: 'normal', hoursAgo: 2 },
      { name: 'Amanda', urgency: 'urgente', hoursAgo: 4 },
    ] })
    const s = fakeSender()

    await runDigest(serviceClient(), { sendEmail: s.sendEmail })

    expect(s.sent[0].subject).toContain('1 urgente')
  })

  it('manda el resumen aunque no haya habido llamadas', async () => {
    await seed({ calls: [] })
    const s = fakeSender()

    const res = await runDigest(serviceClient(), { sendEmail: s.sendEmail })

    // Un resumen vacío confirma que el sistema sigue vivo; su ausencia no
    // distingue "noche tranquila" de "se cayó algo".
    expect(res.sent).toBe(1)
    expect(s.sent[0].subject).toContain('sin llamadas')
  })

  it('omite y deja constancia si no hay destinatarios', async () => {
    await seed({ recipients: [], calls: [{ name: 'Rosa', urgency: 'normal', hoursAgo: 1 }] })
    const svc = serviceClient()
    const s = fakeSender()

    const res = await runDigest(svc, { sendEmail: s.sendEmail })

    expect(res.skipped).toBe(1)
    expect(s.sent).toHaveLength(0)
    const { data } = await svc.from('action_runs').select().eq('type', 'email_digest')
    expect(data![0].status).toBe('skipped')
  })

  it('registra el fallo sin propagarlo', async () => {
    await seed({ calls: [{ name: 'Rosa', urgency: 'normal', hoursAgo: 1 }] })
    const svc = serviceClient()
    const sendEmail = async () => { throw new Error('Resend respondió 500') }

    const res = await runDigest(svc, { sendEmail })

    expect(res.failed).toBe(1)
    const { data } = await svc.from('action_runs').select().eq('type', 'email_digest')
    expect(data![0].error).toContain('500')
  })
})

describe('redacción del resumen', () => {
  it('pone las urgentes primero aunque hayan entrado después', () => {
    const { html, text } = renderDigestEmail('Magen', [
      {
        runId: '1', startedAt: '2026-08-02T02:00:00Z', durationSec: 60,
        status: 'completed', callerNumber: '+1305',
        fields: { caller_name: 'Normal', urgency: 'normal' },
      },
      {
        runId: '2', startedAt: '2026-08-02T05:00:00Z', durationSec: 90,
        status: 'completed', callerNumber: '+1305',
        fields: { caller_name: 'Urgente', urgency: 'urgente' },
      },
    ])

    expect(text.indexOf('Urgente')).toBeLessThan(text.indexOf('Normal'))
    expect(html.indexOf('Urgente')).toBeLessThan(html.indexOf('Normal'))
  })

  it('escapa el contenido de la llamada', () => {
    const { html } = renderDigestEmail('Magen', [{
      runId: '1', startedAt: '2026-08-02T02:00:00Z', durationSec: 60,
      status: 'completed', callerNumber: null,
      fields: { caller_name: '<img src=x onerror=alert(1)>' },
    }])
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
