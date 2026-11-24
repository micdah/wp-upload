import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'
import { type RequestHandler, Router } from 'express'
import {
  type Bootstrap,
  type BundledPlugin,
  type ChangelogEntry,
  type IndexStatus,
  PLUGIN_USABLE_STATES,
  type PluginFeature,
  type PluginState,
  type PluginStatus,
  type SiteInfo,
} from '../../../../shared/library-api.ts'
import type { PluginInfo } from '../../../../shared/plugin-api.ts'
import { env } from '../../config/env.ts'
import {
  cached,
  currentRev,
  knownPluginInfo,
  rememberPluginInfo,
  sendNoStore,
} from '../../lib/library/cache.ts'
import {
  asyncRoute,
  LibraryError,
  MESSAGES,
  toLibraryError,
} from '../../lib/library/errors.ts'
import { pluginClient, TIMEOUTS } from '../../lib/library/pluginClient.ts'

// GET bootstrap (server-api.md §7.1): which screen the client shows. Also
// home to what depends on the same plugin check: the compatibility rules
// (implementation plan §2.6), the bundled plugin's sidecars, the route guards
// of §9.4 (`requireUsablePlugin`, `requireFeature`) and the maintenance loop
// of §9.2.

// ---------------------------------------------------------------------------
// What this server needs from the plugin
// ---------------------------------------------------------------------------

/** The plugin API level this server needs (blocking check). */
export const PLUGIN_API_REQUIRED = { major: 1, minMinor: 0 } as const

/** Optional plugin features this server can use (non-blocking check). */
export const PLUGIN_FEATURES_OPTIONAL: readonly PluginFeature[] = []

/** The route guards re-read `/info` when their copy is older than this. */
export const PLUGIN_STATE_MAX_AGE_MS = 5 * 60_000

const MESSAGES_BY_STATE = {
  missing: 'The companion plugin was not found on the WordPress site.',
  forbidden:
    'The WordPress user this app signs in as cannot upload files. It needs the Editor role.',
} as const

// ---------------------------------------------------------------------------
// The bundled plugin (plan §2.6, server-api §9.3)
// ---------------------------------------------------------------------------

/**
 * Where the plugin build's sidecars (`plugin.json`, `changelog.json`) and zip
 * live: `env.pluginBundleDir` (`WPU_PLUGIN_BUNDLE_DIR`, which the Docker image
 * sets; the default is the repo's build output).
 */
export function bundledPluginDir(): string {
  return env.pluginBundleDir
}

/**
 * Reads `plugin.json` (`{version, api, features}`) and `changelog.json`
 * (`ChangelogEntry[]`) from the bundle directory. Null without them (dev
 * mode before a build, `ci.yml`'s tests): the checks then use only
 * PLUGIN_API_REQUIRED.
 */
export function readBundledPlugin(dir: string): BundledPlugin | null {
  let manifest: unknown
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'),
    )
  } catch {
    return null
  }
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    typeof (manifest as BundledPlugin).version !== 'string' ||
    typeof (manifest as BundledPlugin).api !== 'string'
  ) {
    console.error(`Ignoring ${dir}/plugin.json: it has no version or api.`)
    return null
  }
  const { version, api, features } = manifest as BundledPlugin
  return {
    version,
    api,
    features: Array.isArray(features)
      ? features.filter((f) => typeof f === 'string')
      : [],
    changelog: readChangelog(path.join(dir, 'changelog.json')),
  }
}

function readChangelog(file: string): ChangelogEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { entries?: unknown })?.entries)
      ? (raw as { entries: unknown[] }).entries
      : []
  return list.filter(
    (entry): entry is ChangelogEntry =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as ChangelogEntry).version === 'string' &&
      typeof (entry as ChangelogEntry).date === 'string' &&
      Array.isArray((entry as ChangelogEntry).changes),
  )
}

// Read once at startup (plan §2.6).
let bundled: BundledPlugin | null = readBundledPlugin(bundledPluginDir())

/** The bundled plugin's sidecars, or null without a bundled zip. */
export function bundledPlugin(): BundledPlugin | null {
  return bundled
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** `major.minor` of an API level, or null when it isn't one. */
export function parseApiLevel(
  api: string,
): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)$/.exec(api.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]) }
}

/**
 * Compares two semver versions (`1.0.0`, `1.0.0-dev.3`): negative when `a`
 * is older, 0 when equal, positive when newer. Unparseable parts count as 0.
 */
export function compareSemver(a: string, b: string): number {
  const [aCore = '', aPre] = splitPrerelease(a)
  const [bCore = '', bPre] = splitPrerelease(b)
  const aNums = aCore.split('.').map(toNumber)
  const bNums = bCore.split('.').map(toNumber)
  for (let i = 0; i < 3; i++) {
    const diff = (aNums[i] ?? 0) - (bNums[i] ?? 0)
    if (diff !== 0) return diff
  }
  // A pre-release is older than its release.
  if (aPre === undefined && bPre === undefined) return 0
  if (aPre === undefined) return 1
  if (bPre === undefined) return -1
  return comparePrerelease(aPre, bPre)
}

function splitPrerelease(version: string): [string, string | undefined] {
  const clean = version.trim().replace(/^v/, '').split('+')[0] ?? ''
  const dash = clean.indexOf('-')
  return dash === -1
    ? [clean, undefined]
    : [clean.slice(0, dash), clean.slice(dash + 1)]
}

function comparePrerelease(a: string, b: string): number {
  const aParts = a.split('.')
  const bParts = b.split('.')
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const x = aParts[i]
    const y = bParts[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)
    if (xNum && yNum) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

function toNumber(part: string): number {
  const value = Number.parseInt(part, 10)
  return Number.isFinite(value) ? value : 0
}

// ---------------------------------------------------------------------------
// Deciding the states (server-api.md §7.1)
// ---------------------------------------------------------------------------

/** What `GET /info` gave: its answer, or the error it failed with. */
export type InfoOutcome =
  | { ok: true; info: PluginInfo }
  | { ok: false; error: unknown }

/** The Bootstrap for one outcome of `GET /info`. */
export function evaluateBootstrap(
  outcome: InfoOutcome,
  bundledPlugin: BundledPlugin | null,
): Bootstrap {
  return outcome.ok
    ? evaluateInfo(outcome.info, bundledPlugin)
    : evaluateInfoError(outcome.error, bundledPlugin)
}

function evaluateInfoError(
  error: unknown,
  bundledPlugin: BundledPlugin | null,
): Bootstrap {
  // Maps the error first: that also marks the connection down on a 401.
  const mapped = toLibraryError(error)
  const response = axios.isAxiosError(error) ? error.response : undefined
  const status = response?.status
  const body = response?.data as
    | { code?: unknown; data?: Record<string, unknown> | null }
    | undefined
  const code = typeof body?.code === 'string' ? body.code : null

  if (status === 401 || mapped.body.code === 'wp_auth_failed') {
    return wpFailure('auth_failed', MESSAGES.authFailed)
  }
  if (status === 404 && code === 'rest_no_route') {
    return pluginBlocked(
      plugin(
        'missing',
        null,
        null,
        [],
        bundledPlugin,
        MESSAGES_BY_STATE.missing,
      ),
    )
  }
  if (status === 403 && code === 'wpu_forbidden') {
    const data = body?.data ?? {}
    const version = typeof data.version === 'string' ? data.version : null
    const api = typeof data.api === 'string' ? data.api : null
    return pluginBlocked(
      plugin(
        'forbidden',
        version,
        api,
        [],
        bundledPlugin,
        MESSAGES_BY_STATE.forbidden,
      ),
    )
  }
  if (status === 403) {
    return wpFailure('unreachable', 'WordPress refused the request (HTTP 403).')
  }
  return wpFailure('unreachable', mapped.body.message)
}

function evaluateInfo(
  info: PluginInfo,
  bundledPlugin: BundledPlugin | null,
): Bootstrap {
  // The frozen identity (plugin-api.md §3.1) is read first and leniently.
  const raw = info as unknown as Record<string, unknown>
  if (typeof raw.version !== 'string' || typeof raw.api !== 'string') {
    return wpFailure(
      'unreachable',
      'The companion plugin answered with an unexpected response.',
    )
  }
  const version = raw.version
  const api = raw.api
  const features = Array.isArray(raw.features)
    ? raw.features.filter((f): f is string => typeof f === 'string')
    : []
  const required = PLUGIN_API_REQUIRED
  const level = parseApiLevel(api)

  if (!level) {
    return pluginBlocked(
      plugin(
        'outdated',
        version,
        api,
        features,
        bundledPlugin,
        `The companion plugin reports an API level this app can't read ("${api}").`,
      ),
    )
  }
  if (level.major > required.major) {
    return pluginBlocked(
      plugin(
        'too-new',
        version,
        api,
        features,
        bundledPlugin,
        `The companion plugin (API ${api}) is newer than this app supports. Update the app.`,
      ),
    )
  }
  if (
    level.major < required.major ||
    (level.major === required.major && level.minor < required.minMinor)
  ) {
    return pluginBlocked(
      plugin(
        'outdated',
        version,
        api,
        features,
        bundledPlugin,
        `The companion plugin is version ${version}; this app needs API ` +
          `${required.major}.${required.minMinor} or newer.`,
      ),
    )
  }

  const site = siteFromInfo(info)
  if (!site) {
    return wpFailure(
      'unreachable',
      'The companion plugin answered /info with an unexpected response.',
    )
  }

  const missingFeatures = PLUGIN_FEATURES_OPTIONAL.filter(
    (feature) => !features.includes(feature),
  )
  const bundledIsNewer =
    bundledPlugin !== null && compareSemver(bundledPlugin.version, version) > 0
  let state: PluginState = 'ok'
  let message: string | null = null
  if (bundledIsNewer && bundledPlugin) {
    state = 'update-available'
    message = `Version ${bundledPlugin.version} of the companion plugin is available.`
  } else if (missingFeatures.length > 0) {
    state = 'update-available'
    message =
      'The companion plugin lacks features this app can use ' +
      `(${missingFeatures.join(', ')}). Update it to get them.`
  }

  return {
    wp: { state: 'ok', message: null },
    plugin: {
      ...plugin(state, version, api, features, bundledPlugin, message),
      missingFeatures: [...missingFeatures],
    },
    site,
    rev: typeof info.rev === 'string' ? info.rev : null,
  }
}

function plugin(
  state: PluginState,
  version: string | null,
  api: string | null,
  features: string[],
  bundledPlugin: BundledPlugin | null,
  message: string | null,
): PluginStatus {
  return {
    state,
    version,
    api,
    features,
    missingFeatures: [],
    required: { ...PLUGIN_API_REQUIRED },
    bundled: bundledPlugin && {
      ...bundledPlugin,
      changelog: bundledPlugin.changelog.filter(
        (entry) =>
          version === null || compareSemver(entry.version, version) > 0,
      ),
    },
    message,
  }
}

function pluginBlocked(status: PluginStatus): Bootstrap {
  return {
    wp: { state: 'ok', message: null },
    plugin: status,
    site: null,
    rev: null,
  }
}

function wpFailure(
  state: 'unreachable' | 'auth_failed',
  message: string,
): Bootstrap {
  return { wp: { state, message }, plugin: null, site: null, rev: null }
}

/** SiteInfo from a compatible plugin's `/info`; null when it is malformed. */
function siteFromInfo(info: PluginInfo): SiteInfo | null {
  const { user, filebird, trash, upload, imageSizes, imageEditor, index } = info
  const wellFormed =
    isObject(user) &&
    (filebird === null || isObject(filebird)) &&
    isObject(trash) &&
    isObject(upload) &&
    typeof upload.maxBytes === 'number' &&
    Array.isArray(upload.mimes) &&
    Array.isArray(imageSizes) &&
    isObject(imageEditor) &&
    isObject(index) &&
    isObject(index.media) &&
    isObject(index.usage)
  if (!wellFormed) return null

  const serverMaxBytes = env.maxFileSizeMb * 1_048_576
  return {
    user,
    filebird,
    trash,
    upload: {
      maxBytes: Math.min(upload.maxBytes, serverMaxBytes),
      mimes: upload.mimes,
    },
    imageSizes,
    imageEditor,
    index,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Reading /info
// ---------------------------------------------------------------------------

/**
 * Calls the plugin's `/info`, cached for 30 s per rev (server-api.md §3.2).
 * The rev comes from `/rev` (polled at most every 2 s); when that fails, its
 * error stands in for `/info`'s, except a 403, where only `/info` carries
 * the plugin's identity. So a hanging WordPress costs one timeout, not two.
 */
async function readInfo(timeoutMs: number): Promise<InfoOutcome> {
  let rev: string | null = null
  try {
    rev = await currentRev({ timeoutMs })
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : null
    if (status !== 403) return { ok: false, error }
  }
  try {
    const info =
      rev === null
        ? await pluginClient.info({ timeoutMs })
        : (
            await cached(`info@${rev}`, () => pluginClient.info({ timeoutMs }))
          ).value()
    rememberPluginInfo(info)
    return { ok: true, info }
  } catch (error) {
    return { ok: false, error }
  }
}

let lastEvaluation: { bootstrap: Bootstrap; at: number } | null = null

/** Reads `/info` and decides the states; remembered for the guards. */
export async function checkPlugin(timeoutMs: number): Promise<Bootstrap> {
  const result = evaluateBootstrap(await readInfo(timeoutMs), bundled)
  lastEvaluation = { bootstrap: result, at: Date.now() }
  return result
}

/**
 * The last known plugin check, refreshed when older than
 * PLUGIN_STATE_MAX_AGE_MS, with bootstrap's short timeout. A failed refresh
 * only reports WordPress's state, which never blocks a route.
 */
export async function knownPluginCheck(): Promise<Bootstrap> {
  if (
    lastEvaluation &&
    Date.now() - lastEvaluation.at < PLUGIN_STATE_MAX_AGE_MS
  ) {
    return lastEvaluation.bootstrap
  }
  return checkPlugin(TIMEOUTS.bootstrap)
}

// ---------------------------------------------------------------------------
// Route guards (server-api.md §9.4)
// ---------------------------------------------------------------------------

/**
 * Answers 409 `plugin_incompatible` while the plugin state blocks the app
 * (anything but `ok` and `update-available`). When WordPress itself can't be
 * reached, the route runs and reports that error itself.
 */
export const requireUsablePlugin: RequestHandler = asyncRoute(
  async (_req, _res, next) => {
    const check = await knownPluginCheck()
    const state = check.plugin?.state
    if (state && !(PLUGIN_USABLE_STATES as readonly string[]).includes(state)) {
      throw new LibraryError(
        409,
        'plugin_incompatible',
        check.plugin?.message ??
          'The companion plugin on the WordPress site cannot be used.',
        { state },
      )
    }
    next()
  },
)

/**
 * Answers 409 `feature_unavailable` (with `details.feature`) when the
 * installed plugin lacks `feature`. Use after requireUsablePlugin.
 */
export function requireFeature(feature: PluginFeature): RequestHandler {
  return asyncRoute(async (_req, _res, next) => {
    const check = await knownPluginCheck()
    const features = check.plugin?.features
    if (features && check.site && !features.includes(feature)) {
      throw new LibraryError(
        409,
        'feature_unavailable',
        `The companion plugin on the WordPress site lacks "${feature}". Update it.`,
        { feature },
      )
    }
    next()
  })
}

// ---------------------------------------------------------------------------
// The maintenance loop (server-api.md §9.2)
// ---------------------------------------------------------------------------

export const MAINTENANCE = {
  budgetMs: 5000,
  pauseMs: 250,
  maxConsecutiveErrors: 3,
  maxConsecutiveLocked: 5,
  /** steps in a row that did nothing although the plugin said `more` */
  maxConsecutiveIdle: 5,
  /** how long a loop stopped for making no progress stays stopped */
  idleCooldownMs: 10 * 60_000,
} as const

let maintenanceRun: Promise<void> | null = null
let ranAfterFirstBootstrap = false
/** Date.now() before which `rev` doesn't restart a loop that made no progress */
let idleUntil = 0

function indexReady(index: IndexStatus | null | undefined): boolean {
  return (
    !index || (index.media.state === 'ready' && index.usage.state === 'ready')
  )
}

/**
 * Starts the one background maintenance loop of this process (if it isn't
 * running) when an index isn't `ready`, or once after the first successful
 * bootstrap whatever the state says (it catches gaps the plugin can't flag).
 */
export function triggerMaintenance(
  index: IndexStatus | null | undefined,
  reason: 'bootstrap' | 'rev',
): void {
  const firstBootstrap = reason === 'bootstrap' && !ranAfterFirstBootstrap
  if (indexReady(index) && !firstBootstrap) return
  if (maintenanceRun) return
  // A plugin that keeps saying `more` without doing anything would otherwise
  // be restarted by every rev poll.
  if (!firstBootstrap && Date.now() < idleUntil) return
  const features = knownPluginInfo()?.info.features
  if (features && !features.includes('maintenance')) return
  if (reason === 'bootstrap') ranAfterFirstBootstrap = true
  maintenanceRun = runMaintenance().finally(() => {
    maintenanceRun = null
  })
}

/** Whether a maintenance step (re)indexed anything at all. */
function madeProgress(
  did: Record<string, unknown> | null | undefined,
): boolean {
  return Object.values(did ?? {}).some(
    (count) => typeof count === 'number' && count > 0,
  )
}

async function runMaintenance(): Promise<void> {
  let errors = 0
  let locked = 0
  let idle = 0
  for (;;) {
    try {
      const step = await pluginClient.maintenanceStep({
        budgetMs: MAINTENANCE.budgetMs,
      })
      errors = 0
      locked = step.locked ? locked + 1 : 0
      if (locked >= MAINTENANCE.maxConsecutiveLocked) return
      if (!step.more && !step.locked) return
      idle = step.locked || madeProgress(step.did) ? 0 : idle + 1
      if (idle >= MAINTENANCE.maxConsecutiveIdle) {
        idleUntil = Date.now() + MAINTENANCE.idleCooldownMs
        console.error(
          `Library maintenance stopped: ${idle} steps in a row did nothing ` +
            'although the companion plugin reported more to do.',
        )
        return
      }
    } catch (error) {
      errors += 1
      if (errors >= MAINTENANCE.maxConsecutiveErrors) {
        console.error(
          'Library maintenance stopped after repeated errors:',
          toLibraryError(error).body.message,
        )
        return
      }
    }
    await new Promise((resolve) => setTimeout(resolve, MAINTENANCE.pauseMs))
  }
}

/** Resolves when no maintenance loop is running (tests). */
export function maintenanceIdle(): Promise<void> {
  return maintenanceRun ?? Promise.resolve()
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

export const bootstrapRouter = Router()

bootstrapRouter.get(
  '/bootstrap',
  asyncRoute(async (_req, res) => {
    const result = await checkPlugin(TIMEOUTS.bootstrap)
    if (result.site) triggerMaintenance(result.site.index, 'bootstrap')
    sendNoStore(res, result, { rev: result.rev })
  }),
)

/** Clears module state between tests. */
export function resetBootstrapForTests(
  bundledForTests: BundledPlugin | null = null,
): void {
  bundled = bundledForTests
  lastEvaluation = null
  maintenanceRun = null
  ranAfterFirstBootstrap = false
  idleUntil = 0
}
