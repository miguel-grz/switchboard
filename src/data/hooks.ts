import { useEffect, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/**
 * Ejecuta una consulta y expone los tres estados que toda pantalla conectada
 * debe manejar. Descarta el resultado si las dependencias cambiaron mientras
 * viajaba, para que una respuesta lenta no pise a una más nueva.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true })

  useEffect(() => {
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))
    fn()
      .then(data => {
        if (!cancelled) setState({ data, error: null, loading: false })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setState({
          data: null,
          error: e instanceof Error ? e.message : 'No se pudieron cargar los datos.',
          loading: false,
        })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
