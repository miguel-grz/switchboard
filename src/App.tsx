import { Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import AgentConfig from './pages/AgentConfig'
import Runs from './pages/Runs'
import Modules from './pages/Modules'
import Monitoring from './pages/Monitoring'
import Login from './pages/Login'
import { useAuth } from './context/AuthContext'

export default function App() {
  const { session, loading, requiresAuth } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="skeleton h-4 w-32" />
      </div>
    )
  }

  // Con datos de muestra no hay sesión que exigir: el demo publicado entra directo.
  if (requiresAuth && !session) return <Login />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:clientId" element={<ClientDetail />} />
        <Route path="/clients/:clientId/agents/:agentId" element={<AgentConfig />} />
        <Route path="/runs" element={<Runs />} />
        <Route path="/modules" element={<Modules />} />
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
