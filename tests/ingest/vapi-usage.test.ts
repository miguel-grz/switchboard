import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAdapter } from '../../supabase/functions/_shared/providers/index'
import type { FieldDef } from '../../supabase/functions/_shared/types'

const payload = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/vapi-end-of-call.json'), 'utf8'),
)
const vapi = getAdapter('vapi')

describe('consumo y costo', () => {
  it('desglosa el costo por componente', () => {
    const { usage } = vapi.parseWebhook(payload)
    const byComponent = Object.fromEntries(usage.map(u => [u.component, u]))

    expect(byComponent.telephony.costUsd).toBeCloseTo(0.0362, 6)
    expect(byComponent.stt.costUsd).toBeCloseTo(0.0431, 6)
    expect(byComponent.llm.costUsd).toBeCloseTo(0.1204, 6)
    expect(byComponent.tts.costUsd).toBeCloseTo(0.0915, 6)
    // La comisión de la plataforma no encaja en ningún componente técnico.
    expect(byComponent.other.costUsd).toBeCloseTo(0.05, 6)
  })

  it('suma exactamente el costo total reportado', () => {
    const { usage } = vapi.parseWebhook(payload)
    const total = usage.reduce((s, u) => s + (u.costUsd ?? 0), 0)
    expect(total).toBeCloseTo(payload.message.call.cost, 6)
  })

  it('da a cada cargo un identificador estable para idempotencia', () => {
    const a = vapi.parseWebhook(payload).usage
    const b = vapi.parseWebhook(payload).usage
    expect(a.map(u => u.sourceEventId)).toEqual(b.map(u => u.sourceEventId))
    expect(new Set(a.map(u => u.sourceEventId)).size).toBe(a.length)
    expect(a[0].sourceEventId).toContain(payload.message.call.id)
  })

  it('imputa los minutos de telefonía a partir de la duración', () => {
    const { usage } = vapi.parseWebhook(payload)
    const tel = usage.find(u => u.component === 'telephony')!
    expect(tel.unit).toBe('minutes')
    expect(tel.quantity).toBeCloseTo(216 / 60, 3)
  })

  it('acepta el desglose como arreglo además de como objeto', () => {
    const arr = structuredClone(payload)
    arr.message.call.costBreakdown = [
      { type: 'transport', cost: 0.02 },
      { type: 'model', cost: 0.08 },
    ]
    const { usage } = vapi.parseWebhook(arr)
    const map = Object.fromEntries(usage.map(u => [u.component, u.costUsd]))
    expect(map.telephony).toBeCloseTo(0.02, 6)
    expect(map.llm).toBeCloseTo(0.08, 6)
  })

  it('registra el costo total sin desglose cuando no viene', () => {
    const sin = structuredClone(payload)
    delete sin.message.call.costBreakdown
    const { usage, events } = vapi.parseWebhook(sin)
    expect(usage).toHaveLength(1)
    expect(usage[0].component).toBe('other')
    expect(usage[0].costUsd).toBeCloseTo(0.3412, 6)
    expect(events.some(e => e.type === 'usage.breakdown_missing')).toBe(true)
  })
})

describe('esquema de extracción', () => {
  const fields: FieldDef[] = [
    { key: 'caller_name', label: 'Nombre', type: 'text', required: true, description: 'Nombre completo', options: null },
    { key: 'is_existing_client', label: 'Cliente', type: 'boolean', required: true, description: null, options: null },
    { key: 'reason_category', label: 'Categoría', type: 'select', required: true, description: 'Motivo', options: ['cancelación', 'pago'] },
    { key: 'policy_number', label: 'Póliza', type: 'text', required: false, description: null, options: null },
  ]

  it('traduce field_defs a JSON Schema', () => {
    const schema = vapi.buildExtractionSchema(fields) as any
    expect(schema.type).toBe('object')
    expect(schema.properties.caller_name).toMatchObject({ type: 'string', description: 'Nombre completo' })
    expect(schema.properties.is_existing_client.type).toBe('boolean')
  })

  it('convierte las opciones de un select en enum', () => {
    const schema = vapi.buildExtractionSchema(fields) as any
    expect(schema.properties.reason_category.enum).toEqual(['cancelación', 'pago'])
  })

  it('lista como requeridos solo los campos obligatorios', () => {
    const schema = vapi.buildExtractionSchema(fields) as any
    expect(schema.required).toEqual(['caller_name', 'is_existing_client', 'reason_category'])
  })
})
