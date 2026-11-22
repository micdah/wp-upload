import { lazy, Suspense } from 'react'

const LegacyApp = lazy(() => import('./legacy/LegacyApp'))
const MediaManagerApp = lazy(
  () => import('./media-manager/app/MediaManagerApp'),
)

// Which UI to load. Until M5 of the media-manager plan the two UIs sit side
// by side: `?view=library` opens the media manager, anything else the
// original upload page. Switching views is a full page navigation, so only
// one Mantine provider (and one set of global styles) is ever mounted.
function selectedView(): 'library' | 'upload' {
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'library') {
    return 'library'
  }
  return 'upload'
}

export default function App() {
  const view = selectedView()
  return (
    <Suspense fallback={null}>
      {view === 'library' ? <MediaManagerApp /> : <LegacyApp />}
    </Suspense>
  )
}
