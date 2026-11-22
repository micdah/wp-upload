import { MantineProvider, v8CssVariablesResolver } from '@mantine/core'
import '@mantine/core/styles.css'
import '@mantine/dropzone/styles.css'
import '../cyberpunk.css'
import { theme } from '../theme'
import UploaderApp from './UploaderApp'

// The original upload page, with its own Mantine provider, cyberpunk theme
// and global CSS. It is loaded lazily so none of its global styles (body,
// scrollbars) reach the media manager. It is removed in M5 of the
// media-manager plan (D1c).
export default function LegacyApp() {
  return (
    // Mantine 9 made the `light` variant (Alert, Badge, Button) solid. The
    // 8.x resolver keeps it translucent, so the look stays as it was.
    <MantineProvider
      theme={theme}
      defaultColorScheme='dark'
      cssVariablesResolver={v8CssVariablesResolver}
    >
      <UploaderApp />
    </MantineProvider>
  )
}
