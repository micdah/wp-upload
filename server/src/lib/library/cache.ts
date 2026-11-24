import crypto from 'node:crypto'
import type { Request, Response } from 'express'
import {
  type IndexStatus,
  LIBRARY_REV_HEADER,
} from '../../../../shared/library-api.ts'
import type { PluginInfo } from '../../../../shared/plugin-api.ts'
import { onCoreWrite } from '../wpUpload.ts'
import {
  type CallOptions,
  pluginClient,
  setRevObserver,
} from './pluginClient.ts'

// Revision tracking and caching for /api/library/* (server-api.md §3): the
// server's `currentRev`, a rev-keyed LRU with single-flight, and the HTTP
// caching headers (ETag/304, X-Library-Rev, Cache-Control).

// ---------------------------------------------------------------------------
// The library revision (§3.1)
// ---------------------------------------------------------------------------

/** `currentRev` is refreshed from the plugin's `GET /rev` at most this often. */
export const REV_REFRESH_MS = 2000

interface KnownRev {
  rev: string
  /** from the last `/rev` poll; null until one succeeded */
  index: IndexStatus | null
  /** when `/rev` was last polled (0: only seen in other responses) */
  polledAt: number
}

let known: KnownRev | null = null

/**
 * Write counters a poll compares before and after itself, because its answer
 * may predate a write that finished while it was in flight:
 * - `responses`: revs reported by plugin responses (noteRev 'response');
 * - `expiries`: expireRevPoll() calls (core REST writes, which report no rev).
 */
const writes = { responses: 0, expiries: 0 }

/** What a poll saw of `writes` when it started. */
export interface PollStart {
  responses: number
  expiries: number
}

interface RevPoll {
  promise: Promise<KnownRev>
  /** `writes.expiries` when the poll started: later callers don't join it */
  expiries: number
}

let revInFlight: RevPoll | null = null

function isNewer(candidate: string, than: string): boolean {
  try {
    return BigInt(candidate) > BigInt(than)
  } catch {
    return candidate !== than
  }
}

/**
 * Called for every rev the plugin reports. A poll of `/rev` is
 * authoritative, so the rev may even go down (a restored database), unless a
 * write was seen after the poll started (`startedAt`): its answer may then
 * predate that write, so it only moves the rev forward. A poll that started
 * before an expireRevPoll() also leaves the next poll due. Any other
 * response only ever moves the rev forward.
 */
export function noteRev(
  rev: string,
  source: 'poll' | 'response',
  index?: IndexStatus,
  startedAt: PollStart = { ...writes },
): void {
  if (source === 'poll') {
    const raced = startedAt.responses !== writes.responses
    const expired = startedAt.expiries !== writes.expiries
    const lower = known !== null && !isNewer(rev, known.rev)
    known = {
      rev: (raced || expired) && lower && known ? known.rev : rev,
      index: index ?? known?.index ?? null,
      polledAt: expired ? (known?.polledAt ?? 0) : Date.now(),
    }
    return
  }
  writes.responses++
  if (!known) {
    known = { rev, index: null, polledAt: 0 }
  } else if (isNewer(rev, known.rev)) {
    known = { ...known, rev }
  }
}

/**
 * Makes the next currentRev() poll `/rev` instead of trusting the last poll
 * (and keeps a poll already in flight from counting as fresh). Call after
 * every successful write through WordPress core REST, whose answers carry no
 * library rev, so cached reads see the write at once rather than up to
 * REV_REFRESH_MS later.
 */
export function expireRevPoll(): void {
  writes.expiries++
  if (known) known = { ...known, polledAt: 0 }
}

// Polls report their answer themselves (currentRevState), with the state
// they started from; the observer only follows other responses.
function observeRev(rev: string, source: 'poll' | 'response'): void {
  if (source === 'response') noteRev(rev, 'response')
}

setRevObserver(observeRev)
// The legacy upload path writes through core REST too (lib/wpUpload.ts).
onCoreWrite(() => expireRevPoll())

/**
 * The current rev and index state, polling the plugin's `/rev` when the last
 * poll is older than REV_REFRESH_MS. Concurrent callers share one poll,
 * except one that started before the last expireRevPoll(). Throws the
 * upstream error when the poll fails.
 */
export async function currentRevState(
  options: CallOptions = {},
): Promise<{ rev: string; index: IndexStatus | null }> {
  if (known && Date.now() - known.polledAt < REV_REFRESH_MS) {
    return { rev: known.rev, index: known.index }
  }
  if (!revInFlight || revInFlight.expiries !== writes.expiries) {
    const startedAt: PollStart = { ...writes }
    const poll: RevPoll = {
      expiries: startedAt.expiries,
      promise: pluginClient
        .rev(options)
        .then((answer) => {
          noteRev(answer.rev, 'poll', answer.index, startedAt)
          return known as KnownRev
        })
        .finally(() => {
          if (revInFlight === poll) revInFlight = null
        }),
    }
    revInFlight = poll
  }
  const state = await revInFlight.promise
  return { rev: state.rev, index: state.index }
}

/** The current rev (see currentRevState). */
export async function currentRev(options: CallOptions = {}): Promise<string> {
  return (await currentRevState(options)).rev
}

/** The last rev seen, without asking the plugin; null before the first. */
export function lastKnownRev(): string | null {
  return known?.rev ?? null
}

// ---------------------------------------------------------------------------
// The LRU (§3.2)
// ---------------------------------------------------------------------------

export const CACHE_LIMITS = {
  ttlMs: 30_000,
  maxEntries: 200,
  maxBytes: 64 * 1024 * 1024,
} as const

/**
 * One cached answer, kept only serialised: a UTF-8 Buffer (off the V8 heap,
 * so its length is the memory it takes) rather than the parsed value plus a
 * JSON string, which would cost several times the counted bytes.
 */
interface Entry {
  /** the value as UTF-8 JSON, sent as-is */
  body: Buffer
  /** the value's top-level `rev`, when it has one (X-Library-Rev) */
  rev: string | null
  /** what the entry is counted as against maxBytes: body plus key */
  bytes: number
  expiresAt: number
}

/** What cached() answers. */
export interface CachedAnswer<T> {
  /** the value as UTF-8 JSON */
  body: Buffer
  /** the value's top-level `rev`, when it has one */
  rev: string | null
  /** the value itself (parsed from `body` on a cache hit) */
  value: () => T
}

/** Bookkeeping per entry beyond its body (Map slot, key, object), roughly. */
const ENTRY_OVERHEAD_BYTES = 256

function revOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const rev = (value as { rev?: unknown }).rev
  return typeof rev === 'string' ? rev : null
}

const entries = new Map<string, Entry>()
const loading = new Map<string, Promise<Entry>>()
let totalBytes = 0

function evict(key: string): void {
  const entry = entries.get(key)
  if (!entry) return
  entries.delete(key)
  totalBytes -= entry.bytes
}

function store(key: string, entry: Entry): void {
  evict(key)
  // A value bigger than the whole budget is served but never kept.
  if (entry.bytes > CACHE_LIMITS.maxBytes) return
  entries.set(key, entry)
  totalBytes += entry.bytes
  // Map iteration order is insertion order: the first key is the least
  // recently used one, because reads re-insert their entry.
  while (
    entries.size > CACHE_LIMITS.maxEntries ||
    totalBytes > CACHE_LIMITS.maxBytes
  ) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    evict(oldest)
  }
}

function fresh(key: string): Entry | null {
  const entry = entries.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    evict(key)
    return null
  }
  entries.delete(key)
  entries.set(key, entry)
  return entry
}

/**
 * The cached value for `key`, or the result of `load()`, which is then kept
 * for CACHE_LIMITS.ttlMs. Concurrent misses for one key share one `load()`;
 * failures are never cached. Keys must contain the rev they were read at, so
 * a new rev makes old entries unreachable (they age out).
 */
export async function cached<T>(
  key: string,
  load: () => Promise<T>,
): Promise<CachedAnswer<T>> {
  const hit = fresh(key)
  if (hit) return answerFrom<T>(hit)

  let pending = loading.get(key)
  if (!pending) {
    pending = load()
      .then((value) => {
        const body = Buffer.from(JSON.stringify(value), 'utf8')
        const entry: Entry = {
          body,
          rev: revOf(value),
          bytes:
            body.byteLength + Buffer.byteLength(key) + ENTRY_OVERHEAD_BYTES,
          expiresAt: Date.now() + CACHE_LIMITS.ttlMs,
        }
        store(key, entry)
        return entry
      })
      .finally(() => {
        loading.delete(key)
      })
    loading.set(key, pending)
  }
  return answerFrom<T>(await pending)
}

/**
 * The answer for an entry. The value is parsed from the body on demand, so
 * every caller gets its own copy and nothing but the body stays in memory.
 */
function answerFrom<T>(entry: Entry): CachedAnswer<T> {
  return {
    body: entry.body,
    rev: entry.rev,
    value: () => JSON.parse(entry.body.toString('utf8')) as T,
  }
}

/** Entry count and size, for tests and diagnostics. */
export function cacheStats(): { entries: number; bytes: number } {
  return { entries: entries.size, bytes: totalBytes }
}

// ---------------------------------------------------------------------------
// The plugin's /info (cached per rev, and remembered for the route guards)
// ---------------------------------------------------------------------------

let knownInfo: { info: PluginInfo; at: number } | null = null

/** Remembers the latest `/info` answer (bootstrap and the route guards). */
export function rememberPluginInfo(info: PluginInfo): void {
  knownInfo = { info, at: Date.now() }
}

/** The latest `/info` answer and when it arrived; null before the first. */
export function knownPluginInfo(): { info: PluginInfo; at: number } | null {
  return knownInfo
}

// ---------------------------------------------------------------------------
// HTTP caching (§3.3)
// ---------------------------------------------------------------------------

/** `W/"<rev>-<hash of the normalised query>"`. */
export function etagFor(rev: string, normalisedQuery: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(normalisedQuery)
    .digest('base64url')
    .slice(0, 16)
  return `W/"${rev}-${hash}"`
}

/** Whether the request's If-None-Match names this ETag. */
export function matchesIfNoneMatch(req: Request, etag: string): boolean {
  const header = req.headers['if-none-match']
  if (!header) return false
  if (header.trim() === '*') return true
  const wanted = etag.replace(/^W\//, '')
  return header
    .split(',')
    .some((tag) => tag.trim().replace(/^W\//, '') === wanted)
}

/** Headers of routes that are never cached (bootstrap, rev, mutations). */
export function setNoStore(res: Response, rev?: string | null): void {
  res.setHeader('Cache-Control', 'no-store')
  if (rev) res.setHeader(LIBRARY_REV_HEADER, rev)
}

/**
 * Answers a route that is never cached (`no-store`, no ETag, server-api.md
 * §3.3), with `X-Library-Rev` when the answer knows a rev. Written with
 * `res.end()` because Express's `res.json()` would add its own ETag.
 */
export function sendNoStore(
  res: Response,
  body: unknown,
  { status = 200, rev }: { status?: number; rev?: string | null } = {},
): void {
  setNoStore(res, rev)
  res.status(status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/**
 * Answers a cached read route (`collection`, `facets`, `folders`, …):
 *
 * 1. reads `currentRev` (at most one `/rev` poll every 2 s);
 * 2. answers 304 when If-None-Match carries the current ETag, without
 *    asking WordPress;
 * 3. otherwise serves the rev-keyed LRU entry, loading it on a miss.
 *
 * `route` + `query` must identify the answer exactly (the normalised query).
 */
export async function serveCachedRead<T extends { rev: string }>(
  req: Request,
  res: Response,
  route: string,
  query: string,
  load: () => Promise<T>,
): Promise<void> {
  const rev = await currentRev()
  const etag = etagFor(rev, `${route}?${query}`)
  res.setHeader('Cache-Control', 'private, no-cache')
  res.setHeader('ETag', etag)
  res.setHeader(LIBRARY_REV_HEADER, rev)
  if (matchesIfNoneMatch(req, etag)) {
    res.status(304).end()
    return
  }

  const answer = await cached(`${route}?${query}@${rev}`, load)
  res.setHeader(LIBRARY_REV_HEADER, answer.rev ?? rev)
  res.type('application/json').send(answer.body)
}

/** Clears all module state between tests. */
export function resetCacheForTests(): void {
  known = null
  revInFlight = null
  writes.responses = 0
  writes.expiries = 0
  entries.clear()
  loading.clear()
  totalBytes = 0
  knownInfo = null
  setRevObserver(observeRev)
}
