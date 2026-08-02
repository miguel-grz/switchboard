import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { ScopeProvider } from './context/ScopeContext'
import { AuthProvider } from './context/AuthContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <ScopeProvider>
          <App />
        </ScopeProvider>
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
