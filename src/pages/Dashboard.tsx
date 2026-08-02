import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useScope } from '../context/ScopeContext'
import type { Run } from '../types'
import { fmtLatency, fmtMoney, fmtPercent, fmtRelative } from '../lib/format'
import { getDataSource } from '../data'
import { useAsync } from '../data/hooks'
import { Panel, Stat, SkeletonRows } from '../components/ui'
import { ActivityChart, ChartLegend } from '../components/charts'
import RunsTable from '../components/RunsTable'
import RunDetail from '../components/RunDetail'

export default function Dashboard() {
  const { scopeClientId } = useScope()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Run | null>(null)
  const source = getDataSource()

  const { data: runData, loading, error } = useAsync(
    () => source.listRuns({ clientId: scopeClientId }),
    [scopeClientId],
  )
  const { data: summaryData } = useAsync(() => source.getSummary(scopeClientId), [scopeClientId])
  const { data: seriesData } = useAsync(() => source.getDailySeries(scopeClientId, 7), [scopeClientId])
  const { data: clientData } = useAsync(() => source.listClients(), [])
  const { data: agentData } = useAsync(() => source.listAgents(null), [])

  const runs = runData ?? []
  const clients = clientData ?? []
  const agents = agentData ?? []
  const summary = summaryData ?? {
    today: 0, successRate: 0, avgLatencyMs: 0, totalCostToday: 0, failedToday: 0,
  }
  const series = seriesData ?? []
  const recent = runs.slice(0, 9)
  const alerts = runs.filter((r) => r.status === 'failed').slice(0, 5)
  const scopeName = clients.find((c) => c.id === scopeClientId)?.name

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
          <p className="text-[13px] text-mute">
            {scopeName ? `Scoped to ${scopeName}` : `All clients · ${clients.length} accounts · ${agents.length} agents`}
          </p>
        </div>
      </div>

      {/* Stat row */}
      {error && (
        <div className="rounded-md border border-fail/25 bg-fail-soft px-4 py-3 text-[13px] text-fail">
          No se pudieron cargar los datos: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-md border border-line bg-surface px-4 py-3">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton mt-2 h-6 w-16" />
            </div>
          ))
        ) : (
          <>
            <Stat label="Runs today" value={summary.today} sub="across all modules" />
            <Stat label="Success rate" value={fmtPercent(summary.successRate)} sub="last 14 days" />
            <Stat label="Avg latency" value={fmtLatency(summary.avgLatencyMs)} sub="agent response time" />
            <Stat label="Est. cost today" value={fmtMoney(summary.totalCostToday)} sub="provider + model usage" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Activity */}
        <Panel title="Activity — last 7 days" action={<ChartLegend />} className="xl:col-span-2">
          {loading ? (
            <div className="skeleton h-[220px] w-full" />
          ) : (
            <ActivityChart data={series} />
          )}
        </Panel>

        {/* Alerts */}
        <Panel
          title={
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle size={13} className="text-fail" /> Failed runs
            </span>
          }
          action={
            <Link to="/monitoring" className="text-xs font-medium text-cobalt hover:underline">
              Monitoring →
            </Link>
          }
          pad={false}
        >
          {loading ? (
            <SkeletonRows rows={4} cols={2} />
          ) : alerts.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-mute">
              No failures in the current window.
            </div>
          ) : (
            <ul>
              {alerts.map((r) => {
                const agent = agents.find((a) => a.id === r.agentId)
                const client = clients.find((c) => c.id === r.clientId)
                return (
                  <li key={r.id} className="border-b border-line last:border-b-0">
                    <button
                      onClick={() => setSelected(r)}
                      className="w-full px-4 py-2.5 text-left hover:bg-fail-soft/40"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">
                          {agent?.name}
                        </span>
                        <span className="data shrink-0 text-[11px] text-mute">{fmtRelative(r.startedAt)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-mute">
                        {client?.name} · {r.errorMessage}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* Recent runs */}
      <Panel
        title="Recent runs"
        pad={false}
        action={
          <button
            onClick={() => navigate('/runs')}
            className="inline-flex items-center gap-1 text-xs font-medium text-cobalt hover:underline"
          >
            All runs <ArrowRight size={12} />
          </button>
        }
      >
        {loading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : (
          <RunsTable runs={recent} onSelect={setSelected} showClient={!scopeClientId} />
        )}
      </Panel>

      <RunDetail run={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
