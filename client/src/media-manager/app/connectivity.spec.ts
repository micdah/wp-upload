import { describe, expect, it } from 'vitest'
import { createConnectivityStore } from '../core/data/connectivity'
import { LibraryError } from '../core/data/errors'
import { createCoreStore } from '../core/state/store'
import { type BrowserNetwork, installConnectivityMirror } from './runtime'

// M2 glue 3: one connectivity source. The data layer's store decides; the
// core store (what can() and the banners read) mirrors it, plus the
// browser's own online flag.

function fakeNetwork(online = true) {
  const listeners = new Set<() => void>()
  const network: BrowserNetwork & { set(value: boolean): void } = {
    isOnline: () => online,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    set(value) {
      online = value
      for (const listener of listeners) listener()
    },
  }
  return { network, listeners }
}

const unreachable = new LibraryError(502, {
  code: 'wp_unreachable',
  message: 'WordPress did not answer.',
})
const authFailed = new LibraryError(502, {
  code: 'wp_auth_failed',
  message: 'WordPress rejected the app password.',
})

describe('installConnectivityMirror', () => {
  it('mirrors offline and back online from the data layer', () => {
    const data = createConnectivityStore()
    const core = createCoreStore()
    const { network } = fakeNetwork()
    const uninstall = installConnectivityMirror(data, core, network)
    expect(core.getState().connectivity.state).toBe('online')

    data.reportFailure(unreachable, true)
    expect(core.getState().connectivity).toMatchObject({
      state: 'offline',
      reason: 'wp_unreachable',
    })

    data.reportSuccess(true)
    expect(core.getState().connectivity.state).toBe('online')
    uninstall()
  })

  it('treats a rejected app password as offline with its own reason', () => {
    const data = createConnectivityStore()
    const core = createCoreStore()
    const uninstall = installConnectivityMirror(
      data,
      core,
      fakeNetwork().network,
    )
    data.reportFailure(authFailed, true)
    expect(core.getState().connectivity).toMatchObject({
      state: 'offline',
      reason: 'wp_auth_failed',
    })
    uninstall()
  })

  it("follows the browser's online flag, which wins while it is off", () => {
    const data = createConnectivityStore()
    const core = createCoreStore()
    const { network } = fakeNetwork(false)
    const uninstall = installConnectivityMirror(data, core, network)
    expect(core.getState().connectivity.reason).toBe('browser_offline')
    network.set(true)
    expect(core.getState().connectivity.state).toBe('online')
    network.set(false)
    expect(core.getState().connectivity.state).toBe('offline')
    uninstall()
  })

  it('stops listening when uninstalled', () => {
    const data = createConnectivityStore()
    const core = createCoreStore()
    const { network, listeners } = fakeNetwork()
    const uninstall = installConnectivityMirror(data, core, network)
    uninstall()
    expect(listeners.size).toBe(0)
    data.reportFailure(unreachable, true)
    expect(core.getState().connectivity.state).toBe('online')
  })
})
