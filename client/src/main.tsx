import { MantineProvider, v8CssVariablesResolver } from '@mantine/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@mantine/core/styles.css'
import '@mantine/dropzone/styles.css'
import './cyberpunk.css'
import App from './App'
import { theme } from './theme'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    {/* Mantine 9 made the `light` variant (Alert, Badge, Button) solid. The
        8.x resolver keeps it translucent, so the look stays as it was until
        the visual design is revisited. */}
    <MantineProvider
      theme={theme}
      defaultColorScheme='dark'
      cssVariablesResolver={v8CssVariablesResolver}
    >
      <App />
    </MantineProvider>
  </StrictMode>,
)
