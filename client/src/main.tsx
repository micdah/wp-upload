import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// No provider and no CSS here: each view (the original upload page and the
// media manager) is a lazy chunk that mounts its own Mantine provider, theme
// and styles. See App.tsx.
const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
