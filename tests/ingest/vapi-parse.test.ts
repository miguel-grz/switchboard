import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAdapter } from '../../supabase/functions/_shared/providers/index'

const payload = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/vapi-end-of-call.json'), 'utf8'),
)
const vapi = getAdapter('vapi')

describe('parseo del reporte de llamada', () => {
  it('identifica el evento y la llamada', () => {
    const p = vapi.parseWebhook(payload)
    expect(p.eventType).toBe('end-of-call-report')
    expect(p.isFinal).toBe(true)
    expect(p.providerCallId).toBe('c1a2b3c4-0000-4000-8000-000000000001')
  })

  it('normaliza la llamada al modelo canónico', () => {
    const { run } = vapi.parseWebhook(payload)
    expect(run!.direction).toBe('inbound')
    expect(run!.callerNumber).toBe('+13055550147')
    expect(run!.status).toBe('completed')
    expect(run!.endedReason).toBe('customer-ended-call')
    expect(run!.recordingUrl).toMatch(/^https:\/\//)
    expect(run!.durationSec).toBe(216) // 02:17:41 − 02:14:05
  })

  it('convierte los mensajes en turnos ordenados', () => {
    const { run } = vapi.parseWebhook(payload)
    expect(run!.turns).toHaveLength(4)
    expect(run!.turns[0]).toMatchObject({ seq: 1, speaker: 'agent' })
    expect(run!.turns[1]).toMatchObject({ seq: 2, speaker: 'caller' })
    expect(run!.turns[1].text).toContain('cancelar mi póliza')
    expect(run!.turns[1].offsetMs).toBe(7200)
  })

  it('aplana los datos extraídos a texto', () => {
    const { run } = vapi.parseWebhook(payload)
    // Todo llega como texto porque extracted_values guarda value_text: el tipo
    // real lo declara field_defs, no el proveedor.
    expect(run!.extracted.caller_name).toBe('Rosa Elena Domínguez')
    expect(run!.extracted.is_existing_client).toBe('true')
    expect(run!.extracted.policy_number).toBe('')
  })

  it('marca no_answer cuando nadie contestó', () => {
    const sin = structuredClone(payload)
    sin.message.endedReason = 'customer-did-not-answer'
    const { run } = vapi.parseWebhook(sin)
    expect(run!.status).toBe('no_answer')
  })

  it('marca failed ante un error del proveedor', () => {
    const err = structuredClone(payload)
    err.message.endedReason = 'pipeline-error-openai-llm-failed'
    const { run } = vapi.parseWebhook(err)
    expect(run!.status).toBe('failed')
  })

  it('no revienta si falta el bloque de análisis', () => {
    const parcial = structuredClone(payload)
    delete parcial.message.analysis
    const { run, events } = vapi.parseWebhook(parcial)
    expect(run!.extracted).toEqual({})
    expect(run!.summary).toBeNull()
    // Debe avisar, no fallar en silencio: sin esto una extracción vacía parece normal.
    expect(events.some(e => e.level === 'warn')).toBe(true)
  })

  it('trata status-update como evento no final', () => {
    const p = vapi.parseWebhook({
      message: { type: 'status-update', status: 'in-progress', call: { id: 'c9' } },
    })
    expect(p.isFinal).toBe(false)
    expect(p.eventType).toBe('status-update')
    expect(p.providerCallId).toBe('c9')
  })
})
