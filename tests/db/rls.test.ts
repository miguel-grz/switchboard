import { describe, it, expect, beforeAll } from 'vitest'
import { serviceClient, userClient, createUser, resetData } from './client'
import type { SupabaseClient } from '@supabase/supabase-js'

let magenId: string, otroId: string
let magenAgentId: string
let operador: SupabaseClient
let usuarioMagen: SupabaseClient

beforeAll(async () => {
  await resetData()
  const svc = serviceClient()

  const { data: m } = await svc.from('clients')
    .insert({ name: 'Magen Insurance', industry: 'Insurance' }).select().single()
  const { data: o } = await svc.from('clients')
    .insert({ name: 'Cargoline', industry: 'Logistics' }).select().single()
  magenId = m!.id; otroId = o!.id

  const { data: a } = await svc.from('agents')
    .insert({ client_id: magenId, module_type: 'voice', name: 'Intake', provider: 'vapi' })
    .select().single()
  magenAgentId = a!.id

  // Un run y un costo para cada cliente.
  for (const [cid, call] of [[magenId, 'call_m'], [otroId, 'call_o']] as const) {
    const { data: ag } = await svc.from('agents')
      .insert({ client_id: cid, module_type: 'voice', name: 'A', provider: 'vapi' })
      .select().single()
    const { data: run } = await svc.from('runs').insert({
      client_id: cid, agent_id: ag!.id, provider: 'vapi', provider_call_id: call,
      started_at: new Date().toISOString(), status: 'completed',
    }).select().single()
    await svc.from('usage_events').insert({
      client_id: cid, agent_id: ag!.id, module_type: 'voice', run_id: run!.id,
      provider: 'vapi', component: 'llm', quantity: 100, unit: 'tokens',
      cost_usd: 0.05, source_event_id: `evt_${call}`, occurred_at: new Date().toISOString(),
    })
  }

  const opId = await createUser('operador@switchboard.test', 'secret123', 'operator')
  const cuId = await createUser('luis@magen.test', 'secret123', 'client_user')
  await svc.from('client_members').insert({ profile_id: cuId, client_id: magenId, role: 'owner' })
  void opId

  operador = await userClient('operador@switchboard.test', 'secret123')
  usuarioMagen = await userClient('luis@magen.test', 'secret123')
})

describe('RLS — operador', () => {
  it('ve todos los clientes', async () => {
    const { data } = await operador.from('clients').select('id')
    expect(data).toHaveLength(2)
  })

  it('ve los costos internos', async () => {
    const { data } = await operador.from('usage_events').select('cost_usd')
    expect(data!.length).toBe(2)
  })
})

describe('RLS — usuario de cliente', () => {
  it('ve solo su propio cliente', async () => {
    const { data } = await usuarioMagen.from('clients').select('id, name')
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(magenId)
  })

  it('no ve los runs de otro cliente', async () => {
    const { data } = await usuarioMagen.from('runs').select('client_id')
    expect(data!.every(r => r.client_id === magenId)).toBe(true)
    expect(data!.length).toBe(1)
  })

  // El costo interno no se expone jamás a un cliente.
  it('no lee ninguna fila de usage_events, ni la suya', async () => {
    const { data } = await usuarioMagen.from('usage_events').select('cost_usd')
    expect(data).toEqual([])
  })

  it('no lee los eventos crudos del proveedor', async () => {
    const { data } = await usuarioMagen.from('run_raw_events').select('id')
    expect(data).toEqual([])
  })

  it('no puede crear agentes', async () => {
    const { error } = await usuarioMagen.from('agents').insert({
      client_id: magenId, module_type: 'voice', name: 'Pirata', provider: 'vapi',
    })
    expect(error).not.toBeNull()
  })

  it('no puede añadirse a otro cliente', async () => {
    const { data: me } = await usuarioMagen.auth.getUser()
    const { error } = await usuarioMagen.from('client_members')
      .insert({ profile_id: me.user!.id, client_id: otroId })
    expect(error).not.toBeNull()
  })

  it('no ve los campos configurados de otro cliente', async () => {
    const svc = serviceClient()
    const { data: otroAgent } = await svc.from('agents').select('id').eq('client_id', otroId).limit(1)
    await svc.from('field_defs').insert({
      agent_id: otroAgent![0].id, key: 'secreto', label: 'Secreto', type: 'text',
    })
    await svc.from('field_defs').insert({
      agent_id: magenAgentId, key: 'caller_name', label: 'Nombre', type: 'text',
    })

    const { data } = await usuarioMagen.from('field_defs').select('key')
    expect(data!.map(f => f.key)).toEqual(['caller_name'])
  })
})

describe('RLS — anónimo', () => {
  it('no ve absolutamente nada', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const { supabaseEnv } = await import('./env')
    const { url, anonKey } = supabaseEnv()
    const anon = createClient(url, anonKey, { auth: { persistSession: false } })
    const { data } = await anon.from('clients').select('id')
    expect(data).toEqual([])
  })
})
