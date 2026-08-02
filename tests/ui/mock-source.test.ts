import { describe, it, expect } from 'vitest'
import { mockSource } from '../../src/data/mock-source'

describe('fuente de datos mock', () => {
  it('lista los clientes del prototipo', async () => {
    const clients = await mockSource.listClients()
    expect(clients).toHaveLength(4)
    expect(clients[0]).toHaveProperty('industry')
  })

  it('devuelve null para un cliente inexistente', async () => {
    expect(await mockSource.getClient('no-existe')).toBeNull()
  })

  it('filtra los runs por cliente', async () => {
    const runs = await mockSource.listRuns({ clientId: 'cl-meridian' })
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.every(r => r.clientId === 'cl-meridian')).toBe(true)
  })

  it('filtra los runs por estado', async () => {
    const runs = await mockSource.listRuns({ status: 'failed' })
    expect(runs.every(r => r.status === 'failed')).toBe(true)
  })

  it('devuelve el detalle de un run con transcripción', async () => {
    const [first] = await mockSource.listRuns({})
    const run = await mockSource.getRun(first.id)
    expect(run!.transcript.length).toBeGreaterThan(0)
  })

  it('resume métricas del alcance pedido', async () => {
    const s = await mockSource.getSummary(null)
    expect(s.today).toBeGreaterThanOrEqual(0)
    expect(s.successRate).toBeLessThanOrEqual(1)
  })
})
