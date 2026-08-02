import { describe, it, expect } from 'vitest'
import { serviceClient } from './client'
import { supabaseEnv } from './env'

// Deliberadamente independiente del esquema: esta prueba sobrevive a todas las
// migraciones posteriores. Afirmar aquí que una tabla "todavía no existe"
// convertiría la Task 2 en la causa de un fallo en la Task 1.
describe('instancia local', () => {
  it('expone la configuración de conexión', () => {
    const env = supabaseEnv()
    expect(env.url).toMatch(/^http/)
    expect(env.dbUrl).toMatch(/^postgres/)
  })

  it('responde a una consulta autenticada con service_role', async () => {
    const { error } = await serviceClient().auth.admin.listUsers()
    expect(error).toBeNull()
  })
})
