import type { RunContext } from './actions.ts'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/** El contenido viene de una llamada telefónica: nada de confiar en él. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function formatDuration(sec: number | null): string {
  if (sec === null) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

/**
 * Redacta el correo de una llamada.
 *
 * `labels` traduce claves técnicas a las etiquetas configuradas en field_defs.
 * Quien lee esto es la recepción del cliente, no un desarrollador: ver
 * `callback_phone` en vez de "Teléfono" es una fuga de la implementación.
 */
export function renderRunEmail(
  ctx: RunContext,
  labels: Record<string, string> = {},
): RenderedEmail {
  const name = ctx.fields.caller_name?.trim() || ctx.callerNumber || 'Alguien'
  const reason = ctx.fields.reason_category?.trim()
  const urgent = ctx.fields.urgency?.trim().toLowerCase() === 'urgente'

  const subject = [
    urgent ? '[URGENTE]' : null,
    `${name} llamó`,
    reason ? `— ${reason}` : null,
  ].filter(Boolean).join(' ')

  const shown = Object.entries(ctx.fields).filter(([, v]) => v && v.trim() !== '')

  const rows = shown.map(([k, v]) =>
    `<tr>
      <td style="padding:6px 12px 6px 0;color:#6d737a;white-space:nowrap;vertical-align:top">${escapeHtml(labels[k] ?? k)}</td>
      <td style="padding:6px 0;color:#1b1e22">${escapeHtml(v)}</td>
    </tr>`,
  ).join('')

  const turns = ctx.turns.map(t =>
    `<p style="margin:0 0 8px"><strong style="color:${t.speaker === 'agent' ? '#2851be' : '#6d737a'}">${t.speaker === 'agent' ? 'Agente' : 'Quien llama'}:</strong> ${escapeHtml(t.text)}</p>`,
  ).join('')

  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:640px;color:#1b1e22">
  <h2 style="margin:0 0 4px;font-size:18px">${escapeHtml(subject)}</h2>
  <p style="margin:0 0 16px;color:#6d737a;font-size:13px">
    ${escapeHtml(ctx.agentName)} · ${formatDuration(ctx.durationSec)}
  </p>
  ${ctx.summary ? `<p style="margin:0 0 16px">${escapeHtml(ctx.summary)}</p>` : ''}
  <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">${rows}</table>
  ${ctx.recordingUrl ? `<p style="margin:0 0 16px"><a href="${escapeHtml(ctx.recordingUrl)}">Escuchar la grabación</a></p>` : ''}
  <details>
    <summary style="cursor:pointer;color:#6d737a;font-size:13px">Transcripción</summary>
    <div style="margin-top:12px;font-size:14px">${turns}</div>
  </details>
</div>`

  const text = [
    subject,
    `${ctx.agentName} · ${formatDuration(ctx.durationSec)}`,
    ctx.summary ?? '',
    '',
    ...shown.map(([k, v]) => `${labels[k] ?? k}: ${v}`),
    '',
    ctx.recordingUrl ? `Grabación: ${ctx.recordingUrl}` : '',
    '',
    ...ctx.turns.map(t => `${t.speaker === 'agent' ? 'Agente' : 'Quien llama'}: ${t.text}`),
  ].join('\n')

  return { subject, html, text }
}
