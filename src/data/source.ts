import type { Agent, Client, Run, RunStatus } from '../types'
import type { Summary, DayPoint } from '../lib/metrics'

export interface RunFilter {
  clientId?: string | null
  agentId?: string | null
  status?: RunStatus | 'all'
  limit?: number
}

/**
 * Contrato único de datos del console.
 *
 * Devuelve los mismos tipos que ya consumen las pantallas: adaptar aquí y no
 * en los componentes es lo que permite cambiar de fuente sin tocar la UI.
 */
export interface DataSource {
  readonly name: 'mock' | 'supabase'
  listClients(): Promise<Client[]>
  getClient(id: string): Promise<Client | null>
  listAgents(clientId?: string | null): Promise<Agent[]>
  getAgent(id: string): Promise<Agent | null>
  listRuns(filter: RunFilter): Promise<Run[]>
  getRun(id: string): Promise<Run | null>
  getSummary(clientId: string | null): Promise<Summary>
  getDailySeries(clientId: string | null, days: number): Promise<DayPoint[]>
}
