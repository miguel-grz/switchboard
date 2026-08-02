import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdapter } from './providers/index.ts'
import type { FieldDef } from './types.ts'

/** Firma mínima de fetch. Se inyecta para poder probar sin red. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface SyncDeps {
  http: FetchLike
  apiKey: string
  baseUrl?: string
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
    .select('id, client_id, name, provider, provider_agent_id, system_prompt')
    .eq('id', agentId).single()
  if (error || !agent) throw new Error(`Agente no encontrado: ${agentId}`)

  const { data: rows } = await db.from('field_defs')
    .select('key, label, type, required, description, options')
    .eq('agent_id', agentId).is('intent_id', null).order('sort_order')

  const fields = (rows ?? []) as FieldDef[]
  const adapter = getAdapter(agent.provider)
  const config = adapter.buildAssistantConfig({
    name: agent.name,
    systemPrompt: agent.system_prompt,
    fields,
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
