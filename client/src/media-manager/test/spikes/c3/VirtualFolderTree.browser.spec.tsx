import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { act } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Folder } from '../../../../../../shared/library-api'
import { renderWithProviders } from '../../renderWithProviders'
import { frames, startDrag } from './dragDriver'
import { applyFolderMove, type FolderMove } from './folderTree'
import { sampleFolders, seedFolders } from './seedFolders'
import { MEDIA_DRAG_TYPE, VirtualFolderTree } from './VirtualFolderTree'

// Spike C3 in Chromium: the virtual ARIA folder tree with Pragmatic drag and
// drop. Checks nest vs reorder hitboxes, the cycle block, the live in-page
// preview, auto-expand, auto-scroll, media drops and a drag whose source row
// is virtualised away; measures render and drag cost. Numbers are logged for
// docs/media-manager/tracks/spikes/C3.md, and timings are asserted only
// against generous ceilings.

interface HarnessProps {
  initial: Folder[]
  expandedIds?: number[]
  height?: number
  pinDraggedRow?: boolean
  onMove?: (id: number, move: FolderMove) => void
  onAssign?: (folderId: number, ids: number[]) => void
}

/** The tree with its state owned like the folder column would own it. */
function Harness({
  initial,
  expandedIds = [],
  height = 300,
  pinDraggedRow,
  onMove,
  onAssign,
}: HarnessProps) {
  const [folders, setFolders] = useState(initial)
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(expandedIds),
  )
  return (
    <div style={{ width: 280 }}>
      <VirtualFolderTree
        folders={folders}
        expanded={expanded}
        onExpandedChange={setExpanded}
        height={height}
        pinDraggedRow={pinDraggedRow}
        onMoveFolder={(id, move) => {
          onMove?.(id, move)
          setFolders((current) => applyFolderMove(current, id, move))
        }}
        onAssignMedia={onAssign}
      />
      <MediaTile />
    </div>
  )
}

/** Stands in for a grid tile (track A1 registers the real draggables). */
function MediaTile() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    return draggable({
      element,
      getInitialData: () => ({ type: MEDIA_DRAG_TYPE, ids: [101, 102] }),
    })
  }, [])
  return (
    <div ref={ref} data-testid='media-tile' style={{ height: 40 }}>
      2 photos
    </div>
  )
}

function row(id: number): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-folder-id="${id}"]`,
  )
  if (!element) throw new Error(`row ${id} isn't rendered`)
  return element
}

function names(): string[] {
  return [...document.querySelectorAll('[role="treeitem"]')]
    .sort(
      (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
    )
    .map(
      (element) =>
        element.querySelector('span:nth-child(2)')?.textContent ?? '',
    )
}

async function longTasksDuring(run: () => Promise<void>): Promise<number[]> {
  const durations: number[] = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) durations.push(entry.duration)
  })
  observer.observe({ type: 'longtask', buffered: false })
  await run()
  await frames(2)
  for (const entry of observer.takeRecords()) durations.push(entry.duration)
  observer.disconnect()
  return durations
}

// Sample tree: Brand (1) [Logos (4) [Old (7)], Colours (5)], Events (2)
// [2026 (6)], Archive (3).

describe('spike C3: the virtual ARIA tree', () => {
  it('renders a flat tree with level, position and expanded state', async () => {
    renderWithProviders(<Harness initial={sampleFolders()} expandedIds={[1]} />)
    await act(() => frames(1))
    expect(document.querySelector('[role="tree"]')).not.toBeNull()
    expect(names()).toEqual(['Brand', 'Logos', 'Colours', 'Events', 'Archive'])
    expect(row(1).getAttribute('aria-expanded')).toBe('true')
    expect(row(2).getAttribute('aria-expanded')).toBe('false')
    expect(row(3).getAttribute('aria-expanded')).toBeNull()
    expect(row(4).getAttribute('aria-level')).toBe('2')
    expect(row(5).getAttribute('aria-posinset')).toBe('2')
    expect(row(5).getAttribute('aria-setsize')).toBe('2')
    expect([
      ...document.querySelectorAll('[role="treeitem"][tabindex="0"]'),
    ]).toHaveLength(1)
  })

  it('moves focus and expands with the arrow keys', async () => {
    renderWithProviders(<Harness initial={sampleFolders()} />)
    await act(() => frames(1))
    act(() => row(1).focus())
    await act(async () => {
      row(1).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      )
      await frames(1)
    })
    expect(row(1).getAttribute('aria-expanded')).toBe('true')
    await act(async () => {
      row(1).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
      await frames(1)
    })
    expect(document.activeElement).toBe(row(4))
  })
})

describe('spike C3: Pragmatic drag and drop on the tree', () => {
  it('nests in the middle of a row and reorders at its edges', async () => {
    renderWithProviders(<Harness initial={sampleFolders()} />)
    await act(() => frames(1))
    const drag = await act(() => startDrag(row(3)))
    await act(() => drag.over(row(1), 'top'))
    expect(row(1).dataset.drop).toBe('reorder-before')
    expect(document.querySelector('[data-testid="drop-line"]')).not.toBeNull()
    await act(() => drag.over(row(1), 'middle'))
    expect(row(1).dataset.drop).toBe('combine')
    expect(document.querySelector('[data-testid="drop-line"]')).toBeNull()
    await act(() => drag.over(row(1), 'bottom'))
    expect(row(1).dataset.drop).toBe('reorder-after')
    await act(() => drag.cancel())
    expect(row(1).dataset.drop).toBeUndefined()
  })

  it('treats the bottom edge of an open folder as "inside"', async () => {
    renderWithProviders(<Harness initial={sampleFolders()} expandedIds={[1]} />)
    await act(() => frames(1))
    const drag = await act(() => startDrag(row(3)))
    await act(() => drag.over(row(1), 'bottom'))
    expect(row(1).dataset.drop).toBe('combine')
    await act(() => drag.cancel())
  })

  it('blocks a drop into the dragged folder’s own subtree', async () => {
    const onMove = vi.fn()
    renderWithProviders(
      <Harness
        initial={sampleFolders()}
        expandedIds={[1, 4]}
        onMove={onMove}
      />,
    )
    await act(() => frames(1))
    const drag = await act(() => startDrag(row(1)))
    await act(() => drag.over(row(7), 'middle'))
    expect(row(7).dataset.dropBlocked).toBe('true')
    const preview = document.querySelector(
      '[data-testid="folder-drag-preview"]',
    )
    expect(preview?.textContent).toContain('own subfolder')
    expect(preview?.getAttribute('data-valid')).toBe('false')
    await act(() => drag.drop())
    expect(onMove).not.toHaveBeenCalled()
  })

  it('shows a live in-page preview that follows the pointer', async () => {
    renderWithProviders(<Harness initial={sampleFolders()} />)
    await act(() => frames(1))
    const drag = await act(() => startDrag(row(3)))
    await act(() => drag.over(row(2), 'middle'))
    const preview = document.querySelector<HTMLElement>(
      '[data-testid="folder-drag-preview"]',
    )
    expect(preview?.textContent).toContain('Archive')
    expect(preview?.textContent).toContain('Move into “Events”')
    const first = preview?.style.transform
    await act(() => drag.over(row(1), 'top'))
    expect(preview?.textContent).toContain('Move before “Brand”')
    expect(preview?.style.transform).not.toBe(first)
    await act(() => drag.cancel())
    expect(
      document.querySelector('[data-testid="folder-drag-preview"]'),
    ).toBeNull()
  })

  it('moves the folder on drop, as the API’s parent and position', async () => {
    const onMove = vi.fn()
    renderWithProviders(<Harness initial={sampleFolders()} onMove={onMove} />)
    await act(() => frames(1))
    const nest = await act(() => startDrag(row(3)))
    await act(() => nest.over(row(2), 'middle'))
    await act(() => nest.drop())
    expect(onMove).toHaveBeenLastCalledWith(3, { parent: 2, position: 1 })

    const reorder = await act(() => startDrag(row(2)))
    await act(() => reorder.over(row(1), 'top'))
    await act(() => reorder.drop())
    expect(onMove).toHaveBeenLastCalledWith(2, { parent: 0, position: 0 })
    expect(names()).toEqual(['Events', 'Brand'])
  })

  it('auto-expands a closed folder after a hover', async () => {
    renderWithProviders(<Harness initial={sampleFolders()} />)
    await act(() => frames(1))
    const drag = await act(() => startDrag(row(3)))
    await act(() => drag.over(row(1), 'middle'))
    await act(() => drag.hold(300))
    expect(row(1).getAttribute('aria-expanded')).toBe('false')
    await act(() => drag.hold(600))
    expect(row(1).getAttribute('aria-expanded')).toBe('true')
    expect(names()).toContain('Logos')
    await act(() => drag.cancel())
  })

  it('assigns media dropped on a row', async () => {
    const onAssign = vi.fn()
    const { getByTestId } = renderWithProviders(
      <Harness initial={sampleFolders()} onAssign={onAssign} />,
    )
    await act(() => frames(1))
    const drag = await act(() => startDrag(getByTestId('media-tile')))
    // Media only ever means "into": even a row's top edge is "inside".
    await act(() => drag.over(row(2), 'top'))
    expect(row(2).dataset.drop).toBe('combine')
    await act(() => drag.drop())
    expect(onAssign).toHaveBeenCalledWith(2, [101, 102])
  })

  it('auto-scrolls the tree near its bottom edge', async () => {
    const folders = seedFolders(300)
    renderWithProviders(<Harness initial={folders} height={300} />)
    await act(() => frames(1))
    const tree = document.querySelector<HTMLElement>('[role="tree"]')
    if (!tree) throw new Error('no tree')
    const firstRow = document.querySelector<HTMLElement>('[role="treeitem"]')
    if (!firstRow) throw new Error('no rows')
    const drag = await act(() => startDrag(firstRow))
    const rect = tree.getBoundingClientRect()
    const nearBottom = [
      ...document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    ]
      .filter(
        (element) => element.getBoundingClientRect().bottom <= rect.bottom,
      )
      .at(-1)
    if (!nearBottom) throw new Error('no row near the bottom')
    await act(() =>
      drag.over(nearBottom, { x: rect.left + 40, y: rect.bottom - 4 }),
    )
    await act(() => drag.hold(1000))
    const scrolled = tree.scrollTop
    console.log(`[C3] auto-scroll: ${scrolled.toFixed(0)} px in 1 s`)
    expect(scrolled).toBeGreaterThan(30)
    await act(() => drag.cancel())
  })

  it.each([
    [true, 'pinned'],
    [false, 'not pinned'],
  ])(
    'keeps a drag alive when the source row scrolls away (%s, %s)',
    async (pinDraggedRow) => {
      const onMove = vi.fn()
      const folders = seedFolders(300)
      renderWithProviders(
        <Harness
          initial={folders}
          height={300}
          pinDraggedRow={pinDraggedRow}
          onMove={onMove}
        />,
      )
      await act(() => frames(1))
      const tree = document.querySelector<HTMLElement>('[role="tree"]')
      // Not the first row: that one is the Tab stop, which is always pinned.
      const source =
        document.querySelectorAll<HTMLElement>('[role="treeitem"]')[1]
      if (!tree || !source) throw new Error('no tree')
      const sourceId = Number(source.dataset.folderId)
      const drag = await act(() => startDrag(source))
      await act(async () => {
        tree.scrollTop = tree.scrollHeight
        tree.dispatchEvent(new Event('scroll'))
        await frames(3)
      })
      expect(source.isConnected).toBe(pinDraggedRow)
      const target = [
        ...document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
      ]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          const box = tree.getBoundingClientRect()
          return rect.top >= box.top && rect.bottom <= box.bottom
        })
        .find((element) => Number(element.dataset.folderId) !== sourceId)
      if (!target) throw new Error('no visible target')
      await act(() => drag.over(target, 'middle'))
      await act(() => drag.drop())
      expect(onMove).toHaveBeenCalledTimes(1)
      expect(onMove.mock.calls[0]?.[1]).toMatchObject({
        parent: Number(target.dataset.folderId),
      })
    },
  )
})

describe('spike C3: cost', () => {
  it.each([300, 5000])(
    'renders %i folders, all expanded, quickly',
    async (count) => {
      const folders = seedFolders(count)
      const ids = folders.map((folder) => folder.id)
      const start = performance.now()
      renderWithProviders(
        <Harness initial={folders} expandedIds={ids} height={600} />,
      )
      const ms = performance.now() - start
      await act(() => frames(1))
      const mounted = document.querySelectorAll('[role="treeitem"]').length
      console.log(
        `[C3] render ${count} folders (all expanded): ${ms.toFixed(1)} ms, ${mounted} rows mounted`,
      )
      expect(mounted).toBeLessThan(60)
      expect(ms).toBeLessThan(count === 300 ? 200 : 400)
    },
  )

  it('drags over 200 rows without long tasks', async () => {
    const folders = seedFolders(5000)
    const ids = folders.map((folder) => folder.id)
    renderWithProviders(
      <Harness initial={folders} expandedIds={ids} height={600} />,
    )
    await act(() => frames(1))
    const tree = document.querySelector<HTMLElement>('[role="tree"]')
    const source = document.querySelector<HTMLElement>('[role="treeitem"]')
    if (!tree || !source) throw new Error('no tree')
    const drag = await act(() => startDrag(source))
    const frameTimes: number[] = []
    const longTasks = await longTasksDuring(async () => {
      for (let step = 0; step < 200; step++) {
        // Scroll a row per step and hover the row under a fixed point, so
        // targets change every frame, as in a fast drag through the tree.
        const started = performance.now()
        await act(async () => {
          tree.scrollTop = step * 30
          tree.dispatchEvent(new Event('scroll'))
          const box = tree.getBoundingClientRect()
          const point = {
            x: box.left + 60,
            y: box.top + 100 + ((step * 7) % 400),
          }
          const target = document
            .elementsFromPoint(point.x, point.y)
            .find((element) => element.getAttribute('role') === 'treeitem')
          if (target) await drag.over(target, point)
        })
        frameTimes.push(performance.now() - started)
      }
    })
    await act(() => drag.cancel())
    frameTimes.sort((a, b) => a - b)
    const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)] ?? 0
    console.log(
      `[C3] drag over 200 rows of 5k: step p95 ${p95.toFixed(1)} ms (2 frames per step); long tasks ${longTasks.length} (max ${Math.max(0, ...longTasks).toFixed(0)} ms)`,
    )
    expect(Math.max(0, ...longTasks)).toBeLessThan(200)
  })
})
