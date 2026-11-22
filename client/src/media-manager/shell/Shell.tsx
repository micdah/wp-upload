import { Box, Text } from '@mantine/core'
import { CommandLayer } from '../features/command-ui'
import { DetailOverlay } from '../features/detail'
import { EditorOverlay } from '../features/editor'
import { FilterBar } from '../features/filters'
import { FolderColumn } from '../features/folders'
import { GridView } from '../features/grid'
import { InspectorPanel } from '../features/inspector'
import { PeekOverlay } from '../features/peek'
import { PhoneChrome } from '../features/phone'
import { SystemBanners } from '../features/system'
import { TrashView } from '../features/trash'
import { UploadLayer } from '../features/upload'

// Placeholder app shell from the M0 scaffold. Track F1 replaces it with the
// real layout (toolbar, folder column, centre stack, inspector, overlays and
// breakpoints); it only shows where each feature's entry component goes.
export function Shell() {
  return (
    <Box p='md'>
      <Text fw={600}>Media manager</Text>
      <Text c='dimmed' size='sm'>
        Scaffold only: the feature tracks fill in the components below.
      </Text>
      <SystemBanners />
      <FilterBar />
      <Box style={{ display: 'flex' }}>
        <FolderColumn />
        <Box style={{ flex: 1, position: 'relative' }}>
          <GridView />
          <TrashView />
          <DetailOverlay />
          <PeekOverlay />
          <EditorOverlay />
        </Box>
        <InspectorPanel />
      </Box>
      <UploadLayer />
      <CommandLayer />
      <PhoneChrome />
    </Box>
  )
}
