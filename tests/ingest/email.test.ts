import { describe, it, expect } from 'vitest'
import { renderRunEmail } from '../../supabase/functions/_shared/email'
import type { RunContext } from '../../supabase/functions/_shared/actions'

const ctx: RunContext = {
  runId: 'r1', clientId: 'c1', clientName: 'Magen Insurance Inc',
  clientTimezone: 'America/New_York', agentId: 'a1', agentName: 'Intake general',
  startedAt: '2026-08-02T02:14:05.000Z', durationSec: 216, status: 'completed',
  callerNumber: '+13055550147',
  summary: 'Solicita cancelación de póliza de auto.',
  recordingUrl: 'https://storage.vapi.ai/rec/1.wav',
  fields: {
    caller_name: 'Rosa Elena Domínguez',
    callback_phone: '+13055550147',
    reason_category: 'cancelación',
    urgency: 'normal',
    policy_number: '',
  },
  turns: [
    { speaker: 'agent', text: 'Buenas noches, Magen Insurance.' },
    { speaker: 'caller', text: 'Quiero cancelar mi póliza.' },
  ],
}

describe('correo por llamada', () => {
  it('resume quién llamó y por qué en el asunto', () => {
    const { subject } = renderRunEmail(ctx)
    expect(subject).toContain('Rosa Elena Domínguez')
    expect(subject).toContain('cancelación')
  })

  it('marca el asunto cuando la llamada es urgente', () => {
    const { subject } = renderRunEmail({ ...ctx, fields: { ...ctx.fields, urgency: 'urgente' } })
    expect(subject.toLowerCase()).toContain('urgente')
  })

  it('incluye los datos capturados y la duración', () => {
    const { html, text } = renderRunEmail(ctx)
    expect(html).toContain('Rosa Elena Domínguez')
    expect(html).toContain('+13055550147')
    expect(text).toContain('3m 36s')
  })

  it('omite los campos vacíos en vez de mostrarlos en blanco', () => {
    const { html } = renderRunEmail(ctx)
    expect(html).not.toContain('policy_number')
  })

  it('usa las etiquetas configuradas cuando se le pasan', () => {
    const { html } = renderRunEmail(ctx, { caller_name: 'Nombre', callback_phone: 'Teléfono' })
    expect(html).toContain('Nombre')
    expect(html).toContain('Teléfono')
    expect(html).not.toContain('caller_name')
  })

  it('escapa el contenido para que no rompa el HTML', () => {
    const malicioso = { ...ctx, fields: { caller_name: '<script>alert(1)</script>' } }
    const { html } = renderRunEmail(malicioso)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('incluye la transcripción y el enlace a la grabación', () => {
    const { html } = renderRunEmail(ctx)
    expect(html).toContain('Quiero cancelar mi póliza.')
    expect(html).toContain('https://storage.vapi.ai/rec/1.wav')
  })
})
