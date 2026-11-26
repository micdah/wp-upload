import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../test/renderWithProviders'
import {
  answerPendingConfirm,
  ConfirmHost,
  confirm,
  pendingConfirm,
} from './confirm'

// The dialog is a lazy chunk (the initial chunk's budget, D31): <ConfirmHost/>
// still shows it, and its buttons answer.

afterEach(() => {
  while (pendingConfirm()) {
    act(() => answerPendingConfirm(false))
  }
})

describe('<ConfirmHost/>', () => {
  it('shows the lazy dialog and resolves with the button pressed', async () => {
    renderWithProviders(<ConfirmHost />)
    let answer: Promise<boolean> = Promise.resolve(false)
    act(() => {
      answer = confirm({
        title: 'Delete 3 items?',
        body: 'They go to the Trash.',
        confirmLabel: 'Delete',
        tone: 'danger',
      })
    })
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete 3 items?',
    })
    expect(dialog.textContent).toContain('They go to the Trash.')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await expect(answer).resolves.toBe(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
