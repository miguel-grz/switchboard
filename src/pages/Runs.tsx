import { useMemo, useState } from 'react'
import { useScope } from '../context/ScopeContext'
import { clients } from '../mocks/clients'
import { agents } from '../mocks/agents'
import type { Run, RunStatus } from '../types'
import { scopedRuns } from '../lib/metrics'
import { fmtMoney } from '../lib/format'
import { Panel } from '../components/ui'
import RunsTable from '../components/RunsTable'
import RunDetail from '../components/RunDetail'

const statusFilters: { value: RunStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'in_progress', label: 'Live' },
]

const selectCls =
  'rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] focus:border-cobalt focus:outline-none'

export default function Runs() {
  const { scopeClientId } = useScope()
  const [status, setStatus] = useState<RunStatus | 'all'>('all')
  const [agentId, setAgentId] = useState<string>('all')
  const [selected, setSelected] = useState<Run | null>(null)

  const base = useMemo(() => scopedRuns(scopeClientId), [scopeClientId])
  const filtered = base.filter(
    (r) => (status === 'all' || r.status === status) && (agentId === 'all' || r.agentId === agentId),
  )
  const totalCost = filtered.reduce((a, r) => a + r.costUsd, 0)
  const agentOptions = agents.filter((a) => !scopeClientId || a.clientId === scopeClientId)

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Runs</h1>
          <p className="text-[13px] text-mute">
            Every agent execution across {scopeClientId ? clients.find((c) => c.id === scopeClientId)?.name : 'all clients'} · last 14 days.
          </p>
        </div>
        <div className="data text-xs text-mute">
          {filtered.length} runs · {fmtMoney(totalCost)}
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-line bg-surface p-0.5">
          {statusFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                status === f.value ? 'bg-cobalt text-white' : 'text-ink-2 hover:bg-sunken'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={selectCls}>
          <option value="all">All agents</option>
          {agentOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {clients.find((c) => c.id === a.clientId)?.name}
            </option>
          ))}
        </select>
        {(status !== 'all' || agentId !== 'all') && (
          <button
            onClick={() => {
              setStatus('all')
              setAgentId('all')
            }}
            className="text-xs font-medium text-cobalt hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <Panel pad={false}>
        <RunsTable
          runs={filtered}
          onSelect={setSelected}
          showClient={!scopeClientId}
          emptyHint="No runs match these filters. Clear them, or widen the client scope in the top bar."
        />
      </Panel>

      <RunDetail run={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
