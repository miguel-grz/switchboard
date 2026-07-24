export type ModuleType = 'voice' | 'email' | 'sms' | 'documents'
export type ClientStatus = 'active' | 'paused' | 'onboarding'
export type AgentStatus = 'active' | 'paused'
export type RunStatus = 'completed' | 'failed' | 'in_progress' | 'no_answer'
export type Provider = 'vapi' | 'retell' | 'custom'
export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'phone'

export interface Client {
  id: string
  name: string
  industry: string
  status: ClientStatus
  modules: ModuleType[]
  contactName: string
  contactEmail: string
  timezone: string
  createdAt: string
  notes: string
}

export interface FieldDef {
  id: string
  name: string
  type: FieldType
  required: boolean
  description: string
  options?: string[]
}

export interface Agent {
  id: string
  clientId: string
  name: string
  description: string
  module: ModuleType
  provider: Provider
  /** Phone number for voice/SMS, address for email. */
  channel: string
  status: AgentStatus
  systemPrompt: string
  fields: FieldDef[]
  lastRunAt: string | null
  createdAt: string
}

export interface TranscriptTurn {
  speaker: 'agent' | 'caller'
  text: string
}

export interface Run {
  id: string
  clientId: string
  agentId: string
  startedAt: string
  durationSec: number
  status: RunStatus
  costUsd: number
  latencyMs: number
  errorMessage?: string
  transcript: TranscriptTurn[]
  extracted: Record<string, string>
}

export interface ModuleInfo {
  type: ModuleType
  name: string
  status: 'available' | 'coming_soon'
  description: string
  capabilities: string[]
  providers: string[]
}
