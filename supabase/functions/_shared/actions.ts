import type { SupabaseClient } from '@supabase/supabase-js'
import { renderRunEmail } from './email.ts'

export interface RunContext {
  runId: string
  clientId: string
  clientName: string
  clientTimezone: string
  agentId: string
  agentName: string
  startedAt: string
  durationSec: number | null
  status: string
  callerNumber: string | null
  summary: string | null
  recordingUrl: string | null
  fields: Record<string, string>
  turns: { speaker: string; text: string }[]
}

/**
 * Evalúa la condición de una acción contra los datos de la llamada.
 *
 * Es deliberadamente simple: igualdad, o pertenencia si el valor esperado es
 * una lista. Nada de operadores ni expresiones — una condición que hay que
 * depurar deja de ser configuración y se vuelve código escondido en la base.
 */
export function matchesCondition(
  condition: Record<string, unknown> | null | undefined,
  context: Record<string, string>,
): boolean {
  if (!condition || Object.keys(condition).length === 0) return true
  return Object.entries(condition).every(([key, expected]) => {
    const actual = context[key]
    if (actual === undefined) return false
    if (Array.isArray(expected)) return expected.map(String).includes(actual)
    return String(expected) === actual
  })
}

/** Reúne en una sola forma todo lo que una acción puede necesitar del run. */
export async function buildRunContext(
  db: SupabaseClient,
  runId: string,
): Promise<RunContext | null> {
  const { data: run } = await db.from('runs')
    .select(`
      id, client_id, agent_id, started_at, duration_sec, status,
      caller_number, summary, recording_url,
      clients ( name, timezone ),
      agents ( name )
    `)
    .eq('id', runId).maybeSingle()

  if (!run) return null

  const { data: values } = await db.from('extracted_values')
    .select('field_key, value_text, extraction_version')
    .eq('run_id', runId).order('extraction_version', { ascending: true })

  // La versión más alta gana: al reprocesar conviven varias y el correo debe
  // reflejar la extracción vigente, no la primera.
  const fields: Record<string, string> = {}
  for (const v of values ?? []) fields[v.field_key] = v.value_text ?? ''

  const { data: turns } = await db.from('transcript_turns')
    .select('speaker, text').eq('run_id', runId).order('seq')

  const client = run.clients as unknown as { name: string; timezone: string } | null
  const agent = run.agents as unknown as { name: string } | null

  return {
    runId: run.id,
    clientId: run.client_id,
    clientName: client?.name ?? 'Cliente',
    clientTimezone: client?.timezone ?? 'UTC',
    agentId: run.agent_id,
    agentName: agent?.name ?? 'Agente',
    startedAt: run.started_at,
    durationSec: run.duration_sec,
    status: run.status,
    callerNumber: run.caller_number,
    summary: run.summary,
    recordingUrl: run.recording_url,
    fields,
    turns: (turns ?? []) as { speaker: string; text: string }[],
  }
}

export interface EmailMessage {
  to: string[]
  subject: string
  html: string
  text: string
}

export type EmailSender = (msg: EmailMessage) => Promise<void>

export interface ActionDeps {
  sendEmail: EmailSender
}

export interface ActionsResult {
  executed: number
  skipped: number
  failed: number
}

/**
 * Ejecuta las acciones configuradas del agente para una llamada.
 *
 * Cada acción se aísla en su propio try: una que falle no puede impedir las
 * demás ni propagar el error a la ingesta. Todo intento queda en action_runs,
 * incluidos los omitidos, para que "no llegó el correo" siempre tenga respuesta.
 */
export async function runActions(
  db: SupabaseClient,
  runId: string,
  deps: ActionDeps,
): Promise<ActionsResult> {
  const result: ActionsResult = { executed: 0, skipped: 0, failed: 0 }

  const ctx = await buildRunContext(db, runId)
  if (!ctx) return result

  const { data: actions } = await db.from('agent_actions')
    .select('id, type, config, condition, enabled')
    .eq('agent_id', ctx.agentId).eq('enabled', true).order('sort_order')

  if (!actions?.length) return result

  // Etiquetas legibles para el correo, tomadas de la configuración del agente.
  const { data: defs } = await db.from('field_defs')
    .select('key, label').eq('agent_id', ctx.agentId)
  const labels = Object.fromEntries((defs ?? []).map(d => [d.key, d.label]))

  const record = async (
    action: { id: string; type: string },
    status: 'sent' | 'failed' | 'skipped',
    detail?: Record<string, unknown>,
    error?: string,
  ) => {
    await db.from('action_runs').insert({
      action_id: action.id, client_id: ctx.clientId, agent_id: ctx.agentId,
      run_id: runId, type: action.type, status,
      detail: detail ?? null, error: error ?? null,
    })
  }

  for (const action of actions) {
    try {
      if (!matchesCondition(action.condition as Record<string, unknown> | null, ctx.fields)) {
        await record(action, 'skipped', { reason: 'condición no cumplida' })
        result.skipped++
        continue
      }

      if (action.type !== 'email_per_run') {
        // `webhook` está declarado en el esquema pero aún sin implementación.
        await record(action, 'skipped', { reason: `tipo ${action.type} no implementado` })
        result.skipped++
        continue
      }

      const recipients = ((action.config as { recipients?: string[] })?.recipients ?? [])
        .filter(r => typeof r === 'string' && r.includes('@'))

      if (recipients.length === 0) {
        await record(action, 'skipped', { reason: 'sin destinatarios configurados' })
        result.skipped++
        continue
      }

      const email = renderRunEmail(ctx, labels)
      await deps.sendEmail({ to: recipients, ...email })
      await record(action, 'sent', { recipients, subject: email.subject })
      result.executed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await record(action, 'failed', undefined, message)
      await db.from('events').insert({
        client_id: ctx.clientId, agent_id: ctx.agentId, run_id: runId,
        type: 'action.failed', level: 'error',
        message: `Acción ${action.type}: ${message}`,
      })
      result.failed++
    }
  }

  return result
}
