import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Se inspecciona el archivo generado en vez de usar expectTypeOf: las
// aserciones de tipo se borran en runtime y `tsconfig.app.json` solo incluye
// `src/`, así que `tsc -b` nunca las comprobaría y la prueba pasaría vacía.
const generated = readFileSync(resolve(process.cwd(), 'src/lib/database.types.ts'), 'utf8')

describe('tipos generados', () => {
  it('mantiene billed_usd nullable', () => {
    // Si dejara de serlo, alguien habría roto la separación costo/precio.
    expect(generated).toMatch(/billed_usd: number \| null/)
  })

  it('mantiene intent_id nullable', () => {
    // Es la bisagra que permite añadir motivos sin migrar.
    expect(generated).toMatch(/intent_id: string \| null/)
  })

  it('expone las trece tablas del esquema', () => {
    for (const t of [
      'clients', 'profiles', 'client_members', 'agents', 'agent_intents',
      'field_defs', 'run_raw_events', 'runs', 'transcript_turns',
      'extracted_values', 'usage_events', 'agent_actions', 'action_runs',
    ]) {
      expect(generated).toContain(`${t}: {`)
    }
  })
})
