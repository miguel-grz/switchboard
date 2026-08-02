/**
 * Raíz de composición de proveedores.
 *
 * Importar este módulo registra todos los adaptadores disponibles. Todo el
 * sistema resuelve proveedores desde aquí; nadie importa un adaptador concreto,
 * que es lo que mantiene a Vapi confinado tras la frontera.
 */
import './vapi/index.ts'
import './retell.ts'

export { getAdapter, registerAdapter, type ProviderAdapter } from './adapter.ts'
