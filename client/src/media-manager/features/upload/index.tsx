// Stub entry for the `upload` feature: drop-anywhere upload, the upload queue and tray.
// Owned by track B2 (docs/media-manager/implementation-plan.md §7).
// The shell imports these exports directly: keep their names and replace
// the bodies. register() wires commands, key bindings and palette sources.

export function UploadLayer() {
  return null
}

export function register(): void {}
