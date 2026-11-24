// Esc layering: "Esc closes the innermost layer first" (interaction-spec §5).
//
// Our own transient layers (peek, the editor, a drawer, a drag in progress)
// register with useKeyLayer() while they are open; the newest one gets Esc
// before any key binding runs. Mantine's menus, modals and comboboxes aren't
// layers: they handle Esc themselves, and the dispatcher stays out of their
// way (see dispatch.ts and spike C4).

import { useEffect, useRef } from 'react'

export interface KeyLayer {
  /** For debugging and tests. */
  name: string
  onEscape(): void
}

const stack: KeyLayer[] = []

/** Pushes a layer; returns the function that removes it. */
export function pushKeyLayer(layer: KeyLayer): () => void {
  stack.push(layer)
  return () => {
    const index = stack.lastIndexOf(layer)
    if (index !== -1) {
      stack.splice(index, 1)
    }
  }
}

export function topKeyLayer(): KeyLayer | null {
  return stack.at(-1) ?? null
}

export function keyLayerNames(): string[] {
  return stack.map((layer) => layer.name)
}

/**
 * Registers an Esc layer while `active` is true. The newest active layer
 * wins. A layer that becomes active later than another sits above it, so
 * open nested layers one after the other (not in the same render).
 */
export function useKeyLayer(
  name: string,
  onEscape: () => void,
  active = true,
): void {
  const handler = useRef(onEscape)
  handler.current = onEscape
  useEffect(() => {
    if (!active) {
      return
    }
    return pushKeyLayer({ name, onEscape: () => handler.current() })
  }, [name, active])
}

/** Tests only. */
export function resetKeyLayersForTesting(): void {
  stack.splice(0)
}
