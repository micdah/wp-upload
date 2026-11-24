import {
  createTheme,
  defaultVariantColorsResolver,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from '@mantine/core'
import { cyanPrimitives, grayPrimitives } from './tokens'

// The Mantine 9 theme of the media manager, mapped from the design tokens as
// design-system.md §8 describes. Colours that depend on the scheme come from
// the semantic CSS variables (resolver.ts), so the theme object only carries
// the palettes, shapes, spacing and type scale.

/**
 * The neutral grey scale as Mantine's `dark` palette, from gray-400
 * (`dark[0]`, text) down to gray-1000 (`dark[9]`). It replaces Mantine's
 * blue-tinted default, so nothing in the chrome picks up a tint.
 */
export const darkPalette: MantineColorsTuple = [
  grayPrimitives['--gray-400'],
  grayPrimitives['--gray-500'],
  grayPrimitives['--gray-600'],
  grayPrimitives['--gray-700'],
  grayPrimitives['--gray-800'],
  grayPrimitives['--gray-850'],
  grayPrimitives['--gray-900'],
  grayPrimitives['--gray-925'],
  grayPrimitives['--gray-950'],
  grayPrimitives['--gray-1000'],
]

/**
 * The same greys as Mantine's `gray` palette for the light scheme, lightest
 * first. Shades 7–9 are the light theme's text colours (`--text-3`,
 * `--text-2`, `--text-1`), so Mantine's defaults that use them stay legible.
 */
export const grayPalette: MantineColorsTuple = [
  grayPrimitives['--gray-50'],
  grayPrimitives['--gray-100'],
  grayPrimitives['--gray-150'],
  grayPrimitives['--gray-200'],
  grayPrimitives['--gray-300'],
  grayPrimitives['--gray-400'],
  grayPrimitives['--gray-500'],
  '#6b6b6b',
  '#4a4a4a',
  '#111111',
]

/** The neon cyan scale, cyan-50 … cyan-900. */
export const neonPalette: MantineColorsTuple = [
  cyanPrimitives['--cyan-50'],
  cyanPrimitives['--cyan-100'],
  cyanPrimitives['--cyan-200'],
  cyanPrimitives['--cyan-300'],
  cyanPrimitives['--cyan-400'],
  cyanPrimitives['--cyan-500'],
  cyanPrimitives['--cyan-600'],
  cyanPrimitives['--cyan-700'],
  cyanPrimitives['--cyan-800'],
  cyanPrimitives['--cyan-900'],
]

/**
 * Filled and light buttons, badges and the like in the primary colour, or in
 * red, take the design system's fills and on-colours instead of Mantine's
 * computed ones. Mantine's auto contrast would put white text on the light
 * theme's bright cyan and on the dark theme's red, both below 4.5:1.
 * Variants: `filled` = primary button, `light` = active/accent-subtle,
 * `filled` + `color='red'` = "Delete permanently", `subtle` + `color='red'` =
 * the quiet danger button.
 */
export const variantColorResolver: VariantColorsResolver = (input) => {
  const defaults = defaultVariantColorsResolver(input)
  const color = input.color ?? input.theme.primaryColor
  const isPrimary = color === input.theme.primaryColor
  const isDanger = color === 'red'

  if (isPrimary && input.variant === 'filled') {
    return {
      ...defaults,
      background: 'var(--accent)',
      hover: 'var(--accent-hover)',
      color: 'var(--text-on-accent)',
    }
  }
  if (isPrimary && input.variant === 'light') {
    return {
      ...defaults,
      background: 'var(--accent-subtle)',
      hover: 'var(--accent-subtle)',
      color: 'var(--text-accent)',
    }
  }
  if (isDanger && input.variant === 'filled') {
    return {
      ...defaults,
      background: 'var(--danger-fill)',
      hover: 'var(--danger-fill-hover)',
      color: 'var(--text-on-danger)',
    }
  }
  if (isDanger && (input.variant === 'light' || input.variant === 'subtle')) {
    return {
      ...defaults,
      background:
        input.variant === 'light' ? 'var(--danger-subtle)' : 'transparent',
      hover: 'var(--danger-subtle)',
      color: 'var(--danger)',
    }
  }
  return defaults
}

export const mediaManagerTheme = createTheme({
  colors: { dark: darkPalette, gray: grayPalette, neon: neonPalette },
  primaryColor: 'neon',
  primaryShade: { light: 7, dark: 4 },
  autoContrast: true,
  variantColorResolver,
  white: grayPrimitives['--gray-0'],
  black: '#111111',

  fontFamily: 'var(--font-ui)',
  fontFamilyMonospace: 'var(--font-mono)',
  headings: {
    fontFamily: 'var(--font-ui)',
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '24px', lineHeight: '1.3' },
      h2: { fontSize: '20px', lineHeight: '1.35' },
      h3: { fontSize: '16px', lineHeight: '1.4' },
      h4: { fontSize: '14px', lineHeight: '1.45' },
      h5: { fontSize: '13px', lineHeight: '1.45' },
      h6: { fontSize: '12px', lineHeight: '1.45' },
    },
  },
  // 13 px is body text; 12 px labels and chips; 11 px mono meta.
  fontSizes: {
    xs: '11px',
    sm: '12px',
    md: '13px',
    lg: '14px',
    xl: '16px',
  },
  lineHeights: {
    xs: '1.4',
    sm: '1.45',
    md: '1.45',
    lg: '1.5',
    xl: '1.5',
  },
  fontWeights: { regular: '400', medium: '500', bold: '600' },

  radius: {
    xs: 'var(--radius-xs)',
    sm: 'var(--radius-sm)',
    md: 'var(--radius-md)',
    lg: 'var(--radius-lg)',
    xl: 'var(--radius-pill)',
  },
  // Controls use the small radius; cards and menus pass radius='md'.
  defaultRadius: 'sm',
  // The 4 px grid: --space-1, 2, 3, 4 and 6.
  spacing: {
    xs: 'var(--space-1)',
    sm: 'var(--space-2)',
    md: 'var(--space-3)',
    lg: 'var(--space-4)',
    xl: 'var(--space-6)',
  },
  shadows: {
    xs: 'var(--shadow-1)',
    sm: 'var(--shadow-1)',
    md: 'var(--shadow-2)',
    lg: 'var(--shadow-3)',
    xl: 'var(--shadow-3)',
  },
  // The layout breakpoints of the brief: phone < 600, narrow < 900,
  // medium < 1200 px. lg and xl only keep Mantine's order intact.
  breakpoints: {
    xs: '37.5em',
    sm: '56.25em',
    md: '75em',
    lg: '90em',
    xl: '120em',
  },
  focusRing: 'auto',
  respectReducedMotion: true,
})
