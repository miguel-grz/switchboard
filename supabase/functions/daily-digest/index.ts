import { createClient } from '@supabase/supabase-js'
import { runDigest } from '../_shared/actions.ts'
import { resendSender, unconfiguredSender } from '../_shared/email-sender.ts'

/**
 * Resumen diario. Lo dispara un cron (ver el runbook de despliegue), no una
 * llamada.
 *
 * Va protegido por un secreto propio y no por el JWT de Supabase, para poder
 * dispararlo también a mano desde una terminal cuando haga falta reenviar el
 * resumen de un día.
 */
Deno.serve(async (req: Request) => {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  const provided = req.headers.get('x-cron-secret') ?? ''
  if (!expected || provided !== expected) {
    return new Response('No autorizado', { status: 401 })
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('EMAIL_FROM') ?? 'Switchboard <notificaciones@switchboard.local>'
  const sendEmail = apiKey ? resendSender(apiKey, from) : unconfiguredSender

  try {
    const result = await runDigest(db, { sendEmail })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    await db.from('events').insert({
      type: 'digest.unhandled', level: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
    return new Response('Error generando el resumen', { status: 500 })
  }
})
