// The media manager's providers: the theme (F3's MediaManagerThemeProvider:
// tokens, fonts, its own colour-scheme key so the old page's choice never
// leaks in), notifications, the data layer's QueryClient (F2), and the
// single confirm dialog and live region.
//
// The colour scheme follows the OS until the user picks one with the theme
// toggle; the choice is remembered under `wpu-mm-color-scheme` (D48).

import {
  type MantineColorScheme,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core'
import type { QueryClient } from '@tanstack/react-query'
import { lazy, type ReactNode, Suspense, useEffect } from 'react'
import { implementCommand } from '../core/commands/registry'
import { LibraryQueryProvider } from '../core/data/client'
import { ConfirmHost } from '../core/ui/confirm'
import { LiveRegion } from '../core/ui/LiveRegion'
import { MediaManagerThemeProvider } from '../theme/MediaManagerThemeProvider'

// The toasts' container is a lazy chunk (NotificationsHost.tsx).
const NotificationsHost = lazy(() => import('./NotificationsHost'))

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

export interface AppProvidersProps {
  children: ReactNode
  /** A shared client (tests); one is created per mount otherwise. */
  queryClient?: QueryClient
  /** Pins the scheme (tests); otherwise the stored choice or the OS. */
  forceColorScheme?: Exclude<MantineColorScheme, 'auto'>
}

export function AppProviders({
  children,
  queryClient,
  forceColorScheme,
}: AppProvidersProps) {
  return (
    <MediaManagerThemeProvider forceColorScheme={forceColorScheme}>
      <LibraryQueryProvider client={queryClient}>
        <Suspense fallback={null}>
          <NotificationsHost />
        </Suspense>
        <ThemeCommand />
        {children}
        <ConfirmHost />
        <LiveRegion />
      </LibraryQueryProvider>
    </MediaManagerThemeProvider>
  )
}
