// Boot: the plugin check comes first (interaction-spec §13.7, system.md §9
// request 8). Only a usable plugin state renders the shell; every other
// state renders its own screen instead of covering the app.

import { lazy, Suspense, useLayoutEffect } from 'react'
import {
  PLUGIN_USABLE_STATES,
  type PluginState,
} from '../../../../../shared/library-api'
import { coreStore, useCore } from '../../core/state'
import { Onboarding } from '../../features/system'
import { Shell } from '../../shell/Shell'
import { LoadingHairline } from '../screens/StateScreen'
import { ServerUnreachableScreen } from '../screens/screens'
import classes from './Boot.module.css'
import { useBootstrap } from './useBootstrap'

// Rare states: their screens load on demand (plan §9's initial-chunk budget).
const loadBootScreens = () => import('../screens/bootScreens')
const WordPressUnreachableScreen = lazy(() =>
  loadBootScreens().then((m) => ({ default: m.WordPressUnreachableScreen })),
)
const AppPasswordRejectedScreen = lazy(() =>
  loadBootScreens().then((m) => ({ default: m.AppPasswordRejectedScreen })),
)
const PluginBlockedScreen = lazy(() =>
  loadBootScreens().then((m) => ({ default: m.PluginBlockedScreen })),
)

export function isUsablePluginState(state: PluginState): boolean {
  return (PLUGIN_USABLE_STATES as readonly PluginState[]).includes(state)
}

export function Boot() {
  return (
    <Suspense fallback={<LoadingHairline label='Loading the media library' />}>
      <BootState />
    </Suspense>
  )
}

function BootState() {
  const { data: bootstrap, status, refetch, isFetching } = useBootstrap()
  const stored = useCore((state) => state.bootstrap)

  // Into the core store before anything paints: commands' available() (e.g.
  // FileBird for the folders panel) read it from there. A layout effect's
  // update re-renders synchronously, before the browser paints.
  useLayoutEffect(() => {
    coreStore.getState().setBootstrap(bootstrap ?? null)
  }, [bootstrap])

  const retry = () => {
    void refetch()
  }

  if (status === 'pending') {
    return <LoadingHairline label='Loading the media library' />
  }
  if (status === 'error' || !bootstrap) {
    return <ServerUnreachableScreen onRetry={retry} />
  }
  if (bootstrap.wp.state === 'unreachable') {
    return (
      <WordPressUnreachableScreen
        message={bootstrap.wp.message}
        onRetry={retry}
        retrying={isFetching}
      />
    )
  }
  if (bootstrap.wp.state === 'auth_failed') {
    return (
      <AppPasswordRejectedScreen
        message={bootstrap.wp.message}
        onRetry={retry}
      />
    )
  }
  const plugin = bootstrap.plugin
  if (!plugin) {
    return <ServerUnreachableScreen onRetry={retry} />
  }
  if (plugin.state === 'missing') {
    // The system feature's onboarding screen; until it renders something,
    // the minimal fallback next to it shows (hidden by CSS once it does).
    return (
      <>
        <div className={classes.onboarding}>
          <Onboarding />
        </div>
        <div className={classes.fallback}>
          <PluginBlockedScreen plugin={plugin} onRetry={retry} />
        </div>
      </>
    )
  }
  if (!isUsablePluginState(plugin.state) || !bootstrap.site) {
    return <PluginBlockedScreen plugin={plugin} onRetry={retry} />
  }
  if (stored === null) {
    // The first pass, before the layout effect above has run: the shell's
    // first render must already see the bootstrap. Never painted.
    return null
  }
  return <Shell />
}
