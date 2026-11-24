// The media manager's providers: Mantine (its own colour-scheme key, so the
// old page's choice never leaks in), notifications, TanStack Query, and the
// single confirm dialog and live region.
//
// Track F3 supplies MediaManagerThemeProvider (theme from the design tokens,
// the cssVariablesResolver, fonts). Until it merges this uses Mantine's
// defaults; at integration the MantineProvider below is swapped for it.

import {
  localStorageColorSchemeManager,
  MantineProvider,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { implementCommand } from '../core/commands/registry'
import { ConfirmHost } from '../core/ui/confirm'
import { LiveRegion } from '../core/ui/LiveRegion'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'

export const COLOR_SCHEME_KEY = 'wpu-media-manager:color-scheme'

const colorSchemeManager = localStorageColorSchemeManager({
  key: COLOR_SCHEME_KEY,
})

// TEMPORARY (M1): F2's core/data owns the QueryClient and its defaults.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
})

/** Implements `theme.toggle` (it needs Mantine's colour-scheme hooks). */
function ThemeCommand() {
  const { setColorScheme } = useMantineColorScheme()
  const computed = useComputedColorScheme('dark')
  useEffect(
    () =>
      implementCommand('theme.toggle', {
        run: () => setColorScheme(computed === 'dark' ? 'light' : 'dark'),
      }),
    [computed, setColorScheme],
  )
  return null
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      defaultColorScheme='auto'
      colorSchemeManager={colorSchemeManager}
    >
      <QueryClientProvider client={queryClient}>
        <Notifications position='bottom-right' />
        <ThemeCommand />
        {children}
        <ConfirmHost />
        <LiveRegion />
      </QueryClientProvider>
    </MantineProvider>
  )
}
