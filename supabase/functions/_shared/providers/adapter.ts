import type { ParsedWebhook, FieldDef } from '../types.ts'

export interface ProviderAdapter {
  readonly name: string
  /** Verifica que el webhook viene del proveedor. Nunca lanza: devuelve false. */
  verifySignature(headers: Headers, rawBody: string, secret: string): Promise<boolean>
  parseWebhook(payload: unknown): ParsedWebhook
  /** Traduce field_defs al esquema de extracción del proveedor. */
  buildExtractionSchema(fields: FieldDef[]): unknown
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
