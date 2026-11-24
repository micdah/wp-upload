import { Button, TextInput } from '@mantine/core'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MediaManagerThemeProvider } from './MediaManagerThemeProvider'

// Renders the theme in real Chromium, in both schemes, and measures what the
// browser actually resolves: the same neutrality and contrast pairs as
// docs/media-manager/design/scripts/token-report.mjs, each against its
// minimum and against the ratio the design system documents (§2), so a
// change that lowers contrast fails here.

type Scheme = 'dark' | 'light'
type Rgb = [number, number, number]

const NEUTRAL_TOKENS = [
  '--surface-stage',
  '--surface-tile',
  '--surface-app',
  '--surface-filmstrip',
]

// [foreground, background, minimum, documented dark, documented light]
const CONTRAST_PAIRS: Array<[string, string, number, number, number]> = [
  ['--text-1', '--surface-panel', 4.5, 16.46, 18.88],
  ['--text-2', '--surface-panel', 4.5, 8.79, 8.86],
  ['--text-3', '--surface-panel', 4.5, 5.7, 5.33],
  ['--text-3', '--surface-app', 4.5, 6.01, 4.85],
  ['--text-3', '--surface-overlay', 4.5, 4.92, 5.33],
  ['--text-accent', '--surface-panel', 4.5, 11.98, 5.47],
  ['--text-on-accent', '--accent', 4.5, 9.94, 8.86],
  // The check glyph on a selected tile is a graphic, so 3:1 applies.
  ['--text-on-select', '--select-ring', 3, 9.94, 4.09],
  ['--text-on-warn', '--warn-fill', 4.5, 11.49, 11.49],
  ['--text-on-danger', '--danger-fill', 4.5, 6.6, 5.5],
  ['--text-on-danger', '--danger-fill-hover', 4.5, 7.91, 7.35],
  ['--text-on-accent', '--accent-hover', 4.5, 11.1, 7.41],
  ['--warn', '--surface-panel', 4.5, 11.46, 4.68],
  ['--danger', '--surface-panel', 4.5, 6.69, 5.5],
  ['--ok', '--surface-panel', 4.5, 10.32, 5.01],
  ['--focus-ring', '--surface-app', 3, 12.63, 3.72],
  ['--focus-ring', '--surface-panel', 3, 11.98, 4.09],
  ['--select-ring', '--surface-tile', 3, 11.08, 3.28],
  ['--line-input', '--surface-input', 3, 3.31, 3.45],
  ['--line-input', '--surface-panel', 3, 3.21, 3.45],
]

// ---- Colour maths (the same as token-report.mjs) ----------------------------------

const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 1
const context = canvas.getContext('2d', {
  willReadFrequently: true,
}) as CanvasRenderingContext2D

/** Paints `colour` over `backdrop` and reads the opaque sRGB result. */
function paint(colour: string, backdrop: string): Rgb {
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = backdrop
  context.fillRect(0, 0, 1, 1)
  context.fillStyle = colour
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return [r ?? 0, g ?? 0, b ?? 0]
}

/** A token resolved by the browser, painted over --surface-app. */
function resolveToken(name: string): Rgb {
  const styles = getComputedStyle(document.documentElement)
  const value = styles.getPropertyValue(name).trim()
  expect(value, `${name} is defined`).not.toBe('')
  return paint(value, styles.getPropertyValue('--surface-app').trim())
}

/** A computed colour of an element, painted over --surface-app. */
function resolveColour(colour: string): Rgb {
  const styles = getComputedStyle(document.documentElement)
  return paint(colour, styles.getPropertyValue('--surface-app').trim())
}

function linear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light as number) + 0.05) / ((dark as number) + 0.05)
}

/** OKLCH chroma (Björn Ottosson's OKLab). */
function chroma([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return Math.hypot(a, bb)
}

// ---- Rendering --------------------------------------------------------------------

function renderTheme(scheme: Scheme) {
  return render(
    <MediaManagerThemeProvider forceColorScheme={scheme}>
      <Button data-testid='primary'>Upload</Button>
      <Button data-testid='default' variant='default'>
        Cancel
      </Button>
      <Button data-testid='danger' color='red'>
        Delete permanently
      </Button>
      <TextInput data-testid='input' label='Title' />
    </MediaManagerThemeProvider>,
  )
}

describe.each(['dark', 'light'] as const)('the %s scheme', (scheme) => {
  it('is applied to the document', () => {
    renderTheme(scheme)
    expect(document.documentElement.dataset.mantineColorScheme).toBe(scheme)
  })

  it.each(NEUTRAL_TOKENS)('keeps %s achromatic', (name) => {
    renderTheme(scheme)
    expect(chroma(resolveToken(name))).toBeLessThanOrEqual(0.01)
  })

  it.each(CONTRAST_PAIRS)(
    '%s on %s meets %d:1 without regressing',
    (foreground, background, minimum, documentedDark, documentedLight) => {
      renderTheme(scheme)
      const ratio = contrast(resolveToken(foreground), resolveToken(background))
      const documented = scheme === 'dark' ? documentedDark : documentedLight
      expect(ratio).toBeGreaterThanOrEqual(minimum)
      expect(ratio).toBeGreaterThanOrEqual(documented - 0.01)
    },
  )

  it('styles Mantine components with the tokens', () => {
    const { getByTestId, getByLabelText } = renderTheme(scheme)
    const primary = getComputedStyle(getByTestId('primary'))
    expect(resolveColour(primary.backgroundColor)).toEqual(
      resolveToken('--accent'),
    )
    expect(resolveColour(primary.color)).toEqual(
      resolveToken('--text-on-accent'),
    )

    const danger = getComputedStyle(getByTestId('danger'))
    expect(resolveColour(danger.backgroundColor)).toEqual(
      resolveToken('--danger-fill'),
    )
    expect(resolveColour(danger.color)).toEqual(
      resolveToken('--text-on-danger'),
    )

    const neutral = getComputedStyle(getByTestId('default'))
    expect(resolveColour(neutral.backgroundColor)).toEqual(
      resolveToken('--surface-raised'),
    )

    const input = getComputedStyle(getByLabelText('Title'))
    expect(resolveColour(input.borderTopColor)).toEqual(
      resolveToken('--line-input'),
    )
    expect(resolveColour(input.backgroundColor)).toEqual(
      resolveToken('--surface-input'),
    )

    const body = getComputedStyle(document.body)
    expect(resolveColour(body.backgroundColor)).toEqual(
      resolveToken('--surface-app'),
    )
    expect(resolveColour(body.color)).toEqual(resolveToken('--text-1'))
  })
})

describe('fonts', () => {
  it('self-hosts Geist and Geist Mono', async () => {
    renderTheme('dark')
    const ui = await document.fonts.load('13px "Geist Variable"')
    const mono = await document.fonts.load('11px "Geist Mono Variable"')
    expect(ui.length).toBeGreaterThan(0)
    expect(mono.length).toBeGreaterThan(0)
    expect(getComputedStyle(document.body).fontFamily).toContain(
      'Geist Variable',
    )
  })
})
