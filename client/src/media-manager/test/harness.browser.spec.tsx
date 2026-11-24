import { Button, Text, useMantineColorScheme } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { COLOR_SCHEME_STORAGE_KEY, MediaManagerThemeProvider } from '../theme'
import { pressKey, strokesFor, userEventKeyboardMap } from './keyboard'
import { mockNetwork } from './msw'
import { renderWithProviders } from './renderWithProviders'

// Example tests of the `browser` project: a component rendered with the app's
// providers, its API answered by MSW's service worker, and keys typed on the
// US and Danish layouts.

function RevLabel() {
  const { data } = useQuery({
    queryKey: ['rev'],
    queryFn: async () => {
      // Relative, as in the app: resolves against the page under any path.
      const response = await fetch('api/library/rev')
      return (await response.json()) as { rev: string }
    },
  })
  return <Text>{data ? `Revision ${data.rev}` : 'Loading'}</Text>
}

function ZoomCounter() {
  const [zoom, setZoom] = useState(0)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a test fixture
    <div
      tabIndex={-1}
      data-testid='zoom'
      onKeyDown={(event) => {
        if (event.key === '+') setZoom((value) => value + 1)
        if (event.key === '-') setZoom((value) => value - 1)
      }}
    >
      Zoom {zoom}
    </div>
  )
}

function SchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  return (
    <Button
      onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
    >
      {colorScheme}
    </Button>
  )
}

describe('the browser test harness', () => {
  it('serves API calls from MSW handlers', async () => {
    mockNetwork.use(
      http.get('*/api/library/rev', () => HttpResponse.json({ rev: 'abc' })),
    )
    const { findByText } = renderWithProviders(<RevLabel />)
    expect(await findByText('Revision abc')).toBeTruthy()
  })

  it('renders in the requested colour scheme', () => {
    renderWithProviders(<Text>Hello</Text>, { colorScheme: 'light' })
    expect(document.documentElement.dataset.mantineColorScheme).toBe('light')
  })

  it('fires a + binding for US and Danish keyboards', () => {
    const { getByTestId } = renderWithProviders(<ZoomCounter />)
    const target = getByTestId('zoom')
    const strokes = strokesFor('+')
    // pressKey dispatches plain DOM events; act() flushes React's updates.
    act(() => {
      for (const stroke of strokes) {
        pressKey(stroke, target)
      }
    })
    expect(target.textContent).toBe(`Zoom ${strokes.length}`)
  })

  it('types with user-event on the Danish layout', async () => {
    const user = userEvent.setup({ keyboardMap: userEventKeyboardMap('dk') })
    const { getByTestId } = renderWithProviders(<ZoomCounter />)
    const target = getByTestId('zoom')
    target.focus()
    await user.keyboard('++-')
    expect(target.textContent).toBe('Zoom 1')
  })

  it('reports AltGr through getModifierState in real events', () => {
    const [, linuxStyle] = strokesFor('@', { layouts: ['dk'] })
    let altGraph = false
    document.body.addEventListener(
      'keydown',
      (event) => {
        altGraph = event.getModifierState('AltGraph')
      },
      { once: true },
    )
    if (!linuxStyle) throw new Error('expected an AltGraph stroke')
    pressKey(linuxStyle, document.body)
    expect(altGraph).toBe(true)
  })

  it('stores the scheme under its own key, not the old page’s', async () => {
    const user = userEvent.setup()
    const { getByRole } = render(
      <MediaManagerThemeProvider defaultColorScheme='dark'>
        <SchemeToggle />
      </MediaManagerThemeProvider>,
    )
    expect(getByRole('button').textContent).toBe('dark')
    await user.click(getByRole('button'))
    expect(getByRole('button').textContent).toBe('light')
    expect(localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)).toBe('light')
    expect(localStorage.getItem('mantine-color-scheme-value')).toBeNull()
  })
})
