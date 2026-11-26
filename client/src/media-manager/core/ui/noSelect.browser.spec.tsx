import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import {
  blocksSelectionAt,
  installSelectionGuard,
  noSelectProps,
  selectionToDrop,
} from './noSelect'

// The selection guard in Chromium, with real pointer input (Playwright, not
// synthetic events), so the browser itself selects a word on a double-click
// and dispatches `selectstart` first. The guard must stop that over the
// chrome without `user-select: none`, which cut the iPad off from its
// keyboard (mm/m2-keys).
//
// The iPad also selects without `selectstart`: a trackpad drag or a quick
// double-click is a UIKit gesture, and WebKit sets the selection directly
// (mm/m2-select). Those are simulated here with the Selection API, which
// doesn't dispatch `selectstart` either.

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
        {/* biome-ignore lint/a11y/useSemanticElements: a stand-in for a grid tile */}
        <div role='gridcell' aria-selected='false' tabIndex={0}>
          Tile words
        </div>
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

  it('drops a range a gesture sets over the chrome, and keeps focus', async () => {
    render(<Page />)
    const tile = screen.getByRole('gridcell')
    tile.focus()
    const chrome = screen.getByText('Chrome words here')
    window
      .getSelection()
      ?.setBaseAndExtent(
        chrome.firstChild as Node,
        0,
        tile.firstChild as Node,
        4,
      )
    await waitFor(() => expect(selectedText()).toBe(''))
    expect(document.activeElement).toBe(tile)
  })

  it('drops a range that only ends in the chrome', async () => {
    render(<Page />)
    const content = screen.getByText('Content words here')
    const chrome = screen.getByText('Chrome words here')
    window
      .getSelection()
      ?.setBaseAndExtent(
        content.firstChild as Node,
        0,
        chrome.firstChild as Node,
        3,
      )
    await waitFor(() => expect(selectedText()).toBe(''))
  })

  it('keeps ranges outside the chrome, carets, and a focused field', async () => {
    render(<Page />)
    const content = screen.getByText('Content words here')
    const selection = window.getSelection()
    selection?.setBaseAndExtent(
      content.firstChild as Node,
      0,
      content.firstChild as Node,
      7,
    )
    // A later selectionchange would have dropped it by now.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(selectedText()).toBe('Content')

    const chrome = screen.getByText('Chrome words here')
    selection?.collapse(chrome.firstChild as Node, 2)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(selection?.anchorNode).toBe(chrome.firstChild)

    const field = screen.getByLabelText('Field') as HTMLInputElement
    field.focus()
    field.setSelectionRange(0, 5)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(5)
    expect(document.activeElement).toBe(field)
  })

  it('selectionToDrop: no selection, collapsed, or no region means keep', () => {
    render(<Page />)
    expect(selectionToDrop(null)).toBe(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    expect(selectionToDrop(selection)).toBe(false)
    const tile = screen.getByRole('gridcell')
    selection?.setBaseAndExtent(
      tile.firstChild as Node,
      0,
      tile.firstChild as Node,
      4,
    )
    expect(selectionToDrop(selection)).toBe(true)
  })
})
