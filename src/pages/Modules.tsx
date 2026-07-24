import { Mic, Mail, MessageSquare, FileText, Check } from 'lucide-react'
import { modules } from '../mocks/modules'
import { clients } from '../mocks/clients'
import type { ModuleType } from '../types'

const icons: Record<ModuleType, typeof Mic> = {
  voice: Mic,
  email: Mail,
  sms: MessageSquare,
  documents: FileText,
}

export default function Modules() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Modules</h1>
        <p className="max-w-2xl text-[13px] text-mute">
          Each module is a channel agents can operate on. Clients subscribe per module; prompts and
          extracted fields carry across channels, so a voice agent’s schema becomes tomorrow’s email
          agent’s schema.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {modules.map((m) => {
          const Icon = icons[m.type]
          const available = m.status === 'available'
          const usedBy = clients.filter((c) => c.modules.includes(m.type))
          return (
            <section
              key={m.type}
              className={`rounded-md border bg-surface p-5 ${
                available ? 'border-cobalt-line' : 'border-line'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-md ${
                    available ? 'bg-cobalt text-white' : 'bg-sunken text-mute'
                  }`}
                >
                  <Icon size={17} strokeWidth={1.9} />
                </div>
                {available ? (
                  <span className="inline-flex items-center gap-1.5 rounded bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Live
                  </span>
                ) : (
                  <span className="data rounded border border-line bg-sunken px-2 py-0.5 text-[11px] uppercase tracking-wider text-mute">
                    Coming soon
                  </span>
                )}
              </div>

              <h2 className={`mt-3 text-[15px] font-semibold ${available ? 'text-ink' : 'text-ink-2'}`}>
                {m.name}
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-mute">{m.description}</p>

              <ul className="mt-3 space-y-1.5">
                {m.capabilities.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-[13px] text-ink-2">
                    <Check size={13} className={`mt-0.5 shrink-0 ${available ? 'text-cobalt' : 'text-faint'}`} />
                    {c}
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                <span className="data text-[11px] text-mute">{m.providers.join(' · ')}</span>
                {available ? (
                  <span className="text-xs font-medium text-ink-2">
                    {usedBy.length} client{usedBy.length === 1 ? '' : 's'} live
                  </span>
                ) : (
                  <button className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-2 hover:border-line-strong hover:text-ink">
                    Join waitlist
                  </button>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
