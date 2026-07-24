import { type ReactNode } from 'react'
import { X, Inbox } from 'lucide-react'
import type { AgentStatus, ClientStatus, ModuleType, RunStatus } from '../types'

/* ---------- Panels & stats ---------- */

export function Panel({
  title,
  action,
  children,
  className = '',
  pad = true,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <section className={`rounded-md border border-line bg-surface ${className}`}>
      {title !== undefined && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink-2">{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'bad'
}) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-mute">{label}</div>
      <div className={`data mt-1 text-[22px] font-medium leading-tight ${tone === 'bad' ? 'text-fail' : 'text-ink'}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-mute">{sub}</div>}
    </div>
  )
}

/* ---------- Badges & dots ---------- */

const runStatusMeta: Record<RunStatus, { label: string; cls: string; dot: string }> = {
  completed: { label: 'Completed', cls: 'bg-ok-soft text-ok', dot: 'bg-ok' },
  failed: { label: 'Failed', cls: 'bg-fail-soft text-fail', dot: 'bg-fail' },
  in_progress: { label: 'Live', cls: 'bg-cobalt-soft text-cobalt', dot: 'bg-cobalt pulse-dot' },
  no_answer: { label: 'No answer', cls: 'bg-neutral-soft text-ink-2', dot: 'bg-faint' },
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const m = runStatusMeta[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

const clientStatusMeta: Record<ClientStatus, { label: string; cls: string; dot: string }> = {
  active: { label: 'Active', cls: 'text-ok', dot: 'bg-ok' },
  paused: { label: 'Paused', cls: 'text-warn', dot: 'bg-warn' },
  onboarding: { label: 'Onboarding', cls: 'text-cobalt', dot: 'bg-cobalt' },
}

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  const m = clientStatusMeta[status]
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

export function AgentStatusDot({ status }: { status: AgentStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'active' ? 'bg-ok' : 'bg-faint'}`} />
      {status === 'active' ? 'Active' : 'Paused'}
    </span>
  )
}

const moduleLabels: Record<ModuleType, string> = {
  voice: 'Voice',
  email: 'Email',
  sms: 'SMS',
  documents: 'Documents',
}

export function ModuleChip({ type, muted = false }: { type: ModuleType; muted?: boolean }) {
  return (
    <span
      className={`data inline-flex rounded border px-1.5 py-px text-[11px] ${
        muted
          ? 'border-line bg-sunken text-mute'
          : 'border-cobalt-line bg-cobalt-soft text-cobalt'
      }`}
    >
      {moduleLabels[type]}
    </span>
  )
}

/* ---------- Controls ---------- */

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label ?? 'Toggle'}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!on)
      }}
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
        on ? 'bg-cobalt' : 'bg-line-strong'
      }`}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all ${
          on ? 'left-[16px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex gap-1 border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
            active === t.id
              ? 'border-cobalt text-cobalt'
              : 'border-transparent text-mute hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- Empty / loading ---------- */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-sunken text-mute">
        <Inbox size={18} strokeWidth={1.75} />
      </div>
      <div className="text-sm font-medium text-ink">{title}</div>
      <p className="max-w-sm text-[13px] leading-relaxed text-mute">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-0" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-line px-4 py-3 last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="skeleton h-3.5"
              style={{ width: `${[18, 12, 22, 10, 14, 9][c % 6]}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ---------- Drawer ---------- */

export function Drawer({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40">
      <button
        aria-label="Close panel"
        className="absolute inset-0 bg-ink/25"
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full ${wide ? 'w-[560px]' : 'w-[440px]'} max-w-[92vw] flex-col border-l border-line bg-surface shadow-xl`}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">{title}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-mute hover:bg-sunken hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  )
}

/* ---------- Table ---------- */

export function Th({ children, className = '', right = false }: { children?: ReactNode; className?: string; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-mute ${right ? 'text-right' : 'text-left'} ${className}`}
    >
      {children}
    </th>
  )
}

export function Td({ children, className = '', right = false }: { children?: ReactNode; className?: string; right?: boolean }) {
  return (
    <td className={`border-b border-line px-4 py-2.5 align-middle text-[13px] ${right ? 'text-right' : 'text-left'} ${className}`}>
      {children}
    </td>
  )
}
