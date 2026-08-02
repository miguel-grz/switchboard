import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'

const field =
  'w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] focus:border-cobalt focus:outline-none'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-[340px]">
        <div className="mb-6 flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--color-cobalt)" />
            <circle cx="11" cy="11" r="3" fill="#fff" />
            <circle cx="21" cy="21" r="3" fill="#fff" />
            <path d="M11 14v3a4 4 0 0 0 4 4h3" stroke="#fff" strokeWidth="2" fill="none" />
          </svg>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">Switchboard</div>
            <div className="data text-[10px] uppercase tracking-[0.14em] text-mute">
              operator console
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-line bg-surface p-5">
          <label className="block text-xs font-medium text-mute">
            Correo
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="username"
              required
              className={`${field} mt-1`}
            />
          </label>
          <label className="block text-xs font-medium text-mute">
            Contraseña
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className={`${field} mt-1`}
            />
          </label>

          {error && (
            <p
              role="alert"
              className="rounded border border-fail/25 bg-fail-soft px-3 py-2 text-[13px] text-fail"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-cobalt px-4 py-2 text-[13px] font-medium text-white hover:bg-cobalt-dark disabled:opacity-60"
          >
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </div>
  )
}
