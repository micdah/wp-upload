// Drives Pragmatic drag and drop with synthetic native drag events, for
// browser tests (spike C3; A3 can reuse it for the folder column).
//
// Pragmatic listens on `window` for dragstart / dragenter / dragover / drop /
// dragend and reads `event.target`, `clientX/Y` and `dataTransfer`, so
// dispatching DragEvents on the right elements reproduces a real drag
// deterministically, including hovering in place (which Playwright's real
// mouse can't: Chromium only sends dragover while the mouse moves).
//
// Pragmatic calls onDragStart on the frame after dragstart and batches onDrag
// per animation frame, so every step waits a frame.
//
//   const drag = await startDrag(rowElement)
//   await drag.over(targetElement, 'middle')
//   await drag.drop()

export type Spot = 'top' | 'middle' | 'bottom' | { x: number; y: number }

export function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

export async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await nextFrame()
}

/** A point inside the element: 2 px from its top or bottom edge, or the centre. */
export function pointIn(
  element: Element,
  spot: Spot,
): { x: number; y: number } {
  if (typeof spot === 'object') return spot
  const rect = element.getBoundingClientRect()
  const x = rect.left + Math.min(40, rect.width / 2)
  if (spot === 'top') return { x, y: rect.top + 2 }
  if (spot === 'bottom') return { x, y: rect.bottom - 2 }
  return { x, y: rect.top + rect.height / 2 }
}

function fire(
  target: Element | Window,
  type: string,
  point: { x: number; y: number },
  dataTransfer: DataTransfer,
): boolean {
  return target.dispatchEvent(
    new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      dataTransfer,
    }),
  )
}

export interface DragSession {
  /** Moves over `target` (dragenter + dragover) and waits a frame. */
  over(target: Element, spot?: Spot): Promise<void>
  /** Repeats dragover at the last point: a pointer resting in place. */
  hold(ms: number): Promise<void>
  /** Drops at the last point and ends the drag. */
  drop(): Promise<void>
  /** Ends the drag without a drop (Escape, or dropping outside). */
  cancel(): Promise<void>
}

/** Starts dragging `source` (a Pragmatic draggable) from its centre. */
export async function startDrag(source: Element): Promise<DragSession> {
  const dataTransfer = new DataTransfer()
  let point = pointIn(source, 'middle')
  let target: Element = source
  fire(source, 'dragstart', point, dataTransfer)
  await frames(2)

  const session: DragSession = {
    async over(element, spot = 'middle') {
      point = pointIn(element, spot)
      target = element
      fire(element, 'dragenter', point, dataTransfer)
      fire(element, 'dragover', point, dataTransfer)
      await frames(2)
    },
    async hold(ms) {
      const end = performance.now() + ms
      while (performance.now() < end) {
        fire(target, 'dragover', point, dataTransfer)
        await nextFrame()
      }
    },
    async drop() {
      fire(target, 'drop', point, dataTransfer)
      // A removed source gets no dragend in a real browser either.
      if (source.isConnected) fire(source, 'dragend', point, dataTransfer)
      await frames(2)
    },
    async cancel() {
      fire(window, 'dragend', point, dataTransfer)
      await frames(2)
    },
  }
  return session
}
