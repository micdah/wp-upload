// The running mock: settings, the fake library, the fake session and the
// network state. One context is current at a time; route handlers (core and
// per-feature, mocks/handlers/<feature>.ts) read it with `mockContext()` at
// request time, so a scenario switch or a test reset needs no new handlers.

import {
  authorUser,
  bootstrapByPluginState,
  bootstrapWpAuthFailed,
  bootstrapWpUnreachable,
  editorUser,
  siteInfo,
} from '../../../../shared/fixtures'
import type {
  Bootstrap,
  FileBirdInfo,
  PluginStatus,
} from '../../../../shared/library-api'
import type { MediaUrls } from './fake/dto'
import { generateDataset } from './fake/generate'
import { FakeLibrary } from './fake/library'
import { FAKE_USERS, prototypeDataset } from './fake/seed'
import type { FakeDataset } from './fake/types'
import { DEFAULT_SETTINGS, type MockSettings } from './scenarios'

export interface MockEnvironment {
  /** absolute, ends with `/`: where the media route answers */
  mediaBase: string
  /** the fake WordPress site (links only) */
  siteUrl?: string
  samples?: MediaUrls['samples']
  clock?: () => number
}

export interface MockContext {
  settings: MockSettings
  library: FakeLibrary
  session: { loggedIn: boolean; username: string }
  /** `auto` follows `settings.offlineAfterMs`; devtools force the others */
  network: 'auto' | 'online' | 'offline'
  startedAt: number
  now: () => number
}

const FILEBIRD_VERSION = '6.5.9'

function filebirdInfo(mode: MockSettings['filebird']): FileBirdInfo | null {
  switch (mode) {
    case 'none':
      return null
    case 'inactive':
      return {
        active: false,
        version: FILEBIRD_VERSION,
        pro: false,
        perUser: false,
      }
    case 'pro':
      return {
        active: true,
        version: FILEBIRD_VERSION,
        pro: true,
        perUser: false,
      }
    case 'per-user':
      return {
        active: true,
        version: FILEBIRD_VERSION,
        pro: false,
        perUser: true,
      }
    default:
      return {
        active: true,
        version: FILEBIRD_VERSION,
        pro: false,
        perUser: false,
      }
  }
}

function dataset(settings: MockSettings): FakeDataset {
  switch (settings.library) {
    case 'empty':
      return { items: [], folders: [], posts: [], users: FAKE_USERS }
    case 'large': {
      const generated = generateDataset({ items: settings.largeCount })
      return { ...generated, users: FAKE_USERS }
    }
    default:
      return prototypeDataset({ withTrash: settings.trash })
  }
}

export function createMockContext(
  settings: MockSettings = DEFAULT_SETTINGS,
  environment: MockEnvironment,
): MockContext {
  const now = environment.clock ?? Date.now
  const pluginFixture = bootstrapByPluginState[settings.plugin].plugin
  const library = new FakeLibrary({
    dataset: dataset(settings),
    user: settings.user === 'author' ? authorUser : editorUser,
    filebird: filebirdInfo(settings.filebird),
    trash: { ...siteInfo.trash, enabled: settings.trash },
    upload: siteInfo.upload,
    imageSizes: siteInfo.imageSizes,
    imageEditor: siteInfo.imageEditor,
    indexing: settings.indexing,
    features: pluginFixture?.features ?? [],
    urls: {
      mediaBase: environment.mediaBase,
      images: settings.images,
      samples: environment.samples,
      siteUrl: environment.siteUrl ?? 'https://example.com/',
    },
    clock: now,
    jobSpeed: settings.jobSpeed,
  })
  return {
    settings,
    library,
    session: { loggedIn: true, username: 'dev' },
    network: 'auto',
    startedAt: now(),
    now,
  }
}

let current: MockContext | null = null

export function setMockContext(context: MockContext | null): void {
  current = context
}

/** The running mock. Handlers call this per request. */
export function mockContext(): MockContext {
  if (!current) {
    throw new Error('The mock backend is not started (setMockContext).')
  }
  return current
}

/** WordPress is unreachable right now. */
export function isOffline(context: MockContext): boolean {
  if (context.network !== 'auto') {
    return context.network === 'offline'
  }
  const after = context.settings.offlineAfterMs
  return after !== null && context.now() - context.startedAt >= after
}

/** The plugin status the scenario reports. */
export function pluginStatus(context: MockContext): PluginStatus | null {
  return bootstrapByPluginState[context.settings.plugin].plugin
}

/** `GET bootstrap` for the current scenario and library state. */
export function bootstrapFor(context: MockContext): Bootstrap {
  if (context.settings.wp === 'unreachable' || isOffline(context)) {
    return bootstrapWpUnreachable
  }
  if (context.settings.wp === 'auth_failed') {
    return bootstrapWpAuthFailed
  }
  const plugin = pluginStatus(context)
  const usable = plugin?.state === 'ok' || plugin?.state === 'update-available'
  return {
    wp: { state: 'ok', message: null },
    plugin,
    site: usable ? context.library.siteInfo() : null,
    rev: usable ? context.library.rev : null,
  }
}
