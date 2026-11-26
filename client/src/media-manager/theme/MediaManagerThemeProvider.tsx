import './mantineStyles'
import './fonts'
import './theme.css'
import {
  localStorageColorSchemeManager,
  type MantineColorScheme,
  type MantineColorSchemeManager,
  MantineProvider,
} from '@mantine/core'
import type { ReactNode } from 'react'
import { mediaManagerCssVariablesResolver } from './resolver'
import { mediaManagerTheme } from './theme'

/**
 * The localStorage key of the media manager's colour scheme. It differs from
 * Mantine's default key, which the old upload page uses, so the two views
 * keep separate choices.
 */
export const COLOR_SCHEME_STORAGE_KEY = 'wpu-mm-color-scheme'

/** Remembers the chosen scheme (light, dark or auto) in localStorage. */
export const mediaManagerColorSchemeManager = localStorageColorSchemeManager({
  key: COLOR_SCHEME_STORAGE_KEY,
})

export interface MediaManagerThemeProviderProps {
  children: ReactNode
  /**
   * Pins the scheme and ignores the stored choice (tests, screenshots).
   * Without it the user's choice applies, `auto` (follow the OS) by default.
   */
  forceColorScheme?: 'light' | 'dark'
  /** Scheme until the user picks one. Default `auto`. */
  defaultColorScheme?: MantineColorScheme
  /** Replaces the localStorage manager, e.g. with an in-memory one in tests. */
  colorSchemeManager?: MantineColorSchemeManager
}

/**
 * Mantine provider with the media manager's theme: the token palettes, the
 * semantic CSS variables for both schemes, Geist fonts and its own
 * colour-scheme storage. Mount it once, at the root of the media-manager
 * chunk. Toggle the scheme with Mantine's `useMantineColorScheme()`.
 */
export function MediaManagerThemeProvider({
  children,
  forceColorScheme,
  defaultColorScheme = 'auto',
  colorSchemeManager = mediaManagerColorSchemeManager,
}: MediaManagerThemeProviderProps) {
  return (
    <MantineProvider
      theme={mediaManagerTheme}
      cssVariablesResolver={mediaManagerCssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme={defaultColorScheme}
      forceColorScheme={forceColorScheme}
    >
      {children}
    </MantineProvider>
  )
}
