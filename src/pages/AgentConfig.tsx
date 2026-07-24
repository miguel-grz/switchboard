import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Plus,
  Trash2,
  Phone,
  Check,
} from 'lucide-react'
import { agents } from '../mocks/agents'
import { clients } from '../mocks/clients'
import type { FieldDef, FieldType, Provider } from '../types'
import { Panel, Toggle, ModuleChip, EmptyState } from '../components/ui'

const fieldTypes: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Choice' },
  { value: 'phone', label: 'Phone' },
]

const providers: { value: Provider; label: string; note: string }[] = [
  { value: 'vapi', label: 'Vapi', note: 'Default voice stack' },
  { value: 'retell', label: 'Retell', note: 'Lower latency, EN only' },
  { value: 'custom', label: 'Custom SIP', note: 'Bring your own trunk' },
]

const inputCls =
  'w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] focus:border-cobalt focus:outline-none'

export default function AgentConfig() {
  const { clientId, agentId } = useParams()
  const agent = agents.find((a) => a.id === agentId)
  const client = clients.find((c) => c.id === clientId)

  const [active, setActive] = useState(agent?.status === 'active')
  const [provider, setProvider] = useState<Provider>(agent?.provider ?? 'vapi')
  const [prompt, setPrompt] = useState(agent?.systemPrompt ?? '')
  const [fields, setFields] = useState<FieldDef[]>(agent?.fields ?? [])
  const [saved, setSaved] = useState(false)

  if (!agent || !client) {
    return (
      <Panel pad={false}>
        <EmptyState title="Agent not found" hint="It may have been removed from this prototype’s mock data." />
      </Panel>
    )
  }

  const update = (id: string, patch: Partial<FieldDef>) =>
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const move = (idx: number, dir: -1 | 1) =>
    setFields((fs) => {
      const next = [...fs]
      const j = idx + dir
      if (j < 0 || j >= next.length) return fs
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })

  const remove = (id: string) => setFields((fs) => fs.filter((f) => f.id !== id))

  const add = () =>
    setFields((fs) => [
      ...fs,
      {
        id: `f${Date.now()}`,
        name: '',
        type: 'text',
        required: false,
        description: '',
      },
    ])

  const save = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          to={`/clients/${client.id}?tab=agents`}
          className="inline-flex items-center gap-1 text-xs font-medium text-mute hover:text-ink"
        >
          <ChevronLeft size={13} /> {client.name} / Agents
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{agent.name}</h1>
          <ModuleChip type={agent.module} />
          <span className="data inline-flex items-center gap-1.5 text-[13px] text-mute">
            <Phone size={13} /> {agent.channel}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs font-medium text-mute">{active ? 'Active' : 'Paused'}</span>
            <Toggle on={active} onChange={setActive} label="Agent active" />
            <button
              onClick={save}
              className="inline-flex min-w-[112px] items-center justify-center gap-1.5 rounded-md bg-cobalt px-4 py-1.5 text-[13px] font-medium text-white hover:bg-cobalt-dark"
            >
              {saved ? (
                <>
                  <Check size={14} /> Saved
                </>
              ) : (
                'Save changes'
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* Basic info */}
          <Panel title="Basic info">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-mute">
                Agent name
                <input defaultValue={agent.name} className={`${inputCls} mt-1`} />
              </label>
              <label className="text-xs font-medium text-mute">
                Channel
                <input defaultValue={agent.channel} className={`${inputCls} mt-1 data`} />
              </label>
              <label className="text-xs font-medium text-mute sm:col-span-2">
                Description
                <input defaultValue={agent.description} className={`${inputCls} mt-1`} />
              </label>
            </div>
          </Panel>

          {/* System prompt */}
          <Panel
            title="System prompt"
            action={
              <span className="data text-[11px] text-mute">{prompt.length} chars</span>
            }
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={12}
              spellCheck={false}
              className="data w-full resize-y rounded-md border border-line bg-sunken/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink focus:border-cobalt focus:bg-surface focus:outline-none"
            />
            <p className="mt-2 text-xs text-mute">
              The prompt defines voice, guardrails, and what the agent may promise. Changes apply to the next run.
            </p>
          </Panel>

          {/* Field builder */}
          <Panel
            title="Extracted fields"
            action={
              <span className="text-[11px] text-mute">
                What this agent must capture on every run
              </span>
            }
            pad={false}
          >
            <div className="divide-y divide-line">
              {fields.map((f, idx) => (
                <div key={f.id} className="flex items-start gap-2 px-3 py-2.5">
                  <div className="flex flex-col items-center pt-1 text-faint">
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      aria-label="Move up"
                      className="rounded p-0.5 hover:text-ink disabled:opacity-25"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <GripVertical size={13} className="my-0.5" />
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === fields.length - 1}
                      aria-label="Move down"
                      className="rounded p-0.5 hover:text-ink disabled:opacity-25"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_130px] gap-2 lg:grid-cols-[180px_130px_minmax(0,1fr)]">
                    <input
                      value={f.name}
                      onChange={(e) => update(f.id, { name: e.target.value })}
                      placeholder="field_name"
                      className={`${inputCls} data`}
                    />
                    <select
                      value={f.type}
                      onChange={(e) => update(f.id, { type: e.target.value as FieldType })}
                      className={inputCls}
                    >
                      {fieldTypes.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={f.description}
                      onChange={(e) => update(f.id, { description: e.target.value })}
                      placeholder="What the agent should listen for"
                      className={`${inputCls} col-span-2 lg:col-span-1`}
                    />
                    {f.type === 'select' && (
                      <input
                        value={f.options?.join(', ') ?? ''}
                        onChange={(e) =>
                          update(f.id, { options: e.target.value.split(',').map((s) => s.trim()) })
                        }
                        placeholder="Options, comma-separated"
                        className={`${inputCls} col-span-2 lg:col-span-3`}
                      />
                    )}
                  </div>
                  <label className="flex shrink-0 items-center gap-1.5 pt-1.5 text-xs text-mute">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => update(f.id, { required: e.target.checked })}
                      className="h-3.5 w-3.5 accent-cobalt"
                    />
                    <span className="max-lg:hidden">Required</span>
                    <span className="lg:hidden sr-only">Required</span>
                  </label>
                  <button
                    onClick={() => remove(f.id)}
                    aria-label={`Remove ${f.name || 'field'}`}
                    className="mt-1 rounded p-1.5 text-faint hover:bg-fail-soft hover:text-fail"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-line px-3 py-2.5">
              <button
                onClick={add}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink-2 hover:border-cobalt hover:text-cobalt"
              >
                <Plus size={14} /> Add field
              </button>
            </div>
          </Panel>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <Panel title="Provider">
            <div className="space-y-2">
              {providers.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setProvider(p.value)}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors ${
                    provider === p.value
                      ? 'border-cobalt bg-cobalt-soft'
                      : 'border-line hover:border-line-strong'
                  }`}
                >
                  <div>
                    <div className={`text-[13px] font-semibold ${provider === p.value ? 'text-cobalt' : 'text-ink'}`}>
                      {p.label}
                    </div>
                    <div className="text-xs text-mute">{p.note}</div>
                  </div>
                  {provider === p.value && <Check size={15} className="text-cobalt" />}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-mute">
              Providers are interchangeable. Prompt, fields, and number move with the agent — switching requires no reconfiguration.
            </p>
          </Panel>

          <Panel title="Schema preview">
            <pre className="data overflow-x-auto rounded-md bg-ink p-3 text-[11.5px] leading-relaxed text-bg">
{JSON.stringify(
  Object.fromEntries(
    fields.filter((f) => f.name).map((f) => [f.name, f.required ? f.type : `${f.type}?`]),
  ),
  null,
  2,
)}
            </pre>
            <p className="mt-2 text-xs text-mute">
              Every completed run returns exactly this shape.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
