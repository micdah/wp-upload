// The design tokens of the media manager ("Neutral + neon"), copied from
// docs/media-manager/design/prototype/css/tokens.css and the layout block of
// prototype/css/base.css. The names and values match those files exactly
// (tokens.spec.ts checks it), except the font stacks, which name the
// self-hosted variable fonts (see fonts.ts).
//
// Components read these as CSS variables (`var(--surface-panel)`, or
// `cssVar('surface-panel')`); the resolver in resolver.ts puts them on :root
// for both colour schemes.

/** Neutral greys, dark end → light end. Never used by components directly. */
export const grayPrimitives = {
  '--gray-1000': '#080808',
  '--gray-950': '#0d0d0d',
  '--gray-925': '#101010',
  '--gray-900': '#141414',
  '--gray-850': '#1c1c1c',
  '--gray-800': '#222222',
  '--gray-700': '#333333',
  '--gray-600': '#666666',
  '--gray-500': '#8f8f8f',
  '--gray-400': '#b3b3b3',
  '--gray-300': '#d4d4d4',
  '--gray-200': '#e6e6e6',
  '--gray-150': '#ebebeb',
  '--gray-100': '#f4f4f4',
  '--gray-50': '#fafafa',
  '--gray-0': '#ffffff',
} as const

/** The neon cyan scale. Never used by components directly. */
export const cyanPrimitives = {
  '--cyan-50': '#e6fdff',
  '--cyan-100': '#b3f8ff',
  '--cyan-200': '#80f3ff',
  '--cyan-300': '#5cefff',
  '--cyan-400': '#00e5ff',
  '--cyan-500': '#00d4ec',
  '--cyan-600': '#00b4cc',
  '--cyan-700': '#008a9e',
  '--cyan-800': '#007485',
  '--cyan-900': '#004c57',
  '--cyan-950': '#002a30',
} as const

const monoStack =
  "'Geist Mono Variable', 'Geist Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"

/** Typography. 13 px is body, 12 px labels and chips, 11 px mono meta. */
export const typographyTokens = {
  '--font-ui':
    "'Geist Variable', Geist, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  '--font-display': monoStack,
  '--font-mono': monoStack,
  // The wordmark only. Not self-hosted yet (see the F3 handoff note).
  '--font-brand': 'Orbitron, var(--font-ui)',
  '--fs-11': '11px',
  '--fs-12': '12px',
  '--fs-13': '13px',
  '--fs-14': '14px',
  '--fs-16': '16px',
  '--fs-20': '20px',
  '--fs-24': '24px',
  '--fw-regular': '400',
  '--fw-medium': '500',
  '--fw-semibold': '600',
  '--display-transform': 'uppercase',
  '--display-tracking': '0.1em',
} as const

/** Radii, including the tile shapes. */
export const shapeTokens = {
  '--radius-xs': '4px',
  '--radius-sm': '6px',
  '--radius-md': '10px',
  '--radius-lg': '14px',
  '--radius-pill': '999px',
  '--radius-tile': '2px',
  '--radius-tile-selected': '8px',
  '--tile-selected-scale': '0.9',
} as const

/**
 * Durations and easings. Under `prefers-reduced-motion: reduce`, `--dur-2`
 * and `--dur-morph` drop to 1 ms (theme.css).
 */
export const motionTokens = {
  '--dur-1': '90ms',
  '--dur-2': '150ms',
  '--dur-3': '220ms',
  '--dur-morph': '260ms',
  '--ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
  '--ease-in': 'cubic-bezier(0.5, 0, 0.75, 0)',
  '--ease-standard': 'cubic-bezier(0.2, 0, 0, 1)',
} as const

/** Stacking order of the app's layers. */
export const layerTokens = {
  '--z-grid': '0',
  '--z-detail': '2',
  '--z-stage-overlay': '3',
  '--z-toolbar': '3',
  '--z-drawer': '10',
  '--z-popover': '20',
  '--z-toast': '30',
  '--z-dialog': '40',
  '--z-drop-overlay': '45',
} as const

/** The 4 px spacing grid and the fixed layout dimensions (base.css). */
export const layoutTokens = {
  '--grid-gap': '2px',
  '--toolbar-h': '48px',
  '--filterbar-h': '40px',
  '--folders-w': '280px',
  '--rail-w': '48px',
  '--inspector-panel-w': '312px',
  '--filmstrip-h': '96px',
  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-5': '20px',
  '--space-6': '24px',
  '--space-7': '32px',
  '--space-8': '40px',
} as const

/** Semantic tokens of the dark scheme: what components use. */
export const darkTokens = {
  '--surface-app': 'var(--gray-950)',
  '--surface-panel': 'var(--gray-900)',
  '--surface-raised': 'var(--gray-850)',
  '--surface-overlay': 'var(--gray-800)',
  '--surface-stage': 'var(--gray-1000)',
  '--surface-tile': 'var(--gray-850)',
  '--surface-filmstrip': 'var(--gray-1000)',
  '--surface-hover': 'rgb(255 255 255 / 0.06)',
  '--surface-active': 'rgb(255 255 255 / 0.1)',
  '--surface-input': 'var(--gray-925)',
  '--scrim': 'rgb(0 0 0 / 0.6)',

  '--text-1': '#f2f2f2',
  '--text-2': 'var(--gray-400)',
  '--text-3': 'var(--gray-500)',
  '--text-on-accent': 'var(--cyan-950)',
  '--text-accent': 'var(--cyan-400)',
  '--text-on-select': 'var(--cyan-950)',

  '--line-1': 'rgb(255 255 255 / 0.07)',
  '--line-2': 'rgb(255 255 255 / 0.14)',
  '--line-input': 'var(--gray-600)',

  '--accent': 'var(--cyan-400)',
  '--accent-hover': 'var(--cyan-300)',
  '--accent-subtle': 'rgb(0 229 255 / 0.1)',
  '--accent-line': 'rgb(0 229 255 / 0.5)',
  '--focus-ring': 'var(--cyan-400)',
  '--select-ring': 'var(--cyan-400)',
  '--select-tint': 'rgb(255 255 255 / 0.05)',
  '--filmstrip-dim': '0.55',

  '--ok': '#3ddc84',
  '--warn': '#ffc247',
  '--warn-fill': '#ffc247',
  '--text-on-warn': '#1a1300',
  '--danger': '#ff6b78',
  '--danger-fill': '#ff5c6c',
  '--danger-fill-hover': '#ff7a86',
  '--text-on-danger': '#1f0004',
  '--info': 'var(--cyan-400)',
  '--warn-subtle': 'rgb(255 194 71 / 0.14)',
  '--danger-subtle': 'rgb(255 92 108 / 0.14)',

  '--shadow-1': '0 1px 2px rgb(0 0 0 / 0.5)',
  '--shadow-2': '0 6px 20px rgb(0 0 0 / 0.5)',
  '--shadow-3': '0 16px 48px rgb(0 0 0 / 0.6)',
  '--glow-accent':
    '0 0 0 1px rgb(0 229 255 / 0.3), 0 0 12px rgb(0 229 255 / 0.28)',
} as const

/** The semantic token names, shared by both schemes. */
export type SemanticToken = keyof typeof darkTokens

/** Semantic tokens of the light scheme. Same names as the dark scheme. */
export const lightTokens = {
  '--surface-app': 'var(--gray-100)',
  '--surface-panel': 'var(--gray-0)',
  '--surface-raised': 'var(--gray-0)',
  '--surface-overlay': 'var(--gray-0)',
  '--surface-stage': 'var(--gray-150)',
  '--surface-tile': 'var(--gray-200)',
  '--surface-filmstrip': 'var(--gray-50)',
  '--surface-hover': 'rgb(0 0 0 / 0.045)',
  '--surface-active': 'rgb(0 0 0 / 0.08)',
  '--surface-input': 'var(--gray-0)',
  '--scrim': 'rgb(0 0 0 / 0.35)',

  '--text-1': '#111111',
  '--text-2': '#4a4a4a',
  '--text-3': '#6b6b6b',
  '--text-on-accent': '#00262b',
  '--text-accent': 'var(--cyan-800)',
  '--text-on-select': 'var(--gray-0)',

  '--line-1': 'rgb(0 0 0 / 0.08)',
  '--line-2': 'rgb(0 0 0 / 0.15)',
  '--line-input': '#8a8a8a',

  '--accent': 'var(--cyan-500)',
  '--accent-hover': '#00c2da',
  '--accent-subtle': 'rgb(0 180 205 / 0.1)',
  '--accent-line': 'rgb(0 138 158 / 0.45)',
  '--focus-ring': 'var(--cyan-700)',
  '--select-ring': 'var(--cyan-700)',
  '--select-tint': 'rgb(0 0 0 / 0.04)',
  '--filmstrip-dim': '0.72',

  '--ok': '#17803d',
  '--warn': '#a86400',
  '--warn-fill': '#ffc247',
  '--text-on-warn': '#1a1300',
  '--danger': '#c8283a',
  '--danger-fill': '#c8283a',
  '--danger-fill-hover': '#a61f2f',
  '--text-on-danger': '#ffffff',
  '--info': 'var(--cyan-800)',
  '--warn-subtle': 'rgb(168 100 0 / 0.1)',
  '--danger-subtle': 'rgb(200 40 58 / 0.08)',

  '--shadow-1': '0 1px 2px rgb(0 0 0 / 0.08)',
  '--shadow-2': '0 6px 20px rgb(0 0 0 / 0.1)',
  '--shadow-3': '0 16px 48px rgb(0 0 0 / 0.16)',
  '--glow-accent':
    '0 1px 2px rgb(0 90 105 / 0.18), 0 2px 10px rgb(0 200 230 / 0.25)',
} as const satisfies Record<SemanticToken, string>

/** Tokens that are the same in both schemes. */
export const sharedTokens = {
  ...grayPrimitives,
  ...cyanPrimitives,
  ...typographyTokens,
  ...shapeTokens,
  ...motionTokens,
  ...layerTokens,
  ...layoutTokens,
} as const

/** Every token name the theme defines, with or without the scheme split. */
export type TokenName = SemanticToken | keyof typeof sharedTokens

/** Strips the leading `--` from a token name: `'--surface-panel'` → `'surface-panel'`. */
type Bare<Name extends string> = Name extends `--${infer Rest}` ? Rest : never

/**
 * A typed reference to a token for inline styles:
 * `cssVar('surface-panel')` → `'var(--surface-panel)'`. A typo is a type error.
 */
export function cssVar(name: Bare<TokenName>): string {
  return `var(--${name})`
}
