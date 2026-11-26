import { focusManager } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { RequestHandler } from 'msw'
import MediaManagerApp from '../app/MediaManagerApp'
import { coreStore } from '../core/state'
import { createUrlStore } from '../core/url/history'
import {
  createMemoryHistory,
  type MemoryHistory,
} from '../core/url/memoryHistory'
import { setUrlStoreForTesting } from '../core/url/useUrlState'
import type { MockContext } from '../mocks/context'
import type { MockSettings } from '../mocks/scenarios'
import { startFakeLibrary, stopFakeLibrary } from './fakeLibrary'
import { mockNetwork } from './msw'

// The whole media manager (providers, session, boot, shell, features) over
// the mock backend, with the URL in an in-memory history. For browser specs
// of app-level behaviour: keys go through the real keymap, clicks through
// the real grid.
//
//   afterEach(cleanupLibrary)
//   const { mock, history } = await renderLibrary({ search: '?view=library' })
//
// It resolves once the grid shows its first tile (or the boot screen, with
// `waitForGrid: false`).

export interface RenderLibraryOptions {
  /** A `?mock-scenario=` value. Default `normal`. */
  scenario?: string
  settings?: Partial<MockSettings>
  /** The page's query string. Default `?view=library`. */
  search?: string
  /** Wait for the first gridcell. Default true. */
  waitForGrid?: boolean
  /** MSW handlers in front of the fake's (spies, failures). */
  handlers?: RequestHandler[]
}

export interface RenderedLibrary {
  mock: MockContext
  history: MemoryHistory
  /** The URL's query string now. */
  search(): string
}

export async function renderLibrary({
  scenario = 'normal',
  settings = {},
  search = '?view=library',
  waitForGrid = true,
  handlers = [],
}: RenderLibraryOptions = {}): Promise<RenderedLibrary> {
  const mock = startFakeLibrary(scenario, settings)
  if (handlers.length > 0) {
    mockNetwork.use(...handlers)
  }
  const history = createMemoryHistory(`https://example.com/wp-upload/${search}`)
  setUrlStoreForTesting(createUrlStore(history))
  render(<MediaManagerApp />)
  if (waitForGrid) {
    await screen.findAllByRole('gridcell', {}, { timeout: 5000 })
  }
  return {
    mock,
    history,
    search: () => {
      const { searches, index } = history.entries()
      return searches[index] ?? ''
    },
  }
}

/**
 * Makes the app notice a change made elsewhere now, instead of at the next
 * 15 s rev poll: the poll also runs when the window regains focus.
 */
export function pollRevNow(): void {
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
}

/** Drops the fake, the URL store and the app state a test left behind. */
export function cleanupLibrary(): void {
  // Unmount first, so nothing asks the fake for anything once it's gone.
  cleanup()
  stopFakeLibrary()
  setUrlStoreForTesting(null)
  coreStore.getState().resetSelection()
  coreStore.getState().closeOverlay()
  coreStore.getState().setBootstrap(null)
  focusManager.setFocused(undefined)
}
