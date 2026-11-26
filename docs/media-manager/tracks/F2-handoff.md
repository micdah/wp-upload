# Track F2 (client data layer and mocks): M1 handoff

Branch `mm/f2`, from `feature/media-manager` @ e09ac4f. Scope: [F2.md](F2.md).

Everything lives in the paths F2 owns:

- `client/src/media-manager/core/data/**`;
- `client/src/media-manager/mocks/**`, except the feature files `mocks/handlers/<feature>.ts`, which
  are untouched and registered in the collector;
- `client/vite.mock.config.ts`;
- this note and `spikes/C5.md`.

## 1. What works

All commands run from the repo root unless noted.

| Command | What it shows |
|---|---|
| `npm run test -w client` | 242 Vitest tests in Node, about 2 s (section 4) |
| `npm run typecheck -w client`, `npm run check` | Clean |
| `dev/run test lint`, `dev/run test typecheck`, `dev/run test unit` | Pass in the runner |
| `cd client && npx vite build --config vite.mock.config.ts` | Writes the mock build to `dev/.build/mock-dist/`, with `mockServiceWorker.js` next to `index.html` |
| `cd client && npx vite --config vite.mock.config.ts` | Vite dev server with the mock backend: no server, no WordPress |
| `node client/src/media-manager/mocks/spikes/c5-collection-payload.ts --browser` | Spike C5's measurements |

The browser checks were run, not just built:

- **The mock build, from a sub-path.** It was served under `/wp-upload-mock/` from a local static
  server and opened in Playwright Chromium at
  `/wp-upload-mock/?view=library&mock-scenario=author,trash`:
  - the service worker registered at `/wp-upload-mock/mockServiceWorker.js` (since the M2 feel review the mock
    registers `mock-sw.js`, which keeps page loads and other origins away from MSW and then loads
    `mockServiceWorker.js`; see the M2-slice handoff §8);
  - relative `api/library/*` and `session` calls were answered;
  - placeholder renditions and the bundled sample video loaded;
  - the scenario switcher showed;
  - a reload without the parameter kept the scenario;
  - no console errors.
- **The mock dev server** swapped the entry and served the worker script.
- **The production build** (`npm run build`) contains no MSW. The only "msw" substring in it is
  `application/msword` in LegacyApp (see CR-F2-4).
- **Test mode** (section 7).

## 2. The data-layer API (`core/data`, import from `core/data`)

### Transport and errors

- **`libraryApi`** has one typed function per route in server-api.md §10. Each returns the response
  body. `downloadUrl(id, variant)` and `pluginDownloadUrl()` return relative URLs for `<a href>`.
  Upload transfers with byte progress belong to `core/uploads` (F1); `libraryApi` has the JSON
  upload routes (`uploadJobs`, `cancelUpload`, `uploadCheck`).
- **`http` and `request`** go through the existing `apiFetch`:
  - relative `api/library/...` URLs, lists joined with commas;
  - JSON in and out;
  - `X-Library-Rev` on `LibraryResponse.rev`.
- **`LibraryError`** (`status`, `code`, `details`, `kind`):
  - `kind` is one of `session | connectivity | wp-auth | plugin | action`, decided by `code`
    (server-api.md §2.2);
  - the client adds three codes of its own: `network_error`, `invalid_response` (a gateway status
    with a non-JSON body counts as connectivity), and `session_lost`;
  - it is registered as TanStack Query's `defaultError`.
- **401 pause and resume** (`sessionGate`):
  - Any 401 marks the session lost (`apiFetch` has already told the app's listener).
  - The request, and every library request after it, then waits instead of failing.
  - After re-login the app calls `sessionGate.restore()`, and everything replays: autosaves, polls,
    chunks.
  - `sessionGate.abandon()` (logout) fails the waiting requests with `session_lost`.
  - Aborts are honoured while waiting.
  - `useSessionGate()` gives the state.
- **Connectivity** (`connectivityStore`, `useConnectivity()`):
  - a `wp_unreachable`, `wp_timeout` or network error makes it `offline`; `wp_auth_failed` makes it
    `wp-auth-failed`;
  - only a probe (`rev`, `bootstrap`) or a successful mutation brings it back `online`;
  - it tracks `failures` and `nextRetryAt` for "Retrying in 15 s".

### TanStack Query setup

- **`createLibraryQueryClient()` and `<LibraryQueryProvider>`:**
  - no refetch on focus (the rev poll covers it);
  - reads retry only connectivity errors, twice;
  - mutations never retry;
  - `networkMode: 'always'`;
  - any `plugin_missing` or `plugin_incompatible` re-runs `bootstrap`.
- **`clearLibraryData(queryClient)`** is for logout.
- **Query keys** (`libraryKeys`) all start with `library`:

  | Key | Holds |
  |---|---|
  | `bootstrap`, `rev` | The two `no-store` routes |
  | `collection` and `facets` + `CollectionQuery` | A collection or its facets |
  | `items` + view + ids | One `items?ids=` chunk |
  | `item` + view + id | One item |
  | `folders` | The folder tree |
  | `usage` + id | One item's usage |
  | `trash` | The Trash summary |
  | `posts`, `jobs`, `upload-check` | Their routes |

  - `REV_DEPENDENT` lists what a new rev makes stale.
  - A feature's own key goes under `['library', '<feature>', …]`; call
    `registerRevDependent('<feature>')` in its `register()`.
- **Collection params.** `normaliseCollectionQuery(urlValues)` turns loose URL values into the
  `CollectionQuery` the server echoes, which is also the cache key:
  - invalid values fall back to their defaults;
  - in the Trash, the other filters and the sort are dropped.

  `collectionSearchParams()` leaves defaults out of the request.

### Hooks

| Hook | Returns |
|---|---|
| `useBootstrap()` | `Bootstrap`. It sets the baseline rev; `isLibraryUsable()` says whether the app runs |
| `useRevPolling()` | Polls 15 s while the page is visible, and on focus and reconnect; 15 → 30 → 60 s while offline. A changed rev invalidates (`external`). "Retry now" is its `refetch()`. Its data carries the index state |
| `useLibraryRev()` | The rev the client currently knows |
| `useCollectionRows(params, { keepPrevious? })` | A `CollectionSnapshot` (below) |
| `useItemChunks(chunks, view)` | `{ items: Map, missing, pending, fetching, errors }` for chunks of 100 or fewer ids |
| `useItem(id, view)` | One item, or `null` once missing; a tile the grid hydrated comes from cache |
| `useFacets(params)` | Facets for the same params as the collection |
| `useFolderTree({ enabled })` | The folder tree |

- **`CollectionSnapshot`** holds `rows` as a `Uint32Array`, stride 4 (spike C5). Accessors:
  `rowId`, `rowWidth`, `rowHeight`, `rowKind` (unknown codes read as `other`),
  `positionOf(snapshot, id)` (a lazy map), `idsInRange`, `allIds`, `withoutIds`, `withDimensions`.
  Structural sharing is off.
- **Chunks.** Build them with `alignedChunks(snapshot, start, end)`: blocks of 100 rows aligned to
  the collection, so the keys are stable while scrolling. `chunkIds()` chunks any id list.
- **Seeding.** Each chunk's queryFn seeds the per-id cache with `setQueryData`; a full item also
  seeds the tile cache. A chunk whose ids are all cached and none invalidated is built from the cache
  without a request (a re-sort). Ids the server reports `missing` are dropped from the cached
  collections, which then refetch.
- **The tree** has `setFolderTree()` (for a mutation's `tree`) and `applyFolderCounts()` (for
  assign's `counts`).

### The invalidation map (`invalidate.ts`)

- `applyRev(queryClient, rev, change)` is the only way a rev enters the cache:
  - the first rev seen is the baseline;
  - the same rev again does nothing;
  - a new rev invalidates exactly `INVALIDATION_MAP[change.kind]`.
- Our own mutations set the rev first, so the next poll sees no change.
- `LibraryChange` kinds:

  | Kind | Invalidates |
  |---|---|
  | `external` | Everything rev-dependent |
  | `item-meta {ids, fields}` | Collections and facets the fields can affect (search, title sort, missing alt); full items only for `post` |
  | `folder-assign {ids, folder}` | Folder views (not All files), the tree, those items |
  | `folder-tree` | The tree |
  | `folder-delete {folderIds}` | Folder views, the tree, and cached items whose folder was deleted |
  | `delete` / `restore {ids}` | Every collection and facets, the tree, the Trash summary, those items |
  | `empty-trash` | The Trash only |
  | `image {ids}` | Non-Trash collections (dimensions are in the rows), facets, those items |
  | `upload` | Non-Trash collections, facets, the tree |

### Optimistic updates (`optimistic.ts`)

- `optimistic(queryClient, { cancel, apply, run })` cancels in-flight fetches, applies the change,
  runs the mutation, and on failure rolls back and rethrows.
- Building blocks, each returning a `Rollback`:
  - `patchItems(ids, fields)` changes every cached copy; full-only fields go to full items only;
  - `removeFromCollections(ids, where)` removes ids from cached collections (membership);
  - `adjustFolderCounts(deltas)`;
  - `optimisticMove(ids, folder)`, `optimisticRemove(ids, {fromTrash})`, `optimisticRestore(ids)`;
  - `combineRollbacks()`.
- `optimisticTargets` gives the filters to cancel.
- After success, apply the response with `applyItemSnapshots()` (PATCH and batch) or
  `applyJobItem()` (an image job's `result.item`), plus `applyRev`.

### Bulk operations (`bulk.ts`, D24)

- `runChunked({ items, size, run, onProgress, signal })` runs chunks sequentially. It stops at the
  first failing chunk without throwing (the outcome has `results`, `done`, `total`, `error` and
  `aborted`), and between chunks on abort.
- Each wrapper applies every chunk's response to the cache as it arrives:

  | Wrapper | Per request |
  |---|---|
  | `bulkBatch` | 100; keeps the same-change or per-item form |
  | `bulkDelete`, `bulkRestore` | 100 |
  | `bulkAssign` | 5000; merges `previous`, `skipped` and `moved`, and applies `counts` |
  | `bulkRegenerate` | 1000; returns the job ids |
  | `emptyTrash` | Loops while `remaining > 0`, with progress of `deleted + remaining`; stops after 3 steps that delete nothing |

- `groupByPreviousFolder()` builds the Undo of an assign.

## 3. The mock backend (`mocks/`)

- **The fake** (`mocks/fake/`) is a stateful in-memory WordPress, FileBird, plugin and server:
  - `library.ts` implements every route's behaviour, `query.ts` the §6 query, `dto.ts` the DTOs,
    and `jobs.ts` time-based jobs that settle on the next request, driven by a manual clock in
    tests;
  - it is seeded from the prototype's `media.json` and `folders.json` (93 items, 16 folders, 10
    posts) plus the fixtures' item states (1009 edited, 1029 processing, 1017 and 1026 in the Trash
    scenario, 1091 the site logo);
  - `generate.ts` is a deterministic large-library generator: 50k items, 300 folders and 500 posts
    by default.
- **Renditions** point at the mock's own media route (`mock-media/<id>/<WxH>/…`), which draws SVG
  placeholders or serves an uploaded file back. Video, audio and PDF use the dev fixtures
  (`dev/fixtures/sample.*`). `?mock-images=picsum` uses real photos for feel reviews; it needs
  internet.
- **The routes** (`mocks/routes/`) cover every route of server-api.md §10 plus `session`. They behave
  like the server in front of the plugin:
  - the 401 session check;
  - the 502s when WordPress is unreachable or rejects the password;
  - 409 `plugin_incompatible` and `feature_unavailable`;
  - 400 for unknown query parameters;
  - request bodies validated against the request schemas (`details.param`);
  - every JSON response validated against the response schemas: a violation becomes a 500 and is
    reported, and the tests fail on it;
  - ETag and 304 on the cached routes;
  - a 404 `not_found` catch-all.
- **Feature tracks** add handlers in `mocks/handlers/<feature>.ts`. They run first, and should use
  `libraryRoute()` and `json()` so they get the same guards and schema checks. They read the
  running fake with `mockContext()`.
- **Scenarios** (`?mock-scenario=`): `normal`, `pro`, `per-user`, `no-filebird`, `filebird-inactive`,
  `no-plugin`, `author`, `trash`, `offline` (WordPress goes away after 4 s), `loading` (2.5 s reads),
  `empty`, `large` (50k), `indexing`, `plugin-missing`, `plugin-forbidden`, `plugin-outdated`,
  `plugin-too-new`, `plugin-update-available`, `wp-unreachable`, `wp-auth-failed`.
  - Combine them with commas: `author,trash`.
  - More knobs: `mock-items=N`, `mock-latency=ms`, `mock-images=picsum`, `mock-job-speed=x`,
    `mock-offline-after=ms`.
  - The choice is remembered for the tab, so the app's URL rewrites can drop it; set
    `?mock-scenario=normal` to reset.
- **Devtools** for e2e: `window.__wpuMock` has `setScenario`, `goOffline` and `goOnline`,
  `expireSession`, `externalEdit(id, {title, alt})` (a change elsewhere: a new rev), `library` and
  `worker`. A small scenario switcher sits in the bottom-left corner.
- **Node** (`mocks/node.ts`) is for tests:
  - `startFakeBackend(scenario, { settings, clock })`, `stopFakeBackend()`;
  - `mockFetch()` answers through the same handlers, without a service worker or network patching;
  - `manualClock()` steps time.

  `core/data/test-utils.ts` wires the data layer to it.
- **The mock build** (`client/vite.mock.config.ts`) extends `vite.config.ts` (`base: './'`):
  - it swaps `index.html`'s entry for `mocks/entry.ts`, which starts MSW, then loads `src/main.tsx`
    unchanged;
  - it serves the worker in dev and emits it into the build only;
  - output goes to `dev/.build/mock-dist/` (CR-6).

  Nothing outside `mocks/` imports the mocks, so the production build can't contain them.

### The contract suite (`mocks/contract/checks.ts`)

- `defineLibraryContract({ name, fetch, mutations })` registers about 24 data-agnostic checks:
  - schemas, the caching headers, ETag and 304;
  - default echo, stride, sort set equality, the date order with the id tiebreaker, type filtering;
  - the Trash ignoring filters, empty values counting as absent;
  - 400s with `details.param` for bad values, unknown parameters, limits and malformed ids;
  - 404 `wpu_folder_not_found`, 409 without FileBird;
  - facets against the collection, folder counts against collections;
  - items' order and `missing`, usage, posts, the trash summary, jobs `not_found`, upload/check, the
    route catch-all, PATCH body validation;
  - opt-in mutations that restore what they change: an alt round trip with `previous` and a new
    rev; folder create with auto-suffix, cycle refusal, move, assign plus Undo, subtree delete.
- `fake.contract.spec.ts` runs it against the fake in six scenarios (144 tests).
- It imports with `.ts` extensions and needs only `vitest` and `zod`. It typechecks under the
  server's tsconfig, so `server-live` can run it against the real server (CR-F2-5).

## 4. Tests

| File | Covers |
|---|---|
| `core/data/http.spec.ts` | Envelope → `LibraryError`; connectivity and probe recovery; network and proxy errors; wp-auth and plugin kinds; **401 pause and resume**: held, replayed after restore, new requests held without sending, a mutation replayed, `abandon`, abort |
| `core/data/items.spec.ts` | Snapshot accessors, `withoutIds`, chunking and alignment, **chunk seeding**: per-id cache, a full item seeds the tile, a re-sort served from cache, refetch after invalidation, `missing` dropped from collections |
| `core/data/optimistic.spec.ts` | **Optimistic rollback** of every copy on a 403; optimistic then server snapshot; full-only fields; **membership removal**: a move out of a folder (not All files) with counts and rollback, trash and restore, delete from the Trash; a late refetch can't overwrite |
| `core/data/invalidate.spec.ts` | `applyRev` baseline, no-op and new rev; the map for `external`, `item-meta` (alt, title, post), `folder-assign`, `empty-trash`, `folder-delete`; the rev poll invalidating on an external edit but not after our own mutation |
| `core/data/bulk.spec.ts` | `runChunked` order, progress, stop and abort; batch (100), the per-item form, delete with per-item failures, assign (5000) with counts and Undo grouping, regenerate (1000), empty Trash |
| `core/data/params.spec.ts` | Normalisation, the Trash, key equality, search params |
| `mocks/fake/library.spec.ts` | The fake: query, search, filters, sorts, facets, alt-only `modifiedAt`, append, attach checks, folder suffix, move, cycle, subtree delete, per-user and Pro, assign skips; jobs on a manual clock (edit, stale, upload with progress and processing); generator determinism |
| `mocks/routes.spec.ts` | **Every route in all 20 scenarios answers schema-valid**; plugin, wp, offline, no-filebird, pro, empty and indexing behaviour; 401 and login; placeholder renditions |
| `mocks/contract/fake.contract.spec.ts` | The contract suite against the fake |

All of them are Node tests (no DOM). Hooks are thin wrappers over `queryOptions` factories, and the
tests drive those factories through a real QueryClient.

## 5. Spike C5

Note: [spikes/C5.md](spikes/C5.md).

- **50k rows:** 854 kB of JSON, **235 kB with gzip** in date order. In Chromium, fetch, read, parse,
  the `Uint32Array` copy and the id map take **about 14 ms** together.
- **Decision:** one payload, no chunking; rows kept as a `Uint32Array`.
- **The ETag/304 path** saves bytes, not CPU: the cached body is still read and parsed. It rarely
  fires in a session, because the rev is in the ETag.
- **The 250 kB budget fails for the title, name and size sorts** (262–275 kB): see CR-F2-7.

## 6. Change requests

**CR-F2-1, `client/package.json` (orchestrator): scripts for the mock build.**

```diff
     "typecheck": "tsc -b --noEmit",
-    "test": "vitest run --passWithNoTests"
+    "test": "vitest run --passWithNoTests",
+    "dev:mock": "vite --config vite.mock.config.ts",
+    "build:mock": "vite build --config vite.mock.config.ts"
```

**CR-F2-2, `client/tsconfig.json` (orchestrator): typecheck the mock config.** Verified with a
temporary tsconfig: it passes.

```diff
-  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]
+  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts", "vite.mock.config.ts"]
```

**CR-F2-3, F3's `client/vitest.config.ts`.**

- Its `unit` (Node) project must include `src/media-manager/core/data/**/*.spec.ts` and
  `src/media-manager/mocks/**/*.spec.ts`. They run today under Vitest's defaults (no client config
  yet).
- For the browser project's MSW hook-up, use `startFakeBackend()` (Node) or `startMockWorker()`
  (browser) and the `handlers` export of `mocks/handlers.ts`, rather than a second set of handlers.

**CR-F2-4, F3's no-MSW guard in `server/src/app.spec.ts`.** Don't match a bare `msw`:
`application/msword` is in the legacy bundle. Match `mockServiceWorker`, the file
`mockServiceWorker.js` in `dist/`, or `setupWorker(`.

**CR-F2-5, S1's `server-live`: run the shared contract suite against the real server.** Add a file in
S1's live tests, for example `server/src/routes/library/contract.live.spec.ts`:

```ts
import { defineLibraryContract } from '../../../../client/src/media-manager/mocks/contract/checks.ts'

// Log in once, then send the session cookie with every call.
const base = process.env.WPU_APP_URL ?? 'http://localhost:3001/'
let cookie = ''
async function liveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!cookie) {
    const login = await fetch(new URL('session', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: process.env.WPU_LOGIN_USER, password: process.env.WPU_LOGIN_PASSWORD }),
    })
    cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
  }
  const headers = new Headers(init.headers)
  headers.set('Cookie', cookie)
  return fetch(new URL(`api/library/${path}`, base), { ...init, headers })
}

defineLibraryContract({ name: 'live', fetch: liveFetch, mutations: true })
```

`checks.ts` typechecks under `server/tsconfig.json` (verified). The live config must include the
file.

**CR-F2-6, D's `dev/lib/suites.sh`: e2e-mock builds the mock first.** In `suite_e2e_mock`, before
the Playwright mock project (D's):

```sh
npm run build:mock -w client   # → dev/.build/mock-dist, served at https://wpu.test/wp-upload-mock/
```

(Without CR-F2-1: `cd client && npx vite build --config vite.mock.config.ts`.) e2e can pick a
scenario per test with `?mock-scenario=…`, and drive state with `window.__wpuMock`.

**CR-F2-7, plan §9 (orchestrator, from C5): restate the collection budget.**

```diff
-| Collection payload | ≤ 250 kB gzip at 50k |
+| Collection payload | ≤ 250 kB gzip at 50k for the default sort; ≤ 300 kB for any sort |
```

Optionally, S1 sets brotli quality 5 for `api/library`:
`compression({ brotli: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } } })`. That saves
8–20 kB on most sorts for about 10 ms more CPU per 50k response.

## 7. Environment

- Docker was available. `dev/run test lint`, `typecheck` and `unit` pass.
- **`dev/run up test` builds the production image**, and with it the client's `tsc -b` over all of
  `src/`, mocks included. Its first run failed, which caught a real problem: that build stage has
  no `docs/`, and `mocks/fake/seed.ts` imported the prototype JSON. It now uses Vite `?raw` imports,
  which TypeScript treats as ambient (commit 53df623). The second run built the image and came up.
- **The mock build through the test-mode proxy:** `https://wpu.test:<port>/wp-upload-mock/` served
  `index.html` and `mockServiceWorker.js` (checked with curl and the dev CA). In Chromium, the
  service worker registered at `/wp-upload-mock/mockServiceWorker.js`, and the `large` scenario's
  50k `collection` answered in 122 ms.
- Stopped with `dev/run down`; the volumes are kept.

## 8. Deviations and notes for other tracks

- **F1 wiring:**
  - wrap the app in `<LibraryQueryProvider>`;
  - boot with `useBootstrap()` and `isLibraryUsable()`;
  - mount `useRevPolling()` in the shell;
  - after a successful re-login call `sessionGate.restore()`; on logout call
    `sessionGate.abandon()` and `clearLibraryData(queryClient)`;
  - mirror `connectivityStore` (or `useConnectivity()`) into the core store's connectivity, or read
    it directly. The data layer needs it for the rev back-off.
- **`useCollection()`** (F1) should build on `useCollectionRows()` and `positionOf()`. Tiles read
  `useItemChunks(alignedChunks(...))`.
- **Imports with `.ts` extensions** in `mocks/fake/**`, `mocks/contract/**` and the spike, so Node
  and the server can run them. The client allows them (`allowImportingTsExtensions`). The rest of the
  client follows the extensionless convention.
- **Mocks are typechecked by the image build** (the client's `tsc -b` covers `src/**`). Anything
  under `mocks/` that reaches outside `client/` and `shared/` must be a Vite `?raw` or `?url` import,
  as `seed.ts` and `browser.ts` do.
- **Requests are validated in the mock as strictly as the schemas allow.** `trash/empty` accepts any
  JSON object.
- **Mock jobs aren't limited by `UPLOAD_CONCURRENCY`**: they all run at once. The phases are
  queued 0.1–0.2 s, running (uploads at about 4 MB/s), and processing 1.5 s for images.

## 9. Open questions

1. **A cancelled upload job.** After `DELETE upload/jobs/:id`, the fake answers `not_found` on later
   polls. The contract doesn't say whether S2 keeps it as `failed` (with what code) or forgets it.
   Please decide, and add it to server-api.md §7.15.
2. **The collection budget** (CR-F2-7): accept the restated budget, or require brotli 5 from S1?
3. **The mock's default images** are local SVG placeholders: deterministic and offline. Should the
   owner's 50k feel review use `?mock-images=picsum` (real photos, needs internet)?
