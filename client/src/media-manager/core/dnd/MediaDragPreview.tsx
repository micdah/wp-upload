import { useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import { pictureFor } from '../collection/renditions'
import { cachedItem } from '../data/items'
import { plural } from '../ui/announce'
import { FileIcon } from '../ui/icons'
import classes from './MediaDragPreview.module.css'
import { mediaDragStore } from './mediaDrag'

const OFFSET = 14
/** Thumbnails in the stack (folders.md §6). */
const STACK = 3
const THUMB = 36

/**
 * The pointer-following media drag preview (folders.md §6): up to three
 * stacked thumbnails, "Move N items", and where the drop goes: "to “X”" in
 * the accent colour, a refusal in the danger colour, or "Drop on a folder"
 * over nothing. Mount once.
 */
export function MediaDragPreview() {
  const active = useStore(mediaDragStore, (state) => state.active)
  if (!active) {
    return null
  }
  const target = active.target
  const where = target
    ? (target.refusal ?? `to ${target.label}`)
    : 'Drop on a folder'
  const valid = target ? target.refusal === undefined : undefined
  // The tile the drag started on leads the stack.
  const stack = [
    active.sourceId,
    ...active.ids.filter((id) => id !== active.sourceId),
  ].slice(0, STACK)
  return createPortal(
    <div
      className={classes.preview}
      data-mm-drag-preview=''
      data-valid={valid === undefined ? undefined : String(valid)}
      style={{
        transform: `translate(${active.x + OFFSET}px, ${active.y + OFFSET}px)`,
      }}
    >
      <span className={classes.stack} aria-hidden>
        {stack.map((id, index) => (
          <Thumb key={id} id={id} depth={index} />
        ))}
      </span>
      <span className={classes.text}>
        <span className={classes.title}>
          Move {plural(active.ids.length, 'item')}
        </span>
        <span className={classes.target}>{where}</span>
      </span>
    </div>,
    document.body,
  )
}

/** One thumbnail of the stack, from the cached item (an icon without one). */
function Thumb({ id, depth }: { id: number; depth: number }) {
  const queryClient = useQueryClient()
  const item = cachedItem(queryClient, id)
  const src = item
    ? pictureFor(item, THUMB, THUMB, window.devicePixelRatio || 1)
    : null
  return (
    <span className={classes.thumb} data-depth={depth}>
      {src ? (
        <img src={src} alt='' draggable={false} />
      ) : (
        <FileIcon size={18} stroke={1.5} />
      )}
    </span>
  )
}
