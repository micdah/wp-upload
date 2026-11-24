import type { CSSVariablesResolver } from '@mantine/core'
import { darkTokens, lightTokens, sharedTokens } from './tokens'

// Puts the design tokens on :root (the semantic ones per colour scheme), and
// points Mantine's own colour variables at them, so Mantine components and
// our custom ones share one source. Mantine merges this over its default
// resolver, so only the variables listed here change.

/** Mantine variables that read a semantic token, the same in both schemes. */
const mantineVariablesFromTokens = {
  '--mantine-color-body': 'var(--surface-app)',
  '--mantine-color-text': 'var(--text-1)',
  '--mantine-color-bright': 'var(--text-1)',
  '--mantine-color-dimmed': 'var(--text-2)',
  '--mantine-color-placeholder': 'var(--text-3)',
  '--mantine-color-anchor': 'var(--text-accent)',
  '--mantine-color-error': 'var(--danger)',
  '--mantine-color-success': 'var(--ok)',
  // `default` variant controls (Button, ActionIcon, Select…): raised surface,
  // a control border and the neutral hover overlay.
  '--mantine-color-default': 'var(--surface-raised)',
  '--mantine-color-default-hover': 'var(--surface-hover)',
  '--mantine-color-default-color': 'var(--text-1)',
  '--mantine-color-default-border': 'var(--line-2)',
  '--mantine-color-disabled': 'var(--surface-active)',
  '--mantine-color-disabled-color': 'var(--text-3)',
  '--mantine-color-disabled-border': 'var(--line-1)',
  // The primary colour (Checkbox, Switch, Radio, Slider, Progress, focus…).
  '--mantine-primary-color-contrast': 'var(--text-on-accent)',
  '--mantine-color-neon-filled': 'var(--accent)',
  '--mantine-color-neon-filled-hover': 'var(--accent-hover)',
  '--mantine-color-neon-light': 'var(--accent-subtle)',
  '--mantine-color-neon-light-hover': 'var(--accent-subtle)',
  '--mantine-color-neon-light-color': 'var(--text-accent)',
  '--mantine-color-neon-text': 'var(--text-accent)',
  '--mantine-color-neon-outline': 'var(--text-accent)',
  '--mantine-color-neon-outline-hover': 'var(--accent-subtle)',
  // Red is the danger colour.
  '--mantine-color-red-filled': 'var(--danger-fill)',
  '--mantine-color-red-filled-hover': 'var(--danger-fill-hover)',
  '--mantine-color-red-light': 'var(--danger-subtle)',
  '--mantine-color-red-light-hover': 'var(--danger-subtle)',
  '--mantine-color-red-light-color': 'var(--danger)',
  '--mantine-color-red-text': 'var(--danger)',
  '--mantine-color-red-outline': 'var(--danger)',
} as const

/**
 * The resolver to pass to `MantineProvider` (MediaManagerThemeProvider does).
 * `variables` holds the scheme-independent tokens (primitives, type, shape,
 * motion, layers, layout); `dark` and `light` the semantic tokens.
 */
export const mediaManagerCssVariablesResolver: CSSVariablesResolver = () => ({
  variables: { ...sharedTokens },
  dark: { ...darkTokens, ...mantineVariablesFromTokens },
  light: { ...lightTokens, ...mantineVariablesFromTokens },
})
