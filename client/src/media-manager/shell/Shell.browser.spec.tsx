import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { coreStore } from '../core/state'
import { cleanupLibrary, renderLibrary } from '../test/renderLibrary'

// The shell with the whole app wired together (M2 glue 11): F3's theme and
// layout tokens, the colour-scheme key, the one rev poll, and the panels.

afterEach(cleanupLibrary)

describe('the shell', () => {
  it('lays out with the theme tokens and the media in the centre', async () => {
    await renderLibrary()
    const app = document.querySelector<HTMLElement>('[data-mm-app]')
    expect(app).not.toBeNull()
    const toolbar = screen.getByRole('banner')
    // --toolbar-h from F3's tokens (48 px).
    expect(toolbar.getBoundingClientRect().height).toBe(48)
    expect(screen.getByRole('main', { name: 'Media' })).toBeTruthy()
    expect(screen.getByRole('grid', { name: 'Media' })).toBeTruthy()
  })

  it('polls the rev once it is mounted', async () => {
    const polled: string[] = []
    await renderLibrary({
      handlers: [
        http.get('*/api/library/rev', ({ request }) => {
          polled.push(request.url)
          return undefined
        }),
      ],
    })
    await waitFor(() => expect(polled.length).toBeGreaterThan(0))
  })

  it('remembers a picked colour scheme under wpu-mm-color-scheme', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const toggle = screen.getByRole('button', { name: /theme/i })
    await user.click(toggle)
    expect(localStorage.getItem('wpu-mm-color-scheme')).toMatch(/light|dark/)
  })

  it('toggles the inspector with I, the persisted panel state', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const before = coreStore.getState().panels.inspectorOpen
    await user.click(screen.getAllByRole('gridcell')[0] as HTMLElement)
    await user.keyboard('i')
    expect(coreStore.getState().panels.inspectorOpen).toBe(!before)
  })
})
