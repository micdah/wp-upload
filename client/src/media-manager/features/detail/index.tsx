// The `detail` feature: detail mode's stage, stepping and zoom (interaction-
// spec §5). Built in M2 as the vertical slice; track A2 extends it in wave A
// (filmstrip, media players, pan, More menu). The shell imports these
// exports directly: keep their names.
//
// Core implements the commands (detail.open/close/step, zoom) in
// app/runtime.ts; detail registers the stage with centerApi.
//
// The overlay is a lazy chunk (plan §9's initial-chunk budget), fetched as
// soon as the browser is idle after start-up, so it is normally there before
// the first Enter; then the morph finds the stage at once. A deep link
// (`?item=`) loads it right away.

import { lazy, Suspense, useEffect } from 'react'
import { useUrlState } from '../../core/url/useUrlState'

const loadOverlay = () => import('./DetailOverlay')

const LazyDetailOverlay = lazy(() =>
  loadOverlay().then((module) => ({ default: module.DetailOverlay })),
)

/** Fetches the overlay's chunk when the browser has a moment. */
function usePrefetchOverlay(): void {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run) => setTimeout(run, 200))
    const handle = idle(() => {
      void loadOverlay()
    })
    return () => {
      if (window.cancelIdleCallback && typeof handle === 'number') {
        window.cancelIdleCallback(handle)
      }
    }
  }, [])
}

export function DetailOverlay() {
  usePrefetchOverlay()
  const open = useUrlState((state) => state.item !== null)
  if (!open) {
    return null
  }
  return (
    <Suspense fallback={null}>
      <LazyDetailOverlay />
    </Suspense>
  )
}

export function register(): void {}
