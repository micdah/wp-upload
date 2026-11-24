// Controls for the running mock, for people (a small scenario switcher in
// the bottom-left corner) and for e2e tests (`window.__wpuMock`):
//
//   __wpuMock.setScenario('author,trash')  // reloads with that scenario
//   __wpuMock.goOffline() / goOnline()     // WordPress unreachable or back
//   __wpuMock.expireSession()              // next library call answers 401
//   __wpuMock.externalEdit(1000, { title: 'Changed elsewhere' })  // new rev
//   __wpuMock.library                       // the fake itself
//
// Plain DOM, no React, so it never depends on the app's providers.

import type { SetupWorker } from 'msw/browser'
import type { MockContext } from './context'
import type { FakeLibrary } from './fake/library'
import { type MockSettings, SCENARIO_IDS } from './scenarios'

export interface MockDevtools {
  settings: MockSettings
  scenarios: readonly string[]
  library: FakeLibrary
  setScenario(ids: string): void
  goOffline(): void
  goOnline(): void
  expireSession(): void
  externalEdit(id: number, patch: { title?: string; alt?: string }): boolean
  worker: SetupWorker
}

declare global {
  interface Window {
    __wpuMock?: MockDevtools
  }
}

function reloadWith(ids: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set('mock-scenario', ids)
  window.location.assign(url.href)
}

function switcher(context: MockContext): HTMLElement {
  const box = document.createElement('div')
  box.setAttribute('data-mock-devtools', '')
  box.style.cssText = [
    'position:fixed',
    'left:8px',
    'bottom:8px',
    'z-index:2147483647',
    'font:12px system-ui,sans-serif',
    'background:rgba(20,20,28,.85)',
    'color:#fff',
    'border-radius:6px',
    'padding:4px 6px',
    'opacity:.6',
  ].join(';')
  box.addEventListener('mouseenter', () => {
    box.style.opacity = '1'
  })
  box.addEventListener('mouseleave', () => {
    box.style.opacity = '.6'
  })
  const label = document.createElement('label')
  label.textContent = 'Mock '
  const select = document.createElement('select')
  select.setAttribute('aria-label', 'Mock scenario')
  select.style.cssText =
    'font:inherit;background:transparent;color:inherit;border:0'
  for (const id of SCENARIO_IDS) {
    const option = document.createElement('option')
    option.value = id
    option.textContent = id
    option.style.color = '#000'
    option.selected = context.settings.scenarios[0] === id
    select.append(option)
  }
  select.addEventListener('change', () => reloadWith(select.value))
  label.append(select)
  box.append(label)
  return box
}

export function installDevtools(
  context: MockContext,
  worker: SetupWorker,
): void {
  window.__wpuMock = {
    settings: context.settings,
    scenarios: SCENARIO_IDS,
    library: context.library,
    setScenario: reloadWith,
    goOffline() {
      context.network = 'offline'
    },
    goOnline() {
      context.network = 'online'
    },
    expireSession() {
      context.session.loggedIn = false
    },
    externalEdit(id, patch) {
      return context.library.externalEdit(id, patch)
    },
    worker,
  }
  const mount = () => document.body.append(switcher(context))
  if (document.body) {
    mount()
  } else {
    window.addEventListener('DOMContentLoaded', mount, { once: true })
  }
}
