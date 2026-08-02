import type { EmailSender } from './actions.ts'

/**
 * Emisor real vía Resend.
 *
 * Se construye con la llave en vez de leerla dentro: así el ejecutor de
 * acciones no depende de ninguna variable de entorno y puede probarse con un
 * doble.
 */
export function resendSender(apiKey: string, from: string): EmailSender {
  return async (msg) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Resend respondió ${res.status}: ${detail.slice(0, 200)}`)
    }
  }
}

/**
 * Emisor de reserva mientras no hay cuenta de correo configurada.
 *
 * Falla a propósito en vez de fingir que envió: un correo silenciosamente no
 * enviado es peor que uno que deja su error en action_runs.
 */
export const unconfiguredSender: EmailSender = () => {
  throw new Error('No hay proveedor de correo configurado (falta RESEND_API_KEY)')
}
