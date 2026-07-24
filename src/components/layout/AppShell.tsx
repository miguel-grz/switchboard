import { useState, useRef, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutGrid,
  Building2,
  PhoneCall,
  Boxes,
  Activity,
  ChevronsUpDown,
  Check,
  Globe,
  Menu,
  X,
} from 'lucide-react'
import { clients } from '../../mocks/clients'
import { useScope } from '../../context/ScopeContext'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/clients', label: 'Clients', icon: Building2 },
  { to: '/runs', label: 'Runs', icon: PhoneCall },
  { to: '/modules', label: 'Modules', icon: Boxes },
  { to: '/monitoring', label: 'Monitoring', icon: Activity },
]

function ScopeSwitcher() {
  const { scopeClientId, setScopeClientId } = useScope()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const current = clients.find((c) => c.id === scopeClientId)

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px] font-medium text-ink hover:border-line-strong sm:w-auto sm:min-w-[220px]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Globe size={14} className="shrink-0 text-mute" />
        <span className="truncate">{current ? current.name : 'All clients'}</span>
        <ChevronsUpDown size={14} className="ml-auto shrink-0 text-faint" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 w-[280px] max-w-[86vw] rounded-md border border-line bg-surface py-1 shadow-lg"
        >
          <button
            role="option"
            aria-selected={!scopeClientId}
            onClick={() => {
              setScopeClientId(null)
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-sunken"
          >
            <span className="flex-1 font-medium">All clients</span>
            {!scopeClientId && <Check size={14} className="text-cobalt" />}
          </button>
          <div className="my-1 border-t border-line" />
          {clients.map((c) => (
            <button
              key={c.id}
              role="option"
              aria-selected={scopeClientId === c.id}
              onClick={() => {
                setScopeClientId(c.id)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-sunken"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="block text-xs text-mute">{c.industry}</span>
              </span>
              {scopeClientId === c.id && <Check size={14} className="shrink-0 text-cobalt" />}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button
            onClick={() => {
              setOpen(false)
              navigate('/clients')
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-mute hover:bg-sunken hover:text-ink"
          >
            Manage clients →
          </button>
        </div>
      )}
    </div>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-6 w-6 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" fill="var(--color-cobalt)" />
        <circle cx="11" cy="11" r="3" fill="#fff" />
        <circle cx="21" cy="21" r="3" fill="#fff" />
        <path d="M11 14v3a4 4 0 0 0 4 4h3" stroke="#fff" strokeWidth="2" fill="none" />
      </svg>
      <div className="leading-tight">
        <div className="text-[14px] font-semibold tracking-tight">Switchboard</div>
        <div className="data text-[10px] uppercase tracking-[0.14em] text-mute">operator console</div>
      </div>
    </div>
  )
}

export default function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex min-h-screen">
      {/* Backdrop for the mobile drawer */}
      {menuOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-20 bg-ink/25 lg:hidden"
        />
      )}

      {/* Sidebar — fixed on desktop, off-canvas drawer below lg */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[212px] flex-col border-r border-line bg-surface transition-transform lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <Logo />
          <button
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            className="rounded p-1 text-mute hover:bg-sunken hover:text-ink lg:hidden"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${
                  isActive
                    ? 'bg-cobalt-soft text-cobalt'
                    : 'text-ink-2 hover:bg-sunken hover:text-ink'
                }`
              }
            >
              <Icon size={15} strokeWidth={1.9} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            All systems nominal
          </div>
          <div className="data mt-1 text-[10px] text-faint">v0.4.2 · prototype</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-[212px]">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/90 px-3 py-2.5 backdrop-blur sm:gap-3 sm:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="rounded-md border border-line bg-surface p-2 text-ink-2 hover:text-ink lg:hidden"
          >
            <Menu size={15} />
          </button>
          <ScopeSwitcher />
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="data hidden rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-mute sm:inline">
              prod
            </span>
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full bg-cobalt text-[11px] font-semibold text-white"
              title="Miguel Ángel — operator"
            >
              MA
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-3 py-4 sm:px-6 sm:py-5">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
