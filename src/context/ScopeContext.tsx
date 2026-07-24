import { createContext, useContext, useState, type ReactNode } from 'react'

interface ScopeState {
  /** null = all clients */
  scopeClientId: string | null
  setScopeClientId: (id: string | null) => void
}

const ScopeContext = createContext<ScopeState>({
  scopeClientId: null,
  setScopeClientId: () => {},
})

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scopeClientId, setScopeClientId] = useState<string | null>(null)
  return (
    <ScopeContext.Provider value={{ scopeClientId, setScopeClientId }}>
      {children}
    </ScopeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useScope() {
  return useContext(ScopeContext)
}
