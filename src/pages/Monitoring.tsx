import { useMemo, useState } from 'react'
import { useScope } from '../context/ScopeContext'
import { clients } from '../mocks/clients'
import { agents } from '../mocks/agents'
import type { Run } from '../types'
import { scopedRuns, dailySeries, latencyBuckets } from '../lib/metrics'
import { fmtDateTime, fmtLatency, fmtPercent } from '../lib/format'
import { Panel, Stat, Th, Td } from '../components/ui'
import { ActivityChart, ChartLegend, LatencyChart } from '../components/charts'
import RunDetail from '../components/RunDetail'

export default function Monitoring() {
  const { scopeClientId } = useScope()
  const [selected, setSelected] = useState<Run | null>(null)

  const runs = useMemo(() => scopedRuns(scopeClientId), [scopeClientId])
  const series = useMemo(() => dailySeries(runs, 14), [runs])
  const buckets = useMemo(() => latencyBuckets(runs), [runs])

  const finished = runs.filter((r) => r.status !== 'in_progress')
  const failed = finished.filter((r) => r.status === 'failed')
  const errorRate = finished.length ? failed.length / finished.length : 0
  const sorted = [...finished].sort((a, b) => a.latencyMs - b.latencyMs)
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)].latencyMs : 0
  const p50 = sorted.length ? sorted[Math.floor(sorted.length * 0.5)].latencyMs : 0

  // Errors grouped by client, most recent first within each group.
  const errorGroups = clients
    .map((c) => ({
      client: c,
      errors: failed.filter((r) => r.clientId === c.id).slice(0, 4),
    }))
    .filter((g) => g.errors.length > 0)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Monitoring</h1>
        <p className="text-[13px] text-mute">
          Platform health over the last 14 days
          {scopeClientId ? ` · scoped to ${clients.find((c) => c.id === scopeClientId)?.name}` : ''}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Error rate" value={fmtPercent(errorRate)} tone={errorRate > 0.07 ? 'bad' : 'default'} sub={`${failed.length} failed of ${finished.length}`} />
        <Stat label="p50 latency" value={fmtLatency(p50)} sub="median agent response" />
        <Stat label="p95 latency" value={fmtLatency(p95)} sub="worst 5% of runs" />
        <Stat label="Provider uptime" value="99.97%" sub="Vapi + Retell, 30 days" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Runs — last 14 days" action={<ChartLegend />}>
          <ActivityChart data={series} height={200} />
        </Panel>
        <Panel title="Latency distribution" action={<span className="text-xs text-ink-2">all finished runs</span>}>
          <LatencyChart data={buckets} height={200} />
        </Panel>
      </div>

      <Panel title="Recent errors by client" pad={false}>
        {errorGroups.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-mute">
            No errors in the current window. This panel groups failures by client so recurring
            issues stand out.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Client</Th>
                  <Th>When</Th>
                  <Th>Agent</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {errorGroups.map((g) =>
                  g.errors.map((r, i) => (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className="cursor-pointer hover:bg-fail-soft/30"
                    >
                      <Td className="whitespace-nowrap">
                        {i === 0 ? (
                          <span className="font-medium text-ink">{g.client.name}</span>
                        ) : (
                          <span className="text-faint">·</span>
                        )}
                      </Td>
                      <Td className="data whitespace-nowrap text-xs">{fmtDateTime(r.startedAt)}</Td>
                      <Td className="whitespace-nowrap text-ink-2">
                        {agents.find((a) => a.id === r.agentId)?.name}
                      </Td>
                      <Td className="max-w-[480px] truncate text-fail">{r.errorMessage}</Td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <RunDetail run={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
