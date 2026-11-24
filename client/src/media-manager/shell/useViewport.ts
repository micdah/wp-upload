import { useEffect } from 'react'
import { coreStore, viewportForWidth } from '../core/state'

/**
 * Keeps core's `viewport` in step with the window width (interaction-spec
 * §6 breakpoints: 1200, 900 and 600 px).
 */
export function useViewportTracking(): void {
  useEffect(() => {
    const update = () =>
      coreStore.getState().setViewport(viewportForWidth(window.innerWidth))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
}
