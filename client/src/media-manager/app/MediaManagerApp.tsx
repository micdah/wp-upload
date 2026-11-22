import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import { Shell } from '../shell/Shell'
import { registerFeatures } from './features'

registerFeatures()

// Entry of the lazily loaded media-manager chunk (`?view=library`). It mounts
// its own Mantine provider, so the original upload page's theme and global
// CSS never load here. Track F3 supplies the real theme (design tokens, both
// colour schemes, fonts); track F1 adds boot (plugin check first), auth and
// the real shell.
export default function MediaManagerApp() {
  return (
    <MantineProvider defaultColorScheme='auto'>
      <Shell />
    </MantineProvider>
  )
}
