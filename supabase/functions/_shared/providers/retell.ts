import { registerAdapter, type ProviderAdapter } from './adapter.ts'

/**
 * Stub deliberado. No sirve para funcionar: sirve para demostrar que la
 * interfaz basta para un segundo proveedor sin tocar nada aguas abajo.
 */
export const retellAdapter: ProviderAdapter = {
  name: 'retell',
  verifySignature: () => Promise.resolve(false),
  parseWebhook: () => { throw new Error('Adaptador de Retell no implementado') },
  buildExtractionSchema: () => { throw new Error('Adaptador de Retell no implementado') },
}

registerAdapter(retellAdapter)
