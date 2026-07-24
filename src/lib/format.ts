export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

export function fmtMoney(usd: number): string {
  return usd >= 100
    ? `$${usd.toFixed(0)}`
    : usd >= 10
      ? `$${usd.toFixed(1)}`
      : `$${usd.toFixed(2)}`
}

export function fmtTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function fmtDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function fmtDateTime(isoDate: string): string {
  return `${fmtDate(isoDate)} · ${fmtTime(isoDate)}`
}

export function fmtRelative(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

export function fmtLatency(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
}

export function fmtPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}
