// Stub entry for the `peek` feature: the quick peek (Space).
// Owned by track A1 (docs/media-manager/implementation-plan.md §7).
// The shell imports these exports directly: keep their names and replace
// the bodies. register() wires commands, key bindings and palette sources.

export function PeekOverlay() {
  return null
}

export function register(): void {}
