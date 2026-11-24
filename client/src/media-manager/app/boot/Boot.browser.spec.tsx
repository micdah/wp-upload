import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import {
  bootstrapOk,
  bootstrapPluginOutdated,
  bootstrapWpAuthFailed,
  bootstrapWpUnreachable,
} from '../../../../../shared/fixtures/bootstrap'
import { coreStore } from '../../core/state'
import { mockNetwork } from '../../test/msw'
import { renderWithProviders } from '../../test/renderWithProviders'
import { Boot } from './Boot'

// What the shell's first render sees: everything in it reads the bootstrap
// from the core store (commands' available(), FileBird, permissions).
const firstRenders: (string | null)[] = []

vi.mock('../../shell/Shell', () => ({
  Shell: () => {
    firstRenders.push(coreStore.getState().bootstrap?.rev ?? null)
    return <div>Shell</div>
  },
}))

describe('Boot', () => {
  it('puts the bootstrap into the core store before the shell first renders (C-15)', async () => {
    mockNetwork.use(
      http.get('*/api/library/bootstrap', () => HttpResponse.json(bootstrapOk)),
    )
    renderWithProviders(<Boot />)
    expect(await screen.findByText('Shell')).toBeTruthy()
    expect(firstRenders[0]).toBe(bootstrapOk.rev)
  })

  // The rare-state screens are a lazy chunk (bundle budget); they must still
  // render in place of the shell.
  it.each([
    [
      'WordPress unreachable',
      bootstrapWpUnreachable,
      /WordPress is unreachable/i,
    ],
    [
      'app password rejected',
      bootstrapWpAuthFailed,
      /rejected the app password/i,
    ],
    [
      'plugin outdated',
      bootstrapPluginOutdated,
      /update the companion plugin/i,
    ],
  ])('loads the %s screen lazily', async (_name, bootstrap, heading) => {
    mockNetwork.use(
      http.get('*/api/library/bootstrap', () => HttpResponse.json(bootstrap)),
    )
    renderWithProviders(<Boot />)
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
    expect(screen.queryByText('Shell')).toBeNull()
  })
})
