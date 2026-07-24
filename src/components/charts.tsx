import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts'
import type { DayPoint, LatencyBucket } from '../lib/metrics'

const AXIS = { fontSize: 11, fill: 'var(--color-mute)', fontFamily: 'IBM Plex Mono' }
const GRID = 'var(--color-line)'
const COBALT = 'var(--color-cobalt)'
const FAIL = 'var(--color-fail)'

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name: string; value: number; color?: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm">
      <div className="mb-0.5 font-medium text-ink">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-ink-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="data ml-auto pl-3 font-medium text-ink">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Runs over time — completed (cobalt) vs failed (status red). */
export function ActivityChart({ data, height = 220 }: { data: DayPoint[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} minTickGap={18} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--color-line-strong)' }} />
          <Line
            type="monotone"
            dataKey="completed"
            name="Completed"
            stroke={COBALT}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
          />
          <Line
            type="monotone"
            dataKey="failed"
            name="Failed"
            stroke={FAIL}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ChartLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-ink-2">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded" style={{ background: COBALT }} /> Completed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded" style={{ background: FAIL }} /> Failed
      </span>
    </div>
  )
}

/** Latency histogram — single hue, magnitude only. */
export function LatencyChart({ data, height = 200 }: { data: LatencyBucket[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap="18%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} interval={0} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-sunken)' }} />
          <Bar dataKey="count" name="Runs" fill={COBALT} radius={[3, 3, 0, 0]} maxBarSize={38} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
