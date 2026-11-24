// The folder column's resizer (interaction-spec §6): drag between 220 and
// 480 px, arrow keys (Shift for bigger steps), Home/End, and a double-click
// collapses the column. The width is remembered (core store, persisted).

import { type KeyboardEvent, type PointerEvent, useRef } from 'react'
import { coreStore, FOLDER_WIDTH, useCore } from '../core/state'
import classes from './Shell.module.css'

const STEP = 16
const BIG_STEP = 64

export function FolderResizer({
  onResizing,
}: {
  onResizing(resizing: boolean): void
}) {
  const width = useCore((state) => state.panels.folderWidth)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startWidth: width }
    onResizing(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) {
      return
    }
    coreStore
      .getState()
      .setFolderWidth(
        drag.current.startWidth + event.clientX - drag.current.startX,
      )
  }

  const endDrag = () => {
    if (drag.current) {
      drag.current = null
      onResizing(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP
    const actions = coreStore.getState()
    switch (event.key) {
      case 'ArrowLeft':
        actions.setFolderWidth(width - step)
        break
      case 'ArrowRight':
        actions.setFolderWidth(width + step)
        break
      case 'Home':
        actions.setFolderWidth(FOLDER_WIDTH.min)
        break
      case 'End':
        actions.setFolderWidth(FOLDER_WIDTH.max)
        break
      case 'Enter':
        actions.setFolderWidth(FOLDER_WIDTH.default)
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter is role=separator by ARIA's window-splitter pattern; <hr> can't take focus or keys
    <div
      className={classes.resizer}
      role='separator'
      aria-orientation='vertical'
      aria-label='Resize folder column'
      aria-valuemin={FOLDER_WIDTH.min}
      aria-valuemax={FOLDER_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      data-mm-local-keys=''
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => coreStore.getState().toggleFolders()}
    />
  )
}
