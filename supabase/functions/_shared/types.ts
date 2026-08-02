/**
 * Modelo canónico. Ninguna de estas formas debe contener campos con nombre o
 * estructura de un proveedor concreto: si Vapi cambia su payload, cambia el
 * adaptador y nada más.
 */

export type RunStatus = 'in_progress' | 'completed' | 'failed' | 'no_answer'
export type UsageComponent = 'telephony' | 'stt' | 'llm' | 'tts' | 'other'
export type UsageUnit = 'minutes' | 'tokens' | 'characters' | 'calls'
export type EventLevel = 'debug' | 'info' | 'warn' | 'error'

export interface CanonicalTurn {
  seq: number
  speaker: 'agent' | 'caller'
  text: string
  offsetMs?: number
}

export interface CanonicalUsage {
  component: UsageComponent
  quantity: number
  unit: UsageUnit
  costUsd: number | null
  /** Identificador estable del cargo en el proveedor, para idempotencia. */
  sourceEventId: string
}

export interface CanonicalRun {
  providerCallId: string
  providerAgentId: string | null
  direction: 'inbound' | 'outbound'
  callerNumber: string | null
  startedAt: string
  endedAt: string | null
  durationSec: number | null
  status: RunStatus
  endedReason: string | null
  recordingUrl: string | null
  summary: string | null
  /** Pares clave-valor tal como los devolvió el proveedor. */
  extracted: Record<string, string>
  turns: CanonicalTurn[]
}

export interface CanonicalEvent {
  type: string
  level: EventLevel
  message?: string
  payload?: Record<string, unknown>
}

/** Resultado de interpretar un webhook. `run` es null si el evento no lo describe. */
export interface ParsedWebhook {
  providerCallId: string | null
  eventType: string
  /** true solo cuando el evento cierra la llamada y trae el reporte completo. */
  isFinal: boolean
  run: CanonicalRun | null
  usage: CanonicalUsage[]
  events: CanonicalEvent[]
}

export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'phone'
  required: boolean
  description: string | null
  options: string[] | null
}
