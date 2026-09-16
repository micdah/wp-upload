import { MantineProvider } from '@mantine/core'
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
    <MantineProvider theme={theme} defaultColorScheme='dark'>
      <App />
    </MantineProvider>
  </StrictMode>,
)
