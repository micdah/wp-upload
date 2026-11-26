import { Button, Menu, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../test/renderWithProviders'
import { type FocusContext, readFocusContext } from './dispatch'

// readFocusContext against real Mantine components in Chromium (M2 glue 11):
// what the dispatcher sees for each kind of focus target. The pure rules are
// covered in Node (dispatcher.spec.ts); this checks the DOM Mantine really
// renders (roles, aria-modal, aria-expanded) still matches them. It replaces
// the C4 harness's context scenarios.

function contextOf(element: Element | null): FocusContext {
  return readFocusContext(element)
}

function only(flags: Partial<FocusContext>): FocusContext {
  return {
    textField: false,
    modal: false,
    popup: false,
    localKeys: false,
    suspended: false,
    control: false,
    ...flags,
  }
}

describe('readFocusContext with Mantine', () => {
  it('reads text fields (input and textarea) as text fields', () => {
    renderWithProviders(
      <>
        <TextInput label='Title' />
        <Textarea label='Alt text' />
      </>,
    )
    expect(contextOf(screen.getByLabelText('Title'))).toEqual(
      only({ textField: true }),
    )
    expect(contextOf(screen.getByLabelText('Alt text'))).toEqual(
      only({ textField: true }),
    )
  })

  it('reads buttons as controls, and gridcells as nothing special', () => {
    renderWithProviders(
      <>
        <Button>Save</Button>
        {/* biome-ignore lint/a11y/useSemanticElements: a grid tile */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: tested as a target only */}
        <div role='gridcell' aria-selected='false'>
          tile
        </div>
      </>,
    )
    expect(contextOf(screen.getByRole('button', { name: 'Save' }))).toEqual(
      only({ control: true }),
    )
    expect(contextOf(screen.getByRole('gridcell'))).toEqual(only({}))
  })

  it('sees an open Modal from anywhere on the page', async () => {
    renderWithProviders(
      <>
        <Button>Outside</Button>
        <Modal opened onClose={() => {}} title='Confirm'>
          <Button>Inside</Button>
        </Modal>
      </>,
    )
    const inside = await screen.findByRole('button', { name: 'Inside' })
    expect(contextOf(inside).modal).toBe(true)
    expect(
      contextOf(screen.getByRole('button', { name: 'Outside', hidden: true }))
        .modal,
    ).toBe(true)
  })

  it('reads an open Menu as a popup, but not its trigger', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Menu>
        <Menu.Target>
          <Button>More</Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item>Copy URL</Menu.Item>
        </Menu.Dropdown>
      </Menu>,
    )
    const trigger = screen.getByRole('button', { name: 'More' })
    await user.click(trigger)
    const item = await screen.findByRole('menuitem', { name: 'Copy URL' })
    expect(contextOf(item).popup).toBe(true)
    // An expanded Menu button doesn't handle Esc itself (spike C4).
    expect(contextOf(trigger).popup).toBe(false)
    expect(contextOf(trigger).control).toBe(true)
  })

  it('reads an expanded Select input as a popup (its own Esc closes it)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Select label='Sort' data={['Newest', 'Oldest']} />)
    // The label names the input and its listbox; the input is the one we want.
    const input = screen
      .getAllByLabelText('Sort')
      .find((element) => element.tagName === 'INPUT') as HTMLInputElement
    await user.click(input)
    await waitFor(() =>
      expect(input.getAttribute('aria-expanded')).toBe('true'),
    )
    expect(contextOf(input)).toMatchObject({ textField: true, popup: true })
  })

  it('reads [data-mm-local-keys], [inert] and a suspended keymap', () => {
    renderWithProviders(
      <>
        <div data-mm-local-keys=''>
          <Button>In the tree</Button>
        </div>
        <div inert>
          <Button>Under detail</Button>
        </div>
      </>,
    )
    expect(
      contextOf(screen.getByRole('button', { name: 'In the tree' })).localKeys,
    ).toBe(true)
    expect(
      contextOf(
        screen.getByRole('button', { name: 'Under detail', hidden: true }),
      ).suspended,
    ).toBe(true)
    document.body.setAttribute('data-mm-keymap-suspended', '')
    try {
      expect(
        contextOf(screen.getByRole('button', { name: 'In the tree' }))
          .suspended,
      ).toBe(true)
    } finally {
      document.body.removeAttribute('data-mm-keymap-suspended')
    }
  })

  it('falls back to the focused element when the target is the body', () => {
    renderWithProviders(<TextInput label='Search' />)
    const input = screen.getByLabelText('Search')
    input.focus()
    expect(contextOf(document.body).textField).toBe(true)
  })
})
