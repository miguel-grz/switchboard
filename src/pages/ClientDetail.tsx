import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Phone, Plus } from 'lucide-react'
import { industryOptions } from '../mocks/clients'
import type { Agent, Client, Run } from '../types'
import { getDataSource } from '../data'
import { useAsync } from '../data/hooks'
import { fmtLatency, fmtMoney, fmtPercent, fmtRelative } from '../lib/format'
import {
  Panel,
  Stat,
  Tabs,
  Toggle,
  ModuleChip,
  ClientStatusBadge,
  EmptyState,
  Th,
  Td,
} from '../components/ui'
import { ActivityChart, ChartLegend } from '../components/charts'
import RunDetail from '../components/RunDetail'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'agents', label: 'Agents' },
  { id: 'data', label: 'Data captured' },
  { id: 'settings', label: 'Settings' },
]

function AgentCard(
  { agent, clientId, runs }: { agent: Agent; clientId: string; runs: Run[] },
) {
  const [active, setActive] = useState(agent.status === 'active')
  const navigate = useNavigate()
  const last = runs.find((r) => r.agentId === agent.id)
  const open = () => navigate(`/clients/${clientId}/agents/${agent.id}`)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      className="group flex cursor-pointer flex-col rounded-md border border-line bg-surface p-4 text-left transition-colors hover:border-cobalt-line"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-ink group-hover:text-cobalt">
              {agent.name}
            </span>
            <ModuleChip type={agent.module} />
          </div>
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-mute">{agent.description}</p>
        </div>
        <Toggle on={active} onChange={setActive} label={`${agent.name} active`} />
      </div>
      <div className="mt-3 flex items-center gap-4 border-t border-line pt-3 text-xs text-mute">
        <span className="data inline-flex items-center gap-1.5">
          <Phone size={12} /> {agent.channel}
        </span>
        <span className="data capitalize">{agent.provider}</span>
        <span className="ml-auto">
          {last ? `Last run ${fmtRelative(last.startedAt)}` : 'No runs yet'}
        </span>
      </div>
    </div>
  )
}

function DataCaptured(
  { agents, runs, onSelect }: { agents: Agent[]; runs: Run[]; onSelect: (r: Run) => void },
) {
  const runsFor = (agentId: string) => runs.filter((r) => r.agentId === agentId)
  const withRuns = agents.filter((a) =>
    runsFor(a.id).some((r) => r.status === 'completed'),
  )
  if (withRuns.length === 0) {
    return (
      <Panel pad={false}>
        <EmptyState
          title="Nothing captured yet"
          hint="When agents complete runs, the structured fields they extract show up here, ready to export or push to the client’s systems."
        />
      </Panel>
    )
  }
  return (
    <div className="space-y-4">
      {withRuns.map((agent) => {
        const completed = runsFor(agent.id)
          .filter((r) => r.status === 'completed')
          .slice(0, 5)
        const cols = agent.fields.slice(0, 4)
        return (
          <Panel
            key={agent.id}
            title={agent.name}
            pad={false}
            action={
              <span className="data text-[11px] text-mute">
                {agent.fields.length} fields · last {completed.length} runs
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Run</Th>
                    {cols.map((f) => (
                      <Th key={f.id}>
                        <span className="data normal-case tracking-normal">{f.name}</span>
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {completed.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => onSelect(r)}
                      className="cursor-pointer hover:bg-cobalt-soft/40"
                    >
                      <Td className="data text-xs text-mute">{r.id}</Td>
                      {cols.map((f) => (
                        <Td key={f.id} className="max-w-[260px] truncate text-ink-2">
                          {r.extracted[f.name] || <span className="text-faint">—</span>}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )
      })}
    </div>
  )
}

function Settings({ client }: { client: Client }) {

  const [modules, setModules] = useState({
    voice: client.modules.includes('voice'),
    email: client.modules.includes('email'),
    sms: client.modules.includes('sms'),
    documents: client.modules.includes('documents'),
  })
  const field =
    'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] focus:border-cobalt focus:outline-none'
  return (
    <div className="grid max-w-3xl gap-4">
      <Panel title="Profile">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-mute">
            Business name
            <input defaultValue={client.name} className={`${field} mt-1`} />
          </label>
          <label className="text-xs font-medium text-mute">
            Industry
            <select defaultValue={client.industry} className={`${field} mt-1`}>
              {industryOptions.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-mute">
            Primary contact
            <input defaultValue={client.contactName} className={`${field} mt-1`} />
          </label>
          <label className="text-xs font-medium text-mute">
            Contact email
            <input defaultValue={client.contactEmail} className={`${field} mt-1`} />
          </label>
          <label className="text-xs font-medium text-mute">
            Timezone
            <select defaultValue={client.timezone} className={`${field} mt-1`}>
              {['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'].map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-mute sm:col-span-2">
            Internal notes
            <textarea defaultValue={client.notes} rows={3} className={`${field} mt-1 resize-y`} />
          </label>
        </div>
      </Panel>

      <Panel title="Enabled modules">
        <div className="space-y-3">
          {(
            [
              ['voice', 'Voice', 'Inbound & outbound phone agents'],
              ['email', 'Email', 'Inbox triage and drafted replies (coming soon)'],
              ['sms', 'SMS', 'Two-way texting and reminders (coming soon)'],
              ['documents', 'Document processing', 'Field extraction from uploads (coming soon)'],
            ] as const
          ).map(([key, label, desc]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-ink">{label}</div>
                <div className="text-xs text-mute">{desc}</div>
              </div>
              <Toggle
                on={modules[key]}
                onChange={(v) => setModules((m) => ({ ...m, [key]: v }))}
                label={`${label} module`}
              />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Danger zone">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-ink">Pause all agents</div>
            <div className="text-xs text-mute">Stops every agent for this client immediately. Runs in progress finish normally.</div>
          </div>
          <button className="rounded-md border border-fail/30 px-3 py-1.5 text-[13px] font-medium text-fail hover:bg-fail-soft">
            Pause client
          </button>
        </div>
      </Panel>

      <div>
        <button className="rounded-md bg-cobalt px-4 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-dark">
          Save changes
        </button>
      </div>
    </div>
  )
}

export default function ClientDetail() {
  const { clientId } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'
  const [selected, setSelected] = useState<Run | null>(null)

  const source = getDataSource()
  const { data: clientData, loading } = useAsync(
    () => (clientId ? source.getClient(clientId) : Promise.resolve(null)),
    [clientId],
  )
  const { data: agentData } = useAsync(() => source.listAgents(clientId), [clientId])
  const { data: runData } = useAsync(() => source.listRuns({ clientId }), [clientId])
  const { data: summaryData } = useAsync(() => source.getSummary(clientId ?? null), [clientId])
  const { data: seriesData } = useAsync(() => source.getDailySeries(clientId ?? null, 7), [clientId])

  const client = clientData
  const clientAgents = agentData ?? []
  const runs = runData ?? []
  const summary = summaryData ?? {
    today: 0, successRate: 0, avgLatencyMs: 0, totalCostToday: 0, failedToday: 0,
  }
  const series = seriesData ?? []

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-5 w-56" />
        <div className="skeleton h-40 w-full" />
      </div>
    )
  }

  if (!client) {
    return (
      <Panel pad={false}>
        <EmptyState title="Client not found" hint="No existe un cliente con ese identificador." />
      </Panel>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/clients" className="inline-flex items-center gap-1 text-xs font-medium text-mute hover:text-ink">
          <ChevronLeft size={13} /> Clients
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{client.name}</h1>
          <ClientStatusBadge status={client.status} />
          <span className="text-[13px] text-mute">{client.industry}</span>
          <div className="ml-auto flex gap-1.5">
            {client.modules.map((m) => (
              <ModuleChip key={m} type={m} />
            ))}
          </div>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={(id) => setParams(id === 'overview' ? {} : { tab: id })} />

      {tab === 'overview' && (
        <div className="space-y-4">
          {runs.length === 0 ? (
            <Panel pad={false}>
              <EmptyState
                title="No activity yet"
                hint={`${client.name} is still onboarding. Configure their first agent to start taking calls — metrics land here in real time.`}
                action={
                  <button
                    onClick={() => setParams({ tab: 'agents' })}
                    className="rounded-md bg-cobalt px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-dark"
                  >
                    Set up an agent
                  </button>
                }
              />
            </Panel>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Stat label="Runs today" value={summary.today} />
                <Stat label="Success rate" value={fmtPercent(summary.successRate)} sub="last 14 days" />
                <Stat label="Avg latency" value={fmtLatency(summary.avgLatencyMs)} />
                <Stat label="Est. cost today" value={fmtMoney(summary.totalCostToday)} />
              </div>
              <Panel title="Activity — last 7 days" action={<ChartLegend />}>
                <ActivityChart data={series} />
              </Panel>
            </>
          )}
        </div>
      )}

      {tab === 'agents' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="inline-flex items-center gap-1.5 rounded-md bg-cobalt px-3 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-dark">
              <Plus size={14} /> New agent
            </button>
          </div>
          {clientAgents.length === 0 ? (
            <Panel pad={false}>
              <EmptyState
                title="No agents configured"
                hint="An agent is a phone number (or inbox) plus a prompt and the fields it should capture. Their first one is usually live within a day."
              />
            </Panel>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {clientAgents.map((a) => (
                <AgentCard key={a.id} agent={a} clientId={client.id} runs={runs} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'data' && <DataCaptured agents={clientAgents} runs={runs} onSelect={setSelected} />}

      {tab === 'settings' && <Settings client={client} />}

      <RunDetail run={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
