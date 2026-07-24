import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { clients } from '../mocks/clients'
import { agents } from '../mocks/agents'
import { runsThisMonth } from '../lib/metrics'
import { Panel, Th, Td, ClientStatusBadge, ModuleChip } from '../components/ui'

export default function Clients() {
  const navigate = useNavigate()
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Clients</h1>
          <p className="text-[13px] text-mute">Businesses running agents on the platform.</p>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-md bg-cobalt px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-dark">
          <Plus size={14} /> Add client
        </button>
      </div>

      <Panel pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Client</Th>
                <Th>Industry</Th>
                <Th>Modules</Th>
                <Th right>Agents</Th>
                <Th right>Runs this month</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const agentCount = agents.filter((a) => a.clientId === c.id).length
                return (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/clients/${c.id}`)}
                    className="cursor-pointer transition-colors hover:bg-cobalt-soft/40"
                  >
                    <Td>
                      <div className="font-medium text-ink">{c.name}</div>
                      <div className="data mt-0.5 text-[11px] text-faint">{c.id}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{c.industry}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {c.modules.map((m) => (
                          <ModuleChip key={m} type={m} />
                        ))}
                      </div>
                    </Td>
                    <Td right className="data text-xs">{agentCount}</Td>
                    <Td right className="data text-xs">{runsThisMonth(c.id)}</Td>
                    <Td className="whitespace-nowrap">
                      <ClientStatusBadge status={c.status} />
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
