// Stub entry for the `command-ui` feature: the shortcut sheet (?) and command palette (Mod+K).
// Owned by track B5 (docs/media-manager/implementation-plan.md §7).
// The shell imports these exports directly: keep their names and replace
// the bodies. register() wires commands, key bindings and palette sources.

export function CommandLayer() {
  return null
}

export function register(): void {}
