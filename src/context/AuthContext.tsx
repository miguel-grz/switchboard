import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

interface AuthState {
  session: Session | null
  loading: boolean
  /** false cuando la app corre con datos de muestra: no hay nada que proteger. */
  requiresAuth: boolean
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: false,
  requiresAuth: false,
  signIn: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const requiresAuth = isSupabaseConfigured()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(requiresAuth)

  useEffect(() => {
    if (!requiresAuth) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [requiresAuth])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    // El mensaje de Supabase es genérico a propósito: no revela si el correo
    // existe. Se traduce sin añadir información.
    if (error) throw new Error('Correo o contraseña incorrectos.')
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, loading, requiresAuth, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
