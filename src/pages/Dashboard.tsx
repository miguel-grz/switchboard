import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useScope } from '../context/ScopeContext'
import { clients } from '../mocks/clients'
import { agents } from '../mocks/agents'
import type { Run } from '../types'
import { scopedRuns, summarize, dailySeries } from '../lib/metrics'
import { fmtLatency, fmtMoney, fmtPercent, fmtRelative } from '../lib/format'
import { Panel, Stat, SkeletonRows } from '../components/ui'
import { ActivityChart, ChartLegend } from '../components/charts'
import RunsTable from '../components/RunsTable'
import RunDetail from '../components/RunDetail'

export default function Dashboard() {
  const { scopeClientId } = useScope()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Run | null>(null)
  // Simulated fetch so the stakeholder sees the loading treatment.
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => setLoading(false), 650)
    return () => clearTimeout(t)
  }, [scopeClientId])

  const runs = useMemo(() => scopedRuns(scopeClientId), [scopeClientId])
  const summary = useMemo(() => summarize(runs), [runs])
  const series = useMemo(() => dailySeries(runs, 7), [runs])
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
