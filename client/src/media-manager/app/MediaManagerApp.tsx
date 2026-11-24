import { AuthGate } from './auth/AuthGate'
import { Boot } from './boot/Boot'
import { registerFeatures } from './features'
import { AppProviders } from './providers'
import { registerCoreCommands } from './runtime'

// Core first, so features see core's commands and keymap when they register.
registerCoreCommands()
registerFeatures()

// Entry of the lazily loaded media-manager chunk (`?view=library`). It mounts
// its own Mantine provider, so the old upload page's theme and global CSS
// never load here. Order: providers → session (login) → boot (plugin check
// first) → shell.
export default function MediaManagerApp() {
  return (
    <AppProviders>
      <AuthGate>
        <Boot />
      </AuthGate>
    </AppProviders>
  )
}
