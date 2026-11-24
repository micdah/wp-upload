import { Paper, Portal, Text } from '@mantine/core'
import { useStore } from 'zustand'
import { plural } from '../ui/announce'
import { mediaDragStore } from './mediaDrag'

const OFFSET = 14

/** The pointer-following "Move N items · to X" preview. Mount once. */
export function MediaDragPreview() {
  const active = useStore(mediaDragStore, (state) => state.active)
  if (!active) {
    return null
  }
  const what = `Move ${plural(active.ids.length, 'item')}`
  const where = active.target
    ? (active.target.refusal ?? `to ${active.target.label}`)
    : null
  return (
    <Portal>
      <Paper
        shadow='md'
        px='sm'
        py={6}
        radius='sm'
        withBorder
        data-mm-drag-preview=''
        style={{
          position: 'fixed',
          left: active.x + OFFSET,
          top: active.y + OFFSET,
          pointerEvents: 'none',
          zIndex: 1000,
          whiteSpace: 'nowrap',
        }}
      >
        <Text size='sm'>
          {what}
          {where && (
            <Text span c='dimmed' size='sm'>
              {' · '}
              {where}
            </Text>
          )}
        </Text>
      </Paper>
    </Portal>
  )
}
