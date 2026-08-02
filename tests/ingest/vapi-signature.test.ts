import { describe, it, expect } from 'vitest'
import { getAdapter } from '../../supabase/functions/_shared/providers/index'

const vapi = getAdapter('vapi')
const SECRET = 'secreto-de-pruebas'
const BODY = '{"message":{"type":"status-update"}}'

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

describe('verificación de firma', () => {
  it('acepta el secreto compartido en X-Vapi-Secret', async () => {
    const h = new Headers({ 'x-vapi-secret': SECRET })
    expect(await vapi.verifySignature(h, BODY, SECRET)).toBe(true)
  })

  it('rechaza un secreto incorrecto', async () => {
    const h = new Headers({ 'x-vapi-secret': 'otro' })
    expect(await vapi.verifySignature(h, BODY, SECRET)).toBe(false)
  })

  it('acepta una firma HMAC válida', async () => {
    const h = new Headers({ 'x-vapi-signature': await hmacHex(SECRET, BODY) })
    expect(await vapi.verifySignature(h, BODY, SECRET)).toBe(true)
  })

  it('rechaza una firma HMAC sobre otro cuerpo', async () => {
    const h = new Headers({ 'x-vapi-signature': await hmacHex(SECRET, '{"otro":1}') })
    expect(await vapi.verifySignature(h, BODY, SECRET)).toBe(false)
  })

  it('rechaza cuando no viene ninguna credencial', async () => {
    expect(await vapi.verifySignature(new Headers(), BODY, SECRET)).toBe(false)
  })

  it('devuelve false en vez de lanzar ante una firma malformada', async () => {
    const h = new Headers({ 'x-vapi-signature': 'no-es-hex' })
    await expect(vapi.verifySignature(h, BODY, SECRET)).resolves.toBe(false)
  })
})
