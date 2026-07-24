import type { Run } from '../types'
import { agents } from '../mocks/agents'
import { clients } from '../mocks/clients'
import { RunStatusBadge, Th, Td, EmptyState } from './ui'
import { fmtDateTime, fmtDuration, fmtMoney } from '../lib/format'

export default function RunsTable({
  runs,
  onSelect,
  showClient = true,
  emptyHint = 'Runs will appear here as agents take calls.',
}: {
  runs: Run[]
  onSelect: (run: Run) => void
  showClient?: boolean
  emptyHint?: string
}) {
  if (runs.length === 0) {
    return <EmptyState title="No runs match" hint={emptyHint} />
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <Th>Run</Th>
            <Th>Started</Th>
            {showClient && <Th>Client</Th>}
            <Th>Agent</Th>
            <Th right>Duration</Th>
            <Th>Status</Th>
            <Th right>Cost</Th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const agent = agents.find((a) => a.id === r.agentId)
            const client = clients.find((c) => c.id === r.clientId)
            return (
              <tr
                key={r.id}
                onClick={() => onSelect(r)}
                className="cursor-pointer transition-colors hover:bg-cobalt-soft/40"
              >
                <Td className="data text-xs text-mute">{r.id}</Td>
                <Td className="data whitespace-nowrap text-xs">{fmtDateTime(r.startedAt)}</Td>
                {showClient && <Td className="whitespace-nowrap">{client?.name}</Td>}
                <Td className="whitespace-nowrap text-ink-2">{agent?.name}</Td>
                <Td right className="data text-xs">{fmtDuration(r.durationSec)}</Td>
                <Td><RunStatusBadge status={r.status} /></Td>
                <Td right className="data text-xs">{fmtMoney(r.costUsd)}</Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
