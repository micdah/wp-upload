import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  altGrCharacters,
  isShortcutSafeKey,
  isTypableOnAllLayouts,
  modStroke,
  SHORTCUT_PUNCTUATION,
  shortcutKeyMatrix,
  strokeOn,
  strokesFor,
} from './keyboard'
import {
  isAppApiRequest,
  mockNetwork,
  recordUnhandledRequest,
  takeUnhandledApiRequests,
} from './msw'

// Example tests of the `unit` project (Node): the keyboard helpers, and MSW
// through the shared mockNetwork facade.

describe('keyboard helpers', () => {
  it('type + as Shift+= on US and as its own key on DK', () => {
    const [us, dk] = strokesFor('+')
    expect(us).toMatchObject({ layout: 'us', code: 'Equal', shiftKey: true })
    expect(dk).toMatchObject({ layout: 'dk', code: 'Minus', shiftKey: false })
  })

  it('type ? with Shift on both layouts, on different keys', () => {
    expect(strokeOn('us', '?')).toMatchObject({ code: 'Slash', shiftKey: true })
    expect(strokeOn('dk', '?')).toMatchObject({ code: 'Minus', shiftKey: true })
  })

  it('report a DK AltGr character both ways AltGr is reported', () => {
    const strokes = strokesFor('[', { layouts: ['dk'] })
    expect(strokes).toHaveLength(2)
    const [windows, linux] = strokes
    expect(windows).toMatchObject({
      ctrlKey: true,
      altKey: true,
      altGraph: true,
    })
    expect(linux).toMatchObject({
      ctrlKey: false,
      altKey: false,
      altGraph: true,
    })
    expect(linux?.getModifierState('AltGraph')).toBe(true)
  })

  it('allow exactly letters, digits, named keys and , . - + ? as shortcuts', () => {
    for (const { key, strokes } of shortcutKeyMatrix()) {
      expect(isTypableOnAllLayouts(key), key).toBe(true)
      expect(strokes.map((stroke) => stroke.layout)).toEqual(['us', 'dk'])
    }
    expect(SHORTCUT_PUNCTUATION).toEqual([',', '.', '-', '+', '?'])
    // AltGr or dead keys on DK.
    for (const key of ['[', ']', '\\', '`', '@', '$', '{', '}', '|', '~']) {
      expect(isTypableOnAllLayouts(key), key).toBe(false)
    }
    expect(isTypableOnAllLayouts('Escape')).toBe(true)
    // `/` is typable on both, but the policy leaves it out.
    expect(isTypableOnAllLayouts('/')).toBe(true)
    for (const key of ['/', '=', ';', "'", ':', '*']) {
      expect(isShortcutSafeKey(key), key).toBe(false)
    }
    expect(isShortcutSafeKey('+')).toBe(true)
    expect(isShortcutSafeKey('K')).toBe(true)
    expect(isShortcutSafeKey('ArrowLeft')).toBe(true)
    expect(isShortcutSafeKey('å')).toBe(false)
  })

  it('list the AltGr characters a keymap must reject', () => {
    expect(altGrCharacters()).toEqual(
      expect.arrayContaining(['@', '$', '{', '[', ']', '}', '|', '\\', '~']),
    )
  })

  it('build Mod+letter for both platforms', () => {
    expect(modStroke('k')).toMatchObject({
      key: 'k',
      ctrlKey: true,
      metaKey: false,
    })
    expect(modStroke('k', 'mac')).toMatchObject({
      key: 'k',
      ctrlKey: false,
      metaKey: true,
    })
  })
})

describe('MSW in Node', () => {
  it('answers fetch with the test’s handler', async () => {
    mockNetwork.use(
      http.get('*/api/library/rev', () => HttpResponse.json({ rev: 'r1' })),
    )
    const response = await fetch('http://localhost/wp-upload/api/library/rev')
    expect(await response.json()).toEqual({ rev: 'r1' })
  })

  it('drops the handlers of the previous test', () => {
    expect(mockNetwork.listHandlers()).toHaveLength(0)
  })

  it('records unanswered API requests, and only those', () => {
    recordUnhandledRequest(
      new Request('http://localhost/api/library/facets?folder=3'),
    )
    recordUnhandledRequest(new Request('http://localhost/wp-upload/session'))
    recordUnhandledRequest(new Request('http://localhost/assets/font.woff2'))
    expect(takeUnhandledApiRequests()).toEqual([
      'GET /api/library/facets?folder=3',
      'GET /wp-upload/session',
    ])
    expect(isAppApiRequest(new URL('http://localhost/src/api.ts'))).toBe(false)
  })
})
