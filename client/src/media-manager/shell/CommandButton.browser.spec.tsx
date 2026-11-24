import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  implementCommand,
  resetCommandsForTesting,
} from '../core/commands/registry'
import { renderWithProviders } from '../test/renderWithProviders'
import { CommandIconButton } from './CommandButton'

afterEach(() => {
  resetCommandsForTesting()
})

describe('CommandIconButton (C-16)', () => {
  it('stays focusable when unavailable, shows the reason, and never runs', async () => {
    const run = vi.fn()
    implementCommand('panels.toggle-inspector', {
      available: () => ({ ok: false, code: 'busy', reason: 'Saving first' }),
      run,
    })
    renderWithProviders(
      <CommandIconButton
        command='panels.toggle-inspector'
        label='Inspector'
        icon={<span>i</span>}
      />,
    )
    const button = screen.getByRole('button', { name: 'Inspector' })
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('data-disabled')).toBe(true)

    const user = userEvent.setup()
    await user.tab()
    expect(document.activeElement).toBe(button)
    expect(await screen.findByText('Inspector: Saving first')).toBeTruthy()

    await user.click(button)
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(run).not.toHaveBeenCalled()
  })

  it('a toggle keeps its label and reports its state with aria-pressed', async () => {
    const run = vi.fn()
    implementCommand('panels.toggle-inspector', { run })
    const { rerender } = renderWithProviders(
      <CommandIconButton
        command='panels.toggle-inspector'
        label='Inspector'
        pressed={false}
        icon={<span>i</span>}
      />,
    )
    const button = screen.getByRole('button', { name: 'Inspector' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    await userEvent.setup().click(button)
    expect(run).toHaveBeenCalledTimes(1)
    rerender(
      <CommandIconButton
        command='panels.toggle-inspector'
        label='Inspector'
        pressed
        icon={<span>i</span>}
      />,
    )
    expect(
      screen
        .getByRole('button', { name: 'Inspector' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })
})
