import type { DataSource, RunFilter } from './source'
import { clients } from '../mocks/clients'
import { agents } from '../mocks/agents'
import { runs } from '../mocks/runs'
import { dailySeries, scopedRuns, summarize } from '../lib/metrics'

/** Envuelve los datos de muestra tras el mismo contrato que la fuente real. */
export const mockSource: DataSource = {
  name: 'mock',

  async listClients() { return clients },
  async getClient(id) { return clients.find(c => c.id === id) ?? null },

  async listAgents(clientId) {
    return clientId ? agents.filter(a => a.clientId === clientId) : agents
  },
  async getAgent(id) { return agents.find(a => a.id === id) ?? null },

  async listRuns(filter: RunFilter) {
    let out = runs
    if (filter.clientId) out = out.filter(r => r.clientId === filter.clientId)
    if (filter.agentId) out = out.filter(r => r.agentId === filter.agentId)
    if (filter.status && filter.status !== 'all') {
      out = out.filter(r => r.status === filter.status)
    }
    return filter.limit ? out.slice(0, filter.limit) : out
  },

  async getRun(id) { return runs.find(r => r.id === id) ?? null },

  async getSummary(clientId) { return summarize(scopedRuns(clientId)) },
  async getDailySeries(clientId, days) { return dailySeries(scopedRuns(clientId), days) },
}
