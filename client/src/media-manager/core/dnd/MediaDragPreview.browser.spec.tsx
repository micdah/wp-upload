import { act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../test/renderWithProviders'
import { MediaDragPreview } from './MediaDragPreview'
import { mediaDragStore, setMediaDropTarget } from './mediaDrag'

// The media drag preview (folders.md §6, A3 CR-3).

afterEach(() => {
  act(() => mediaDragStore.setState({ active: null }))
})

function preview(): HTMLElement | null {
  return document.querySelector('[data-mm-drag-preview]')
}

describe('<MediaDragPreview/>', () => {
  it('stacks up to three thumbnails and says where the drop goes', () => {
    renderWithProviders(<MediaDragPreview />)
    expect(preview()).toBeNull()

    act(() =>
      mediaDragStore.setState({
        active: { ids: [4, 5, 6, 7], sourceId: 5, x: 10, y: 20, target: null },
      }),
    )
    const element = preview() as HTMLElement
    expect(element.textContent).toContain('Move 4 items')
    expect(element.textContent).toContain('Drop on a folder')
    expect(element.querySelectorAll('[data-depth]')).toHaveLength(3)
    expect(element.hasAttribute('data-valid')).toBe(false)

    act(() => setMediaDropTarget({ label: '“Press kit”' }))
    expect(element.textContent).toContain('to “Press kit”')
    expect(element.getAttribute('data-valid')).toBe('true')

    act(() =>
      setMediaDropTarget({ label: '', refusal: 'All files isn’t a folder' }),
    )
    expect(element.textContent).toContain('All files isn’t a folder')
    expect(element.getAttribute('data-valid')).toBe('false')

    act(() => mediaDragStore.setState({ active: null }))
    expect(preview()).toBeNull()
  })
})
