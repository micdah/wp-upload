import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import {
  blocksSelectionAt,
  installSelectionGuard,
  noSelectProps,
} from './noSelect'

// The selection guard in Chromium, with real pointer input (Playwright, not
// synthetic events), so the browser itself selects a word on a double-click
// and dispatches `selectstart` first. The guard must stop that over the
// chrome without `user-select: none`, which cut the iPad off from its
// keyboard (mm/m2-keys).

let uninstall: () => void = () => {}

beforeEach(() => {
  uninstall = installSelectionGuard()
})

afterEach(() => {
  uninstall()
  cleanup()
  window.getSelection()?.removeAllRanges()
})

function selectedText(): string {
  return window.getSelection()?.toString() ?? ''
}

function Page() {
  return (
    <>
      <header {...noSelectProps}>
        <span>Chrome words here</span>
        <input aria-label='Field' defaultValue='typed words' />
        <span data-mm-selectable=''>Copyable words</span>
      </header>
      <p>Content words here</p>
    </>
  )
}

describe('the selection guard', () => {
  it('keeps the chrome selectable as far as CSS goes', () => {
    render(<Page />)
    const chrome = screen.getByText('Chrome words here')
    expect(getComputedStyle(chrome).userSelect).not.toBe('none')
    expect(
      getComputedStyle(chrome).getPropertyValue('-webkit-user-select'),
    ).not.toBe('none')
  })

  it('cancels the word selection of a double-click over the chrome', async () => {
    render(<Page />)
    await userEvent.dblClick(screen.getByText('Chrome words here'))
    expect(selectedText()).toBe('')
  })

  it('leaves selection alone outside the chrome', async () => {
    render(<Page />)
    await userEvent.dblClick(screen.getByText('Content words here'))
    expect(selectedText()).not.toBe('')
  })

  it('lets fields and [data-mm-selectable] text inside the chrome select', async () => {
    render(<Page />)
    const field = screen.getByLabelText('Field') as HTMLInputElement
    await userEvent.dblClick(field)
    expect(field.selectionEnd ?? 0).toBeGreaterThan(field.selectionStart ?? 0)
    await userEvent.dblClick(screen.getByText('Copyable words'))
    expect(selectedText()).not.toBe('')
  })

  it('decides by the nearest region, for elements and text nodes', () => {
    render(<Page />)
    const chrome = screen.getByText('Chrome words here')
    expect(blocksSelectionAt(chrome)).toBe(true)
    expect(blocksSelectionAt(chrome.firstChild)).toBe(true)
    expect(blocksSelectionAt(screen.getByLabelText('Field'))).toBe(false)
    expect(blocksSelectionAt(screen.getByText('Content words here'))).toBe(
      false,
    )
    expect(blocksSelectionAt(null)).toBe(false)
  })
})
