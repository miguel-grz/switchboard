import type { DataSource } from './source'
import { mockSource } from './mock-source'
import { supabaseSource } from './supabase-source'
import { isSupabaseConfigured } from '../lib/supabase'

let cached: DataSource | null = null

/**
 * Elige la fuente según la configuración.
 *
 * Sin variables de Supabase la app corre con datos de muestra: es lo que
 * mantiene funcionando el demo publicado en GitHub Pages, que no puede
 * alcanzar ninguna base.
 */
export function getDataSource(): DataSource {
  if (!cached) cached = isSupabaseConfigured() ? supabaseSource : mockSource
  return cached
}

export type { DataSource, RunFilter } from './source'
