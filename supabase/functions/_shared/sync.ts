import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdapter } from './providers/index.ts'
import type { FieldDef } from './types.ts'

/** Firma mínima de fetch. Se inyecta para poder probar sin red. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface SyncDeps {
  http: FetchLike
  apiKey: string
  baseUrl?: string
  /** A dónde debe llamar el proveedor al terminar una llamada. */
  webhook?: { url: string; secret: string }
}

export interface SyncResult {
  providerAgentId: string
  version: number
}

/**
 * Publica la configuración del agente en el proveedor y congela una revisión.
 *
 * La revisión se escribe **después** de que el proveedor confirma: si se
 * escribiera antes, un fallo dejaría un histórico que afirma una configuración
 * que nunca llegó a estar vigente.
 */
export async function syncAgent(
  db: SupabaseClient,
  agentId: string,
  deps: SyncDeps,
): Promise<SyncResult> {
  const { data: agent, error } = await db.from('agents')
    .select('id, client_id, name, provider, provider_agent_id, system_prompt, config')
    .eq('id', agentId).single()
  if (error || !agent) throw new Error(`Agente no encontrado: ${agentId}`)

  const { data: rows } = await db.from('field_defs')
    .select('key, label, type, required, description, options')
    .eq('agent_id', agentId).is('intent_id', null).order('sort_order')

  const fields = (rows ?? []) as FieldDef[]
  const adapter = getAdapter(agent.provider)
  const agentConfig = (agent.config ?? {}) as Record<string, unknown>
  const config = adapter.buildAssistantConfig({
    name: agent.name,
    systemPrompt: agent.system_prompt,
    fields,
    config: agentConfig,
    webhook: deps.webhook,
  })

  // La base la declara el adaptador: este módulo no sabe qué proveedor es.
  const base = deps.baseUrl ?? adapter.apiBaseUrl
  const isUpdate = Boolean(agent.provider_agent_id)
  const url = isUpdate ? `${base}/assistant/${agent.provider_agent_id}` : `${base}/assistant`

  const res = await deps.http(url, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(config),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const message =
      `El proveedor rechazó la sincronización (${res.status}): ${detail.slice(0, 200)}`
    await db.from('events').insert({
      client_id: agent.client_id, agent_id: agentId,
      type: 'agent.sync_failed', level: 'error', message,
    })
    throw new Error(message)
  }

  const body = await res.json() as { id?: string }
  const providerAgentId = body.id ?? agent.provider_agent_id
  if (!providerAgentId) throw new Error('El proveedor no devolvió un identificador de assistant')

  const { data: last } = await db.from('agent_revisions')
    .select('version').eq('agent_id', agentId)
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const version = (last?.version ?? 0) + 1

  await db.from('agent_revisions').insert({
    agent_id: agentId,
    version,
    system_prompt: agent.system_prompt,
    fields,
    // También la config: sin ella se sabría con qué prompt corrió una llamada
    // pero no con qué voz ni con qué idioma.
    config: agentConfig,
    provider: agent.provider,
    provider_agent_id: providerAgentId,
  })

  await db.from('agents')
    .update({ provider_agent_id: providerAgentId, updated_at: new Date().toISOString() })
    .eq('id', agentId)

  await db.from('events').insert({
    client_id: agent.client_id, agent_id: agentId,
    type: 'agent.synced', level: 'info',
    message: `Agente publicado como revisión ${version}`,
    payload: { providerAgentId, fields: fields.length },
  })

  return { providerAgentId, version }
}

/**
 * Ata un número ya aprovisionado en el proveedor a este agente.
 *
 * El número **se compra a mano** en el panel del proveedor: comprarlo por API
 * gasta dinero real, y no es algo que deba poder disparar un despliegue por
 * accidente. Esto solo lo enlaza, que es la parte reversible.
 */
export async function attachPhoneNumber(
  db: SupabaseClient,
  agentId: string,
  providerPhoneNumberId: string,
  deps: SyncDeps,
): Promise<void> {
  const { data: agent, error } = await db.from('agents')
    .select('id, client_id, provider, provider_agent_id, channel')
    .eq('id', agentId).single()
  if (error || !agent) throw new Error(`Agente no encontrado: ${agentId}`)
  if (!agent.provider_agent_id) {
    throw new Error('El agente no está publicado todavía: sincronízalo antes de atar un número')
  }

  const adapter = getAdapter(agent.provider)
  const base = deps.baseUrl ?? adapter.apiBaseUrl

  const res = await deps.http(`${base}/phone-number/${providerPhoneNumberId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${deps.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ assistantId: agent.provider_agent_id }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const message = `No se pudo atar el número (${res.status}): ${detail.slice(0, 200)}`
    await db.from('events').insert({
      client_id: agent.client_id, agent_id: agentId,
      type: 'agent.phone_attach_failed', level: 'error', message,
    })
    throw new Error(message)
  }

  const body = await res.json().catch(() => ({})) as { number?: string }
  await db.from('agents')
    .update({ channel: body.number ?? agent.channel, updated_at: new Date().toISOString() })
    .eq('id', agentId)

  await db.from('events').insert({
    client_id: agent.client_id, agent_id: agentId,
    type: 'agent.phone_attached', level: 'info',
    message: `Número ${body.number ?? providerPhoneNumberId} atado al agente`,
    payload: { providerPhoneNumberId },
  })
}
