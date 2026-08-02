import { describe, it, expect, beforeAll } from 'vitest'
import { serviceClient, resetData, applySeed } from './client'

// Aplica la semilla explícitamente: las otras pruebas llaman resetData y
// borrarían la que insertó `db reset`, según el orden en que corran.
beforeAll(async () => {
  await resetData()
  await applySeed()
})

describe('semilla', () => {
  it('crea a Magen activo', async () => {
    const { data } = await serviceClient()
      .from('clients').select().eq('name', 'Magen Insurance Inc').single()
    expect(data!.status).toBe('active')
    expect(data!.industry).toBe('Insurance')
  })

  it('crea el agente de intake en voz', async () => {
    const { data } = await serviceClient()
      .from('agents').select('name, module_type, provider, status').single()
    expect(data!.module_type).toBe('voice')
    expect(data!.provider).toBe('vapi')
  })

  it('crea los ocho campos universales del spec', async () => {
    const { data } = await serviceClient()
      .from('field_defs').select('key, required, intent_id').order('sort_order')
    expect(data!.map(f => f.key)).toEqual([
      'caller_name', 'callback_phone', 'reason_verbatim', 'reason_category',
      'is_existing_client', 'policy_number', 'urgency', 'summary',
    ])
    // Todos universales: ningún motivo activo en v1.
    expect(data!.every(f => f.intent_id === null)).toBe(true)
    // policy_number es el único opcional.
    expect(data!.filter(f => !f.required).map(f => f.key)).toEqual(['policy_number'])
  })

  it('deja el prompt con los tres guardrails del spec', async () => {
    const { data } = await serviceClient().from('agents').select('system_prompt').single()
    const p = data!.system_prompt.toLowerCase()
    expect(p).toContain('asistente automático')
    expect(p).toContain('911')
    expect(p).toContain('no procesa')
  })

  it('configura el correo por llamada', async () => {
    const { data } = await serviceClient()
      .from('agent_actions').select('type, enabled').eq('type', 'email_per_run')
    expect(data).toHaveLength(1)
    expect(data![0].enabled).toBe(true)
  })

  it('no crea ningún motivo todavía', async () => {
    const { data } = await serviceClient().from('agent_intents').select('id')
    expect(data).toEqual([])
  })
})
