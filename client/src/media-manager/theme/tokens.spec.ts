import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mediaManagerCssVariablesResolver } from './resolver'
import { mediaManagerTheme } from './theme'
import {
  darkTokens,
  layoutTokens,
  lightTokens,
  sharedTokens,
  typographyTokens,
} from './tokens'

// The theme must carry exactly the design system's tokens: same names, same
// values, in both schemes. The prototype's CSS is the source of truth
// (design-system.md), so these tests read it and fail on any drift.

const prototypeCss = new URL(
  '../../../../docs/media-manager/design/prototype/css/',
  import.meta.url,
)
const tokensCss = readFileSync(new URL('tokens.css', prototypeCss), 'utf8')
const baseCss = readFileSync(new URL('base.css', prototypeCss), 'utf8')

/** The custom properties declared in the first block for `selector`. */
function declarations(css: string, selector: string): Record<string, string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = source.indexOf(`${selector} {`)
  if (start === -1) {
    throw new Error(`No '${selector}' block`)
  }
  const body = source.slice(
    source.indexOf('{', start) + 1,
    source.indexOf('}', start),
  )
  const result: Record<string, string> = {}
  for (const declaration of body.split(';')) {
    const match = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(declaration)
    if (match) {
      result[match[1] as string] = (match[2] as string).replace(/\s+/g, ' ')
    }
  }
  return result
}

function normalise(tokens: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => [
      name,
      value.replace(/\s+/g, ' ').replace(/"/g, "'"),
    ]),
  )
}

// Font stacks deliberately differ: they name the self-hosted variable faces.
const FONT_TOKENS = Object.keys(typographyTokens).filter((name) =>
  name.startsWith('--font-'),
)

function withoutFonts(tokens: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tokens).filter(([name]) => !FONT_TOKENS.includes(name)),
  )
}

describe('design tokens', () => {
  it('match the primitives, type, shape, motion and layers of tokens.css', () => {
    const prototype = withoutFonts(declarations(tokensCss, ':root'))
    const ours = withoutFonts(normalise(sharedTokens))
    for (const name of Object.keys(layoutTokens)) {
      if (name !== '--grid-gap') {
        delete ours[name]
      }
    }
    expect(ours).toEqual(prototype)
  })

  it('match the layout dimensions and spacing of base.css', () => {
    const prototype = declarations(baseCss, ':root')
    const { '--grid-gap': _gridGap, ...ours } = layoutTokens
    expect(normalise(ours)).toEqual(prototype)
  })

  it.each([
    ['dark', darkTokens],
    ['light', lightTokens],
  ] as const)(
    'match the %s semantic tokens of tokens.css',
    (scheme, tokens) => {
      const prototype = declarations(tokensCss, `:root[data-theme="${scheme}"]`)
      expect(normalise(tokens)).toEqual(prototype)
    },
  )

  it('name the same fonts as tokens.css, self-hosted faces first', () => {
    const prototype = declarations(tokensCss, ':root')
    expect(typographyTokens['--font-ui']).toMatch(/^'Geist Variable', Geist,/)
    expect(typographyTokens['--font-mono']).toMatch(
      /^'Geist Mono Variable', 'Geist Mono',/,
    )
    expect(prototype['--font-ui']).toMatch(/^"Geist",/)
    expect(prototype['--font-brand']).toContain('Orbitron')
    expect(typographyTokens['--font-brand']).toContain('Orbitron')
  })

  it('drops the same durations for reduced motion as tokens.css', () => {
    expect(tokensCss).toMatch(
      /prefers-reduced-motion: reduce\)\s*{\s*:root\s*{\s*--dur-2: 1ms;\s*--dur-morph: 1ms;/,
    )
  })
})

describe('the CSS variables resolver', () => {
  const resolved = mediaManagerCssVariablesResolver(mediaManagerTheme as never)

  it('puts every semantic token in both schemes', () => {
    expect(Object.keys(resolved.dark)).toEqual(
      expect.arrayContaining(Object.keys(darkTokens)),
    )
    expect(Object.keys(resolved.light)).toEqual(
      expect.arrayContaining(Object.keys(lightTokens)),
    )
  })

  it('puts the scheme-independent tokens on :root', () => {
    expect(resolved.variables).toMatchObject(sharedTokens)
  })

  it('points Mantine body, text and primary fills at the tokens', () => {
    for (const scheme of [resolved.dark, resolved.light]) {
      expect(scheme).toMatchObject({
        '--mantine-color-body': 'var(--surface-app)',
        '--mantine-color-text': 'var(--text-1)',
        '--mantine-color-neon-filled': 'var(--accent)',
        '--mantine-primary-color-contrast': 'var(--text-on-accent)',
        '--mantine-color-red-filled': 'var(--danger-fill)',
      })
    }
  })
})

describe('the Mantine theme', () => {
  it('follows design-system §8', () => {
    expect(mediaManagerTheme.primaryColor).toBe('neon')
    expect(mediaManagerTheme.primaryShade).toEqual({ light: 7, dark: 4 })
    expect(mediaManagerTheme.colors?.dark).toEqual([
      '#b3b3b3',
      '#8f8f8f',
      '#666666',
      '#333333',
      '#222222',
      '#1c1c1c',
      '#141414',
      '#101010',
      '#0d0d0d',
      '#080808',
    ])
    expect(mediaManagerTheme.colors?.neon?.[4]).toBe('#00e5ff')
    expect(mediaManagerTheme.colors?.neon?.[7]).toBe('#008a9e')
    expect(mediaManagerTheme.defaultRadius).toBe('sm')
  })
})
