import { Play, Download, AlertTriangle } from 'lucide-react'
import type { Run } from '../types'
import { agents } from '../mocks/agents'
import { clients } from '../mocks/clients'
import { Drawer, RunStatusBadge } from './ui'
import { fmtDateTime, fmtDuration, fmtLatency, fmtMoney } from '../lib/format'

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-mute">{label}</div>
      <div className="data mt-0.5 text-[13px] text-ink">{value}</div>
    </div>
  )
}

export default function RunDetail({ run, onClose }: { run: Run | null; onClose: () => void }) {
  const agent = run ? agents.find((a) => a.id === run.agentId) : undefined
  const client = run ? clients.find((c) => c.id === run.clientId) : undefined

  return (
    <Drawer
      open={!!run}
      onClose={onClose}
      wide
      title={
        run && (
          <div className="flex items-center gap-3">
            <span className="data text-[13px] font-medium text-ink">{run.id}</span>
            <RunStatusBadge status={run.status} />
          </div>
        )
      }
    >
      {run && (
        <div className="space-y-5 p-5">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-line bg-sunken/50 p-4 sm:grid-cols-3">
            <Meta label="Client" value={client?.name ?? '—'} />
            <Meta label="Agent" value={agent?.name ?? '—'} />
            <Meta label="Started" value={fmtDateTime(run.startedAt)} />
            <Meta label="Duration" value={fmtDuration(run.durationSec)} />
            <Meta label="Avg latency" value={fmtLatency(run.latencyMs)} />
            <Meta label="Cost" value={fmtMoney(run.costUsd)} />
          </div>

          {run.errorMessage && (
            <div className="flex items-start gap-2.5 rounded-md border border-fail/25 bg-fail-soft px-3.5 py-3 text-[13px] text-fail">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Run failed</div>
                <div className="mt-0.5 leading-relaxed">{run.errorMessage}</div>
              </div>
            </div>
          )}

          {/* Audio placeholder */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-mute">Recording</h3>
            <div className="flex items-center gap-3 rounded-md border border-line px-3.5 py-2.5">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full bg-cobalt text-white hover:bg-cobalt-dark"
                aria-label="Play recording"
              >
                <Play size={13} fill="currentColor" className="translate-x-px" />
              </button>
              <div className="flex h-7 flex-1 items-center gap-[3px]" aria-hidden>
                {Array.from({ length: 48 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-[3px] rounded-full bg-cobalt-line"
                    style={{ height: `${25 + 60 * Math.abs(Math.sin(i * 1.7 + run.durationSec))}%` }}
                  />
                ))}
              </div>
              <span className="data text-xs text-mute">{fmtDuration(run.durationSec)}</span>
              <button className="rounded p-1.5 text-mute hover:bg-sunken hover:text-ink" aria-label="Download recording">
                <Download size={14} />
              </button>
            </div>
          </div>

          {/* Extracted data */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-mute">
              Extracted data
            </h3>
            {Object.keys(run.extracted).length === 0 ? (
              <div className="rounded-md border border-dashed border-line px-3.5 py-4 text-[13px] text-mute">
                {run.status === 'in_progress'
                  ? 'Extraction runs when the call ends.'
                  : 'No fields were captured on this run.'}
              </div>
            ) : (
              <dl className="overflow-hidden rounded-md border border-line">
                {Object.entries(run.extracted).map(([k, v], i) => (
                  <div
                    key={k}
                    className={`grid grid-cols-[200px_1fr] gap-3 px-3.5 py-2 ${i % 2 ? '' : 'bg-sunken/40'}`}
                  >
                    <dt className="data truncate text-xs text-mute">{k}</dt>
                    <dd className="text-[13px] text-ink">{v || <span className="text-faint">—</span>}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {/* Transcript */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-mute">Transcript</h3>
            <div className="space-y-3 rounded-md border border-line p-4">
              {run.transcript.map((t, i) => (
                <div key={i} className="grid grid-cols-[64px_1fr] gap-3">
                  <span
                    className={`data pt-px text-[11px] font-medium ${
                      t.speaker === 'agent' ? 'text-cobalt' : 'text-mute'
                    }`}
                  >
                    {t.speaker === 'agent' ? 'AGENT' : 'CALLER'}
                  </span>
                  <p className="text-[13px] leading-relaxed text-ink-2">{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  )
}
