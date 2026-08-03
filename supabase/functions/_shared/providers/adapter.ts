import type { ParsedWebhook, FieldDef } from '../types.ts'

/** Entrada neutra para publicar un agente. Sin forma de ningún proveedor. */
export interface AssistantInput {
  name: string
  systemPrompt: string
  fields: FieldDef[]
  /** Ajustes por agente (voz, idioma, saludo…). El adaptador los traduce. */
  config?: Record<string, unknown>
  /** A dónde debe enviar el proveedor sus webhooks, y con qué secreto. */
  webhook?: { url: string; secret: string }
}

export interface ProviderAdapter {
  readonly name: string
  /** Base de la API del proveedor. Vive aquí para que nadie fuera la conozca. */
  readonly apiBaseUrl: string
  /** Verifica que el webhook viene del proveedor. Nunca lanza: devuelve false. */
  verifySignature(headers: Headers, rawBody: string, secret: string): Promise<boolean>
  parseWebhook(payload: unknown): ParsedWebhook
  /** Traduce field_defs al esquema de extracción del proveedor. */
  buildExtractionSchema(fields: FieldDef[]): unknown
  /** Arma la configuración del assistant tal como la espera el proveedor. */
  buildAssistantConfig(input: AssistantInput): unknown
}

/**
 * Este módulo no importa ningún adaptador, a propósito.
 *
 * Los adaptadores importan `registerAdapter` de aquí, así que si aquí se
 * importara un adaptador habría un ciclo. Y como los `import` de ES se elevan,
 * ponerlo "al final del archivo" no lo evita: el adaptador se ejecutaría antes
 * de que `registry` estuviera inicializado. La composición vive en `index.ts`.
 */
const registry = new Map<string, ProviderAdapter>()

export function registerAdapter(a: ProviderAdapter): void {
  registry.set(a.name, a)
}

export function getAdapter(name: string): ProviderAdapter {
  const a = registry.get(name)
  if (!a) throw new Error(`Proveedor desconocido: ${name}`)
  return a
}
