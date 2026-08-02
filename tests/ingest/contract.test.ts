import { describe, it, expect } from 'vitest'
import { getAdapter } from '../../supabase/functions/_shared/providers/index'

describe('registro de adaptadores', () => {
  it('resuelve el adaptador de vapi por nombre', () => {
    const a = getAdapter('vapi')
    expect(a.name).toBe('vapi')
    expect(typeof a.verifySignature).toBe('function')
    expect(typeof a.parseWebhook).toBe('function')
    expect(typeof a.buildExtractionSchema).toBe('function')
  })

  it('falla con un proveedor desconocido en vez de devolver algo vacío', () => {
    expect(() => getAdapter('paloma')).toThrow(/desconocido/i)
  })

  // Retell existe para demostrar que la interfaz basta, no para funcionar.
  it('expone retell como stub que declara su ausencia', () => {
    const a = getAdapter('retell')
    expect(a.name).toBe('retell')
    expect(() => a.parseWebhook({})).toThrow(/no implementado/i)
  })
})
