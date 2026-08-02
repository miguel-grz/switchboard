import { createClient } from '@supabase/supabase-js'
import { getAdapter } from '../_shared/providers/index.ts'
import { projectWebhook } from '../_shared/projection.ts'
import { runActions } from '../_shared/actions.ts'
import { resendSender, unconfiguredSender } from '../_shared/email-sender.ts'

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Método no permitido', { status: 405 })
  }

  // La ruta es /provider-webhook/{provider}: un solo endpoint para todos.
  const provider = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? ''

  let adapter
  try {
    adapter = getAdapter(provider)
  } catch {
    return new Response('Proveedor desconocido', { status: 404 })
  }

  // El cuerpo se lee crudo: la firma se calcula sobre estos bytes exactos.
  const rawBody = await req.text()
  const secret = Deno.env.get(`${provider.toUpperCase()}_WEBHOOK_SECRET`) ?? ''

  if (!secret || !(await adapter.verifySignature(req.headers, rawBody, secret))) {
    return new Response('No autorizado', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Cuerpo no es JSON válido', { status: 400 })
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  try {
    const parsed = adapter.parseWebhook(payload)
    const result = await projectWebhook(db, { provider, rawBody, parsed })

    // Las acciones son efecto secundario: la llamada ya quedó guardada, así que
    // un fallo aquí no puede cambiar la respuesta al proveedor ni provocar un
    // reintento que volvería a proyectar lo mismo.
    if (result.runId && !result.skipped) {
      const apiKey = Deno.env.get('RESEND_API_KEY')
      const from = Deno.env.get('EMAIL_FROM')
        ?? 'Switchboard <notificaciones@switchboard.local>'
      const sendEmail = apiKey ? resendSender(apiKey, from) : unconfiguredSender
      try {
        await runActions(db, result.runId, { sendEmail })
      } catch (err) {
        await db.from('events').insert({
          type: 'actions.unhandled', level: 'error', run_id: result.runId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Siempre 200 si el evento quedó registrado: el proveedor reintenta ante
    // cualquier cosa que no sea 2xx, y un payload que nunca va a proyectar
    // generaría reintentos infinitos. El fallo queda en processing_error.
    return Response.json({ ok: true, ...result })
  } catch (err) {
    // Aquí sí conviene el reintento: es un fallo nuestro, no del payload.
    await db.from('events').insert({
      type: 'webhook.unhandled',
      level: 'error',
      message: err instanceof Error ? err.message : String(err),
      payload: { provider },
    })
    return new Response('Error procesando el webhook', { status: 500 })
  }
})
