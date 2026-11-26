// Detail's own command: play / pause the stage's video or audio with Space
// (declared in core's CommandMap, bound in DEFAULT_BINDINGS). The rest of
// detail mode's commands are core's (detail.open, close, step, zoom;
// app/runtime.ts) or other features' (folders.move-to, inspector.edit-image,
// items.delete), which the More menu runs by name.
//
// This module is in the initial chunk (register() runs at start-up), so it
// stays tiny: the player itself is in the lazy overlay and registers here
// while it is mounted.

import {
  type Availability,
  implementCommand,
  notifyCommandsChanged,
} from '../../core/commands/registry'

/** What the mounted player offers the command. */
export interface PlayerControl {
  toggle(): void
}

let activePlayer: PlayerControl | null = null

/**
 * Makes `player` the one Space plays and pauses, until the returned function
 * runs (on unmount). The newest registration wins.
 */
export function registerPlayer(player: PlayerControl): () => void {
  activePlayer = player
  notifyCommandsChanged()
  return () => {
    if (activePlayer === player) {
      activePlayer = null
      notifyCommandsChanged()
    }
  }
}

const NOTHING_TO_PLAY: Availability = {
  ok: false,
  code: 'nothing-to-play',
  reason: 'Only for video and audio',
}

let registered = false

/** Implements detail.play-toggle (Space in detail mode). */
export function registerDetailCommands(): void {
  if (registered) {
    return
  }
  registered = true
  implementCommand('detail.play-toggle', {
    available: () => (activePlayer ? { ok: true } : NOTHING_TO_PLAY),
    run: () => activePlayer?.toggle(),
  })
}
