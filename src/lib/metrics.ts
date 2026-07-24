import type { Run } from '../types'
import { runs } from '../mocks/runs'
import { fmtDate } from './format'

export function scopedRuns(clientId: string | null): Run[] {
  return clientId ? runs.filter((r) => r.clientId === clientId) : runs
}

export function runsForAgent(agentId: string): Run[] {
  return runs.filter((r) => r.agentId === agentId)
}

export function lastRunFor(agentId: string): Run | undefined {
  return runsForAgent(agentId)[0]
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.toDateString() === now.toDateString()
}

export interface Summary {
  today: number
  successRate: number
  avgLatencyMs: number
  totalCostToday: number
  failedToday: number
}

export function summarize(rs: Run[]): Summary {
  const todayRuns = rs.filter((r) => isToday(r.startedAt))
  const finished = rs.filter((r) => r.status !== 'in_progress')
  const completed = finished.filter((r) => r.status === 'completed')
  return {
    today: todayRuns.length,
    successRate: finished.length ? completed.length / finished.length : 0,
    avgLatencyMs: finished.length
      ? finished.reduce((a, r) => a + r.latencyMs, 0) / finished.length
      : 0,
    totalCostToday: todayRuns.reduce((a, r) => a + r.costUsd, 0),
    failedToday: todayRuns.filter((r) => r.status === 'failed').length,
  }
}

export interface DayPoint {
  label: string
  completed: number
  failed: number
  total: number
}

export function dailySeries(rs: Run[], days: number): DayPoint[] {
  const out: DayPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const dayRuns = rs.filter((r) => new Date(r.startedAt).toDateString() === d.toDateString())
    out.push({
      label: i === 0 ? 'Today' : fmtDate(d.toISOString()),
      completed: dayRuns.filter((r) => r.status === 'completed').length,
      failed: dayRuns.filter((r) => r.status === 'failed').length,
      total: dayRuns.length,
    })
  }
  return out
}

export function runsThisMonth(clientId: string): number {
  const now = new Date()
  return runs.filter((r) => {
    const d = new Date(r.startedAt)
    return r.clientId === clientId && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length
}

export interface LatencyBucket {
  label: string
  count: number
}

export function latencyBuckets(rs: Run[]): LatencyBucket[] {
  const edges = [0, 400, 600, 800, 1000, 1200, 1600, 2400]
  const labels = ['<0.4', '0.6', '0.8', '1.0', '1.2', '1.6', '2.4', '>2.4']
  const counts = new Array(labels.length).fill(0)
  for (const r of rs) {
    let idx = edges.findIndex((e, i) => i === edges.length - 1 || (r.latencyMs >= e && r.latencyMs < edges[i + 1]))
    if (r.latencyMs >= edges[edges.length - 1]) idx = labels.length - 1
    counts[Math.max(0, idx)]++
  }
  return labels.map((label, i) => ({ label, count: counts[i] }))
}
