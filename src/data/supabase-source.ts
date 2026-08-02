import type { DataSource, RunFilter } from './source'
import type { Agent, Client, FieldDef, ModuleType, Run, RunStatus, TranscriptTurn } from '../types'
import type { DayPoint, Summary } from '../lib/metrics'
import { supabase } from '../lib/supabase'

/** Columnas de un run más lo necesario para calcular su costo. */
const RUN_COLUMNS = `
  id, client_id, agent_id, started_at, duration_sec, status, latency_ms,
  summary, recording_url, ended_reason, extraction_status,
  usage_events ( cost_usd )
`

interface RunRow {
  id: string
  client_id: string
  agent_id: string
  started_at: string
  duration_sec: number | null
  status: string
  latency_ms: number | null
  summary: string | null
  ended_reason: string | null
  extraction_status: string
  usage_events: { cost_usd: number | string | null }[] | null
}

function sumCost(rows: { cost_usd: number | string | null }[] | null): number {
  return (rows ?? []).reduce((s, u) => s + Number(u.cost_usd ?? 0), 0)
}

function toRun(
  row: RunRow,
  transcript: TranscriptTurn[] = [],
  extracted: Record<string, string> = {},
): Run {
  return {
    id: row.id,
    clientId: row.client_id,
    agentId: row.agent_id,
    startedAt: row.started_at,
    durationSec: row.duration_sec ?? 0,
    status: row.status as RunStatus,
    costUsd: sumCost(row.usage_events),
    latencyMs: row.latency_ms ?? 0,
    // El console muestra un mensaje de error por run; la razón de fin del
    // proveedor es lo más cercano que tiene la base.
    errorMessage: row.status === 'failed'
      ? (row.ended_reason ?? 'Fallo sin detalle')
      : undefined,
    transcript,
    extracted,
  }
}

export const supabaseSource: DataSource = {
  name: 'supabase',

  async listClients(): Promise<Client[]> {
    const { data, error } = await supabase
      .from('clients')
      .select('*, agents ( module_type )')
      .order('name')
    if (error) throw new Error(error.message)

    return (data ?? []).map(c => ({
      id: c.id,
      name: c.name,
      industry: c.industry,
      status: c.status as Client['status'],
      // La base no guarda módulos por cliente: se deducen de sus agentes.
      modules: [...new Set(
        ((c.agents ?? []) as { module_type: string }[]).map(a => a.module_type as ModuleType),
      )],
      contactName: c.contact_name ?? '',
      contactEmail: c.contact_email ?? '',
      timezone: c.timezone,
      createdAt: c.created_at.slice(0, 10),
      notes: c.notes ?? '',
    }))
  },

  async getClient(id: string): Promise<Client | null> {
    const all = await this.listClients()
    return all.find(c => c.id === id) ?? null
  },

  async listAgents(clientId?: string | null): Promise<Agent[]> {
    let q = supabase.from('agents').select('*, field_defs ( * )').order('name')
    if (clientId) q = q.eq('client_id', clientId)
    const { data, error } = await q
    if (error) throw new Error(error.message)

    return (data ?? []).map(a => ({
      id: a.id,
      clientId: a.client_id,
      name: a.name,
      description: a.description ?? '',
      module: a.module_type as ModuleType,
      provider: a.provider as Agent['provider'],
      channel: a.channel ?? '',
      status: a.status as Agent['status'],
      systemPrompt: a.system_prompt,
      fields: ((a.field_defs ?? []) as Record<string, unknown>[])
        .filter(f => f.intent_id === null)
        .sort((x, y) => Number(x.sort_order) - Number(y.sort_order))
        .map(f => ({
          id: String(f.id),
          name: String(f.key),
          type: f.type as FieldDef['type'],
          required: Boolean(f.required),
          description: (f.description as string) ?? '',
          options: (f.options as string[]) ?? undefined,
        })),
      lastRunAt: null,
      createdAt: a.created_at.slice(0, 10),
    }))
  },

  async getAgent(id: string): Promise<Agent | null> {
    const { data } = await supabase.from('agents').select('client_id').eq('id', id).maybeSingle()
    if (!data) return null
    const list = await this.listAgents(data.client_id)
    return list.find(a => a.id === id) ?? null
  },

  async listRuns(filter: RunFilter): Promise<Run[]> {
    let q = supabase.from('runs').select(RUN_COLUMNS).order('started_at', { ascending: false })
    if (filter.clientId) q = q.eq('client_id', filter.clientId)
    if (filter.agentId) q = q.eq('agent_id', filter.agentId)
    if (filter.status && filter.status !== 'all') q = q.eq('status', filter.status)
    if (filter.limit) q = q.limit(filter.limit)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    return ((data ?? []) as unknown as RunRow[]).map(r => toRun(r))
  },

  async getRun(id: string): Promise<Run | null> {
    const { data } = await supabase.from('runs').select(RUN_COLUMNS).eq('id', id).maybeSingle()
    if (!data) return null

    const [{ data: turns }, { data: values }] = await Promise.all([
      supabase.from('transcript_turns').select('speaker, text').eq('run_id', id).order('seq'),
      supabase.from('extracted_values')
        .select('field_key, value_text, extraction_version')
        .eq('run_id', id).order('extraction_version'),
    ])

    // La versión más alta gana: al reprocesar conviven varias.
    const extracted: Record<string, string> = {}
    for (const v of values ?? []) extracted[v.field_key] = v.value_text ?? ''

    return toRun(
      data as unknown as RunRow,
      (turns ?? []) as TranscriptTurn[],
      extracted,
    )
  },

  async getSummary(clientId: string | null): Promise<Summary> {
    const runs = await this.listRuns({ clientId })
    const today = new Date().toDateString()
    const todayRuns = runs.filter(r => new Date(r.startedAt).toDateString() === today)
    const finished = runs.filter(r => r.status !== 'in_progress')
    const completed = finished.filter(r => r.status === 'completed')

    return {
      today: todayRuns.length,
      successRate: finished.length ? completed.length / finished.length : 0,
      avgLatencyMs: finished.length
        ? finished.reduce((a, r) => a + r.latencyMs, 0) / finished.length
        : 0,
      totalCostToday: todayRuns.reduce((a, r) => a + r.costUsd, 0),
      failedToday: todayRuns.filter(r => r.status === 'failed').length,
    }
  },

  async getDailySeries(clientId: string | null, days: number): Promise<DayPoint[]> {
    const runs = await this.listRuns({ clientId })
    const out: DayPoint[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const dayRuns = runs.filter(r => new Date(r.startedAt).toDateString() === d.toDateString())
      out.push({
        label: i === 0 ? 'Today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        completed: dayRuns.filter(r => r.status === 'completed').length,
        failed: dayRuns.filter(r => r.status === 'failed').length,
        total: dayRuns.length,
      })
    }
    return out
  },
}
