import { notifications } from '@mantine/notifications'
import { act } from '@testing-library/react'
import { cleanupLibrary } from '../../../test/renderLibrary'
import { resetFolderUi } from '../store'

// What every folder browser spec drops after a test: the app and the fake
// (cleanupLibrary), the column's own state and stored preferences, and
// Mantine's notifications. Those live in a module-level store; left over,
// they fill Mantine's limit, so the next test's toast waits in a queue.
export function cleanupFolders(): void {
  cleanupLibrary()
  resetFolderUi()
  window.localStorage.clear()
  act(() => notifications.clean())
}
