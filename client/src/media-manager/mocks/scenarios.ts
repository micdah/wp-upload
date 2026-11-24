// Mock scenarios (interaction-spec §11, plus every `plugin.state` and both
// WordPress failure states), chosen with `?mock-scenario=<id>`. Several can
// be combined with commas, applied left to right: `?mock-scenario=author,trash`.
//
// More URL knobs (all optional):
// - `mock-items=50000`: a generated library of that size (also `large`);
// - `mock-latency=300`: read latency in ms (writes get the same);
// - `mock-images=picsum`: real photos from picsum.photos instead of local
//   placeholders (needs internet; for feel reviews, not for tests);
// - `mock-job-speed=0.1`: multiplies job durations (0 = finish at once);
// - `mock-offline-after=3000`: WordPress goes away after that many ms.
//
// The scenario is remembered for the tab (sessionStorage), so the app's own
// URL rewrites can drop the parameter without losing it.

import type { PluginState, WpState } from '../../../../shared/library-api'

export interface MockSettings {
  scenarios: ScenarioId[]
  wp: WpState
  plugin: PluginState
  user: 'editor' | 'author'
  filebird: 'lite' | 'pro' | 'per-user' | 'none' | 'inactive'
  trash: boolean
  library: 'prototype' | 'empty' | 'large'
  /** items in a generated library */
  largeCount: number
  indexing: boolean
  latency: { read: number; write: number }
  /** WordPress becomes unreachable this long after start; null = never */
  offlineAfterMs: number | null
  images: 'svg' | 'picsum'
  jobSpeed: number
}

export const DEFAULT_SETTINGS: MockSettings = {
  scenarios: ['normal'],
  wp: 'ok',
  plugin: 'ok',
  user: 'editor',
  filebird: 'lite',
  trash: false,
  library: 'prototype',
  largeCount: 50_000,
  indexing: false,
  latency: { read: 80, write: 150 },
  offlineAfterMs: null,
  images: 'svg',
  jobSpeed: 1,
}

type Patch = Partial<Omit<MockSettings, 'scenarios'>>

/** Every scenario and what it changes; `normal` is the default site. */
export const SCENARIOS = {
  /** Default site with FileBird Lite */
  normal: {},
  /** FileBird Pro detected: folder colours and folder sorting */
  pro: { filebird: 'pro' },
  /** FileBird per-user folders: notice, column read-only */
  'per-user': { filebird: 'per-user' },
  /** No folder UI at all */
  'no-filebird': { filebird: 'none' },
  /** FileBird installed but deactivated (`filebird.active: false`) */
  'filebird-inactive': { filebird: 'inactive' },
  /** Companion plugin missing: onboarding (same as `plugin-missing`) */
  'no-plugin': { plugin: 'missing' },
  /** WP user is an Author: others' media read-only */
  author: { user: 'author' },
  /** MEDIA_TRASH on: Trash flow and Trash view (two items already trashed) */
  trash: { trash: true },
  /** WordPress goes unreachable 4 s after start: banner, cached browsing */
  offline: { offlineAfterMs: 4000 },
  /** Slow site: skeletons */
  loading: { latency: { read: 2500, write: 1200 } },
  /** Empty library */
  empty: { library: 'empty' },
  /** 50 000 generated items, 300 folders */
  large: { library: 'large' },
  /** The plugin's indexes are still building */
  indexing: { indexing: true },
  'plugin-missing': { plugin: 'missing' },
  'plugin-forbidden': { plugin: 'forbidden' },
  'plugin-outdated': { plugin: 'outdated' },
  'plugin-too-new': { plugin: 'too-new' },
  'plugin-update-available': { plugin: 'update-available' },
  /** bootstrap says WordPress is unreachable */
  'wp-unreachable': { wp: 'unreachable' },
  /** bootstrap says WordPress rejected the app password */
  'wp-auth-failed': { wp: 'auth_failed' },
} as const satisfies Record<string, Patch>

export type ScenarioId = keyof typeof SCENARIOS

export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[]

export function isScenarioId(value: string): value is ScenarioId {
  return value in SCENARIOS
}

const STORAGE_KEY = 'wpu-mock-settings-query'

function numberParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name)
  if (raw === null || raw === '') {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** Settings from URL parameters (unknown scenario ids are ignored). */
export function resolveSettings(
  search: string | URLSearchParams,
): MockSettings {
  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search
  const ids = (params.get('mock-scenario') ?? 'normal')
    .split(',')
    .map((id) => id.trim())
    .filter(isScenarioId)
  const settings: MockSettings = {
    ...DEFAULT_SETTINGS,
    latency: { ...DEFAULT_SETTINGS.latency },
    scenarios: ids.length > 0 ? ids : ['normal'],
  }
  for (const id of settings.scenarios) {
    Object.assign(settings, SCENARIOS[id])
  }
  const items = numberParam(params, 'mock-items')
  if (items !== null) {
    settings.library = items === 0 ? 'empty' : 'large'
    settings.largeCount = Math.floor(items)
  }
  const latency = numberParam(params, 'mock-latency')
  if (latency !== null) {
    settings.latency = { read: latency, write: latency }
  }
  if (params.get('mock-images') === 'picsum') {
    settings.images = 'picsum'
  }
  const jobSpeed = numberParam(params, 'mock-job-speed')
  if (jobSpeed !== null) {
    settings.jobSpeed = jobSpeed
  }
  const offlineAfter = numberParam(params, 'mock-offline-after')
  if (offlineAfter !== null) {
    settings.offlineAfterMs = offlineAfter
  }
  return settings
}

const MOCK_PARAMS = [
  'mock-scenario',
  'mock-items',
  'mock-latency',
  'mock-images',
  'mock-job-speed',
  'mock-offline-after',
]

/**
 * The browser's settings: from the URL when it has any `mock-*` parameter
 * (and remembered for the tab), else what this tab used last.
 */
export function browserSettings(
  location: Location,
  storage?: Storage,
): MockSettings {
  const params = new URLSearchParams(location.search)
  const own = new URLSearchParams()
  for (const name of MOCK_PARAMS) {
    const value = params.get(name)
    if (value !== null) {
      own.set(name, value)
    }
  }
  if ([...own.keys()].length > 0) {
    storage?.setItem(STORAGE_KEY, own.toString())
    return resolveSettings(own)
  }
  return resolveSettings(storage?.getItem(STORAGE_KEY) ?? '')
}
