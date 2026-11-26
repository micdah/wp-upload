import { Notifications, notifications } from '@mantine/notifications'
import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../test/renderWithProviders'
import { canUndo, toast, undoLast } from './toast'

// Against Mantine's real notifications store and <Notifications/>: Mantine
// 9.8's show() ignores an id that is already shown, so replacing a toast
// must go through update().

afterEach(() => {
  act(() => {
    notifications.clean()
  })
})

describe('toast() with Mantine', () => {
  it('replaces a shown toast that reuses its id (progress updates)', async () => {
    renderWithProviders(<Notifications />)
    act(() => {
      toast({ id: 'progress', message: 'Moving 1 of 3', autoClose: false })
    })
    expect(await screen.findByText('Moving 1 of 3')).toBeTruthy()
    act(() => {
      toast({ id: 'progress', message: 'Moving 2 of 3', autoClose: false })
    })
    expect(await screen.findByText('Moving 2 of 3')).toBeTruthy()
    await waitFor(() => {
      expect(screen.queryByText('Moving 1 of 3')).toBeNull()
    })
  })

  it('names the close button (axe button-name)', async () => {
    renderWithProviders(<Notifications />)
    act(() => {
      toast({ message: 'Saved', autoClose: false })
    })
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })

  it('replaces an undo toast, and its Undo runs the new change', async () => {
    renderWithProviders(<Notifications />)
    const undone: string[] = []
    act(() => {
      toast({
        id: 'meta',
        message: 'Alt text saved',
        undo: { run: () => undone.push('first') },
      })
    })
    expect(await screen.findByText('Alt text saved')).toBeTruthy()
    act(() => {
      toast({
        id: 'meta',
        message: 'Title saved',
        undo: { run: () => undone.push('second') },
      })
    })
    expect(await screen.findByText('Title saved')).toBeTruthy()
    expect(screen.queryByText('Alt text saved')).toBeNull()
    await act(async () => {
      await undoLast()
    })
    expect(undone).toEqual(['second'])
    expect(canUndo()).toBe(false)
  })

  it('replacing an undo toast with a plain one drops its Undo', async () => {
    renderWithProviders(<Notifications />)
    act(() => {
      toast({ id: 'job', message: 'Moved', undo: { run: () => {} } })
    })
    expect(await screen.findByText('Moved')).toBeTruthy()
    expect(canUndo()).toBe(true)
    act(() => {
      toast({ id: 'job', message: 'Move finished elsewhere' })
    })
    expect(await screen.findByText('Move finished elsewhere')).toBeTruthy()
    expect(canUndo()).toBe(false)
  })
})
