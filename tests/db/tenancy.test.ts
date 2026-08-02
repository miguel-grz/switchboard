import { describe, it, expect, beforeEach } from 'vitest'
import { serviceClient, createUser, resetData } from './client'

describe('tenencia', () => {
  beforeEach(resetData)

  it('crea un cliente con estado por defecto onboarding', async () => {
    const { data, error } = await serviceClient()
      .from('clients')
      .insert({ name: 'Magen Insurance', industry: 'Insurance' })
      .select()
      .single()
    expect(error).toBeNull()
    expect(data!.status).toBe('onboarding')
    expect(data!.timezone).toBe('America/New_York')
  })

  it('rechaza un estado inválido', async () => {
    const { error } = await serviceClient()
      .from('clients')
      .insert({ name: 'X', industry: 'Y', status: 'zombie' })
    expect(error).not.toBeNull()
  })

  it('vincula un usuario a un cliente', async () => {
    const svc = serviceClient()
    const { data: client } = await svc
      .from('clients').insert({ name: 'Magen', industry: 'Insurance' }).select().single()
    const userId = await createUser('luis@magen.test', 'secret123', 'client_user')

    const { error } = await svc
      .from('client_members')
      .insert({ profile_id: userId, client_id: client!.id, role: 'owner' })
    expect(error).toBeNull()
  })

  it('borra la membresía al borrar el cliente', async () => {
    const svc = serviceClient()
    const { data: client } = await svc
      .from('clients').insert({ name: 'Temp', industry: 'Logistics' }).select().single()
    const userId = await createUser('temp@x.test', 'secret123', 'client_user')
    await svc.from('client_members').insert({ profile_id: userId, client_id: client!.id })

    await svc.from('clients').delete().eq('id', client!.id)

    const { data } = await svc.from('client_members').select().eq('profile_id', userId)
    expect(data).toEqual([])
  })
})
