// Stub entry for the `inspector` feature: the inspector rail and panel (Info, Usage; hosts EditPanel).
// Owned by track A4 (docs/media-manager/implementation-plan.md §7).
// The shell imports these exports directly: keep their names and replace
// the bodies. register() wires commands, key bindings and palette sources.

export function InspectorPanel() {
  return null
}

export function register(): void {}
