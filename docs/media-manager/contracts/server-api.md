# Contract: the server's `/api/library/*` API

This is the contract between the media-manager client and the Express server. The client talks to
WordPress only through these routes (plus `session`). The server, in turn, talks to the companion plugin
through the contract in [plugin-api.md](plugin-api.md), and to WordPress core REST.

- **Status:** draft for Checkpoint 4. After approval it is frozen; only the orchestrator changes it,
  through change requests in track handoff notes (implementation plan §2).
- **Types:** every DTO and request body below is mirrored in
  [`shared/library-api.ts`](../../../shared/library-api.ts), with zod schemas in
  `shared/library-api.schema.ts` (tests and mocks only) and fixtures in `shared/fixtures/`. If this
  document and the types disagree, this document wins and the types get fixed.
- **Owners:** S1 (read routes, normalisation, caching, errors) and S2 (mutations, jobs, upload,
  downloads), per implementation plan §7.

## Contents

1. [Conventions](#1-conventions)
2. [Errors](#2-errors)
3. [Revision, caching and compression](#3-revision-caching-and-compression)
4. [Limits and timeouts](#4-limits-and-timeouts)
5. [Media kinds](#5-media-kinds)
6. [The collection query](#6-the-collection-query)
7. [Routes](#7-routes): [bootstrap](#71-get-bootstrap), [rev](#72-get-rev),
   [collection](#73-get-collection), [facets](#74-get-facets), [items](#75-get-items),
   [PATCH items/:id](#76-patch-itemsid), [items/batch](#77-post-itemsbatch),
   [items/delete](#78-post-itemsdelete), [usage](#79-get-usage), [posts](#710-get-posts),
   [folders](#711-folders), [image operations](#712-image-operations), [jobs](#713-get-jobs),
   [trash](#714-trash), [upload](#715-upload), [download](#716-get-itemsiddownload),
   [plugin/download](#717-get-plugindownload)
8. [DTO reference](#8-dto-reference)
9. [What the server does behind the routes](#9-what-the-server-does-behind-the-routes)
10. [Route summary](#10-route-summary)

## 1. Conventions

- **Relative URLs only.** The client calls `api/library/<route>` with no leading slash, so the app works
  at `/` and under any sub-path such as `/wp-upload/` (repo `CLAUDE.md`). Every path in this document is
  relative to `<mount>/api/library/`.
- **Session.** Every route sits behind `requireSession` (`server/src/middleware/requireSession.ts`). Without
  a valid session cookie the answer is **401 `unauthorized`**, and that is the *only* way any route under
  `/api` ever answers 401 (see §2). No route sends `WWW-Authenticate`.
- **CSRF.** `sameOriginOnly` already guards every non-GET request (403 `cross_site_request`).
- **JSON.** Request and response bodies are JSON (`Content-Type: application/json`), except the multipart
  upload routes and the two download routes. Keys are camelCase.
- **Times** are ISO 8601 UTC with whole seconds and a `Z`: `"2026-11-22T10:15:00Z"`.
- **Ids** are positive integers. Folder `0` is Uncategorized. Job ids are opaque strings (UUIDs).
- **Text** is plain text unless a field says otherwise. Titles and folder names are never HTML-entity
  encoded (the server or plugin decodes what WordPress stores). Caption and description are the *raw*
  stored values and may contain HTML; the client renders them as text in fields.
- **`rev`** is an opaque string (decimal digits). Compare it for equality only (§3).
- **Additive only.** Fields are never renamed or removed. New optional fields may appear at any time, so
  the client ignores unknown keys. Query parameters the server doesn't know are rejected (400), so typos
  surface.
- **Query lists** are comma-separated: `ids=12,15,99`. Duplicates are removed; order is kept.

## 2. Errors

### 2.1 Envelope

Every non-2xx JSON response has this body (`ApiError`):

```ts
interface ApiError {
  code: string                       // see the tables below; WordPress core codes may pass through
  message: string                    // human-readable, safe to show
  details?: Record<string, unknown>  // optional, documented per code
}
```

```json
{ "code": "wpu_stale", "message": "The image changed since you started editing. Reload it and try again.", "details": { "modifiedAt": "2026-10-02T08:41:19Z" } }
```

Per-item failures inside batch results use `ItemError` (`{code, message}`) in
`{ "id": 1003, "ok": false, "error": {…} }` entries and never fail the whole request.

**Common `details` keys:**

| Key | Where | Meaning |
|---|---|---|
| `param` | `invalid_request` | The offending parameter or body field |
| `upstreamStatus`, `upstreamCode` | every mapped upstream error | What WordPress or the plugin answered |
| `modifiedAt` | `wpu_stale` | The item's current `modifiedAt` |
| `retryAfterSeconds` | none in v1 | Reserved |

### 2.2 Codes the server produces

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | A parameter or body field is missing, malformed, out of range or over a limit (§4). `details.param` names it. Also a WordPress 400 such as `rest_invalid_param` (§2.3) |
| 400 | `invalid_json` | Malformed JSON body (existing `errorHandler`) |
| 413 | `invalid_request_body` | JSON body over `LIMITS.jsonBodyBytes` (body-parser, existing `errorHandler`) |
| 400 | `upload_error` | Multipart problem other than size (existing `errorHandler`) |
| 413 | `file_too_large` | Upload or replace file over the server's `MAX_FILE_SIZE_MB` (existing `errorHandler`) |
| 401 | `unauthorized` | No valid session. **Only** this. The client shows the session-expired dialog |
| 403 | `cross_site_request` | `sameOriginOnly` |
| 403 | `forbidden` | WordPress or the plugin refused for lack of capability (§2.3) |
| 404 | `not_found` | Unknown route under `/api` (existing catch-all), or an unknown item/job id in a path |
| 404 | `job_not_found` | `DELETE upload/jobs/:id` for an unknown or finished job |
| 404 | `plugin_not_bundled` | `plugin/download` without a bundled zip |
| 409 | `plugin_missing` | The plugin's namespace is gone (WordPress said `rest_no_route`). The client re-runs `bootstrap` |
| 409 | `plugin_incompatible` | A library route was called while `plugin.state` isn't `ok` or `update-available` |
| 409 | `feature_unavailable` | The route needs a plugin feature the installed plugin lacks (`details.feature`) |
| 500 | `internal_error` | Bug in the server (existing `errorHandler`) |
| 502 | `wp_auth_failed` | WordPress answered **401**: the Application Password is rejected |
| 502 | `wp_unreachable` | No response from WordPress (DNS, refused, reset, TLS) |
| 502 | `wp_redirect` | WordPress answered 3xx: `WP_URL` is wrong |
| 502 | `wp_unexpected_response` | A non-JSON error body (WAF, maintenance page, PHP fatal) |
| 502 | `wp_error` | WordPress answered 5xx with a core (non-`wpu_*`) code |
| 504 | `wp_timeout` | No answer within the call's timeout (§4.2) |

The client treats `wp_unreachable` and `wp_timeout` as **connectivity** problems (offline banner, back-off),
`wp_auth_failed` as the "WordPress rejected the app password" state, and everything else as an error of
that one action. It decides by `code`, never by status alone.

Plugin codes (`wpu_*`) pass through unchanged; they are listed in
[plugin-api.md §4](plugin-api.md#4-errors).

### 2.3 Mapping upstream errors (`toLibraryError()`)

`server/src/lib/library/errors.ts` exports `toLibraryError(err): {status, body: ApiError}`. It wraps
`normaliseWpError()` from `server/src/lib/wpUpload.ts` and applies these rules **top-down; the first
matching row wins**:

| # | Upstream (WordPress or plugin) | Browser gets | Notes |
|---|---|---|---|
| 1 | No response | 502 `wp_unreachable` | `normaliseWpError` already does this |
| 2 | Timeout (`ECONNABORTED`, `ETIMEDOUT`, abort by our timer) | 504 `wp_timeout` | |
| 3 | 3xx | 502 `wp_redirect` | |
| 4 | **401, any code** (including any `wpu_*`) | **502 `wp_auth_failed`** | Also calls `invalidateConnection()`. **This rule wins over every pass-through:** nothing under `/api` may answer 401 except the session check |
| 5 | 403, any code | 403 `forbidden` | `message` from upstream; `details.upstreamCode` keeps e.g. `wpu_forbidden`. Unlike today's `upstreamErrorStatus` (403 → 502), a 403 now means "this WordPress user may not do that", not "credentials rejected" |
| 6 | 404 `rest_no_route` | 409 `plugin_missing` | The namespace or route vanished |
| 7 | Any `wpu_*` code (status 400–599, after rows 4–5) | Same status, same code | Passed through. `details` = upstream `data` minus `status` |
| 8 | 409, 413, 415 with a core code | Same status, same code | e.g. `rest_upload_file_too_big` |
| 9 | Other 400 (e.g. `rest_invalid_param`) | 400 `invalid_request` | `details.upstreamCode`, plus `details.params` from WordPress's `data.params` |
| 10 | Other 404 | 404 `not_found` | e.g. `rest_post_invalid_id` |
| 11 | 5xx with a JSON body | 502 `wp_error` | `details.upstreamStatus`, `details.upstreamCode` |
| 12 | Any non-JSON body | 502 `wp_unexpected_response` | As `normaliseWpError` does today |

Rows 5–11 apply to WordPress **JSON** error bodies. A non-JSON body (a WAF page, a wrong `WP_URL` path)
on any status except 401 is row 12, so a non-JSON 403 or 404 is 502 `wp_unexpected_response`, not
`forbidden` or `not_found`; a 401 is row 4 with any body. A status no row names (405, 410, 429 with a
JSON body) is 502 `wp_error` with `details.upstreamStatus`.

The plugin never answers 401 itself (plugin-api.md §1.4); a 401 always comes from WordPress core's
Application Password check.

## 3. Revision, caching and compression

### 3.1 The library revision

The plugin keeps an option `wpu_rev` that every change to media, metadata, folders, trash or usage bumps
([plugin-api.md §6](plugin-api.md#6-the-library-revision-wpu_rev)). Every plugin response that reads
library data carries the `rev` it read *before* running its query. A response is therefore never tagged
with a newer rev than the data it holds, and a cache keyed by rev can't serve stale data under a new rev.

- The server keeps **`currentRev`**: the newest `rev` it has seen from any plugin response. It refreshes
  it from the plugin's `GET /rev` at most every **2 s** (single-flight), and immediately from every
  mutation response.
- A write through WordPress core REST (an upload) carries no rev, so after one the server's next read
  polls `GET /rev` at once instead of waiting out the 2 s. A `/rev` answer may lower `currentRev` (a
  restored database), except when a write was seen while that poll was in flight: then it only raises it.
- Every `/api/library/*` response that knows a rev sends the header **`X-Library-Rev: <rev>`**, and most
  bodies carry `rev` too.

### 3.2 Server cache (LRU)

- **Key:** route + normalised query (+ `view` and the sorted id list for `items`) + `currentRev`.
- **Cached routes:** `collection`, `facets`, `folders` (GET), `items`, `usage`, `trash` (GET), and the
  plugin's `/info` behind `bootstrap`.
- **TTL:** 30 s per entry. **Size:** at most 200 entries and 64 MB of serialised JSON (whichever comes
  first); least recently used entries go first. A new `currentRev` makes older entries unreachable; they
  age out.
- **Single-flight:** concurrent requests for the same key share one upstream call.
- **Mutations** never read the cache. After a mutation the server sets `currentRev` from the plugin's
  answer, so the next read misses.
- The cache is per process and in memory; the server stays stateless (D4).

### 3.3 HTTP caching (ETag/304)

| Routes | `Cache-Control` | ETag |
|---|---|---|
| `collection`, `facets`, `folders` (GET), `items`, `usage`, `trash` (GET) | `private, no-cache` | `W/"<rev>-<hash of the normalised query>"`. `If-None-Match` with the current tag → **304**, no body |
| `bootstrap`, `rev`, `jobs`, `upload/jobs`, `upload/check`, `posts`, all mutations | `no-store` | none |
| `items/:id/download` | `private, no-store` | none |
| `plugin/download` | `private, max-age=0, must-revalidate` | `"<bundled version>"` |

The client may keep using a 304'd body it already holds. It does not need to send `If-None-Match`; it
gets the same data from the server cache anyway.

### 3.4 Compression

- JSON responses of **1 kB or more** under `/api/library` are compressed (gzip, or brotli when the client
  accepts `br`) by the `compression` middleware (change request in the contracts handoff).
- **Not** compressed: `items/:id/download`, `plugin/download` (already-compressed files) and the upload
  routes.
- Budget: `collection` at 50k items ≤ 250 kB gzip for the default sort, ≤ 300 kB for any sort
  (implementation plan §9, spike C5).

## 4. Limits and timeouts

### 4.1 Limits

All in `LIMITS` in `shared/library-api.ts`. Over a limit → **400 `invalid_request`** with
`details.param`, except body size (413).

| Limit | Value | Applies to |
|---|---|---|
| `itemIds` | 100 | `items?ids=` |
| `batchItems` | 100 | `items/batch` (`ids` or `items`) |
| `deleteIds` | 100 | `items/delete`, `trash/restore` |
| `usageIds` | 100 | `usage?ids=` |
| `jobIds` | 100 | `jobs?ids=`, `upload/jobs?ids=` |
| `regenerateIds` | 1000 | `items/regenerate` |
| `assignIds` | 5000 | `folders/assign` |
| `postsLimit` | 20 | `posts?limit=` |
| `duplicateMatches` | 5 | matches returned by `upload/check` |
| `queryLength` | 200 characters | `q`, `posts?search=` |
| `folderNameLength` | 200 characters | folder names |
| `titleLength` / `altLength` / `captionLength` / `descriptionLength` | 1000 / 1000 / 5000 / 65535 characters | metadata fields and `appendDescription` |
| `editOps` | 20 | ops in one image edit |
| `collectionRows` | 250 000 items | `collection` (beyond: 422 `wpu_collection_too_large` from the plugin) |
| `jsonBodyBytes` | 4 MiB | every JSON body |
| Upload and replace file size | the smaller of `MAX_FILE_SIZE_MB` and WordPress's `wp_max_upload_size()` | `bootstrap.site.upload.maxBytes` reports it; the server enforces its own part (413 `file_too_large`), WordPress the rest (413 passed through) |
| `finishedJobTtlMs` | 10 minutes | finished jobs stay readable, then `not_found` |

The client chunks larger selections itself (100 per request for batch, delete and restore, sequentially,
with progress). The server does not split them.

### 4.2 Timeouts of the server's own WordPress calls

| Calls | Timeout |
|---|---|
| `GET /info`, `/rev`, `/collection`, `/facets`, `/folders`, `/usage`, `/trash`, `/wp/v2/media` hydration, `/wp/v2/search`, `/wp/v2/types` | 30 s each |
| `bootstrap`'s `/info` call | 10 s (so `bootstrap` answers quickly when WordPress hangs) |
| `/rev` behind `GET rev` | 10 s |
| Mutations (`/media/batch`, `/media/trash`, `/media/delete`, `/trash/*`, folder routes) | 60 s each; the plugin keeps each call within a 20 s budget (plugin-api.md §1.6) |
| Image operations, uploads, replace | `WP_REQUEST_TIMEOUT_MS` (default 5 min, idle timeout) — never shorter: WordPress may need minutes for sub-sizes |
| `/maintenance/step` | 30 s |

## 5. Media kinds

`kind` (`MEDIA_KINDS`) is derived from the MIME type by the plugin, with these rules in order. The
numeric code in collection rows is the position in `MEDIA_KINDS`.

| Code | Kind | MIME types |
|---|---|---|
| 0 | `image` | `image/*` except SVG |
| 1 | `svg` | `image/svg+xml` |
| 2 | `video` | `video/*` |
| 3 | `audio` | `audio/*` |
| 4 | `document` | `application/pdf`, `text/*`, `application/rtf`, `application/msword`, `application/vnd.ms-*`, `application/vnd.openxmlformats-officedocument.*`, `application/vnd.oasis.opendocument.*`, `application/vnd.apple.*` |
| 5 | `archive` | `application/zip`, `application/x-zip-compressed`, `application/x-rar-compressed`, `application/vnd.rar`, `application/x-7z-compressed`, `application/gzip`, `application/x-gzip`, `application/x-tar` |
| 6 | `other` | anything else |

Unknown codes (from a newer plugin) are treated as `other`. **Image-like** kinds (`image`, `svg`) have alt
text and count for the missing-alt filter.

## 6. The collection query

`collection` and `facets` take the same parameters. They mirror the URL state of
[interaction-spec §1](../design/interaction-spec.md#url-state) one-to-one, plus `folder=trash`
(system.md §9). The client passes its URL values straight through, leaving out defaults.

| Param | Values | Default | Meaning |
|---|---|---|---|
| `folder` | `all`, `trash`, `0`, or a folder id (`^(all\|trash\|0\|[1-9][0-9]*)$`) | `all` | All files; the Trash; Uncategorized; one FileBird folder (its own files, not subfolders) |
| `q` | 1–200 characters after trimming and collapsing whitespace | none | Search (below) |
| `type` | `image`, `video`, `audio`, `document` | none | `image` = kinds image+svg; `document` = document+archive+other |
| `alt` | `missing` | none | Image-like items whose alt text is empty after trimming |
| `size` | `gt1`, `gt5` | none | File size **>** 1 000 000 / 5 000 000 bytes |
| `orient` | `landscape`, `portrait`, `square` | none | With r = width/height: landscape r > 1.1, portrait r < 0.9, square otherwise. Items with width or height 0 never match |
| `month` | `YYYY-MM` | none | Uploaded in that month, in the **site's** time zone (as wp-admin's month dropdown) |
| `sort` | `SORT_KEYS` (below) | `date-desc` | Order |

**Rules:**

- Any other value → 400 `invalid_request` (`details.param`). An empty value (`q=`) counts as absent.
- **`folder` other than `all`/`trash` without active FileBird** → 409 `wpu_filebird_inactive`. **An
  unknown folder id** → 404 `wpu_folder_not_found` (the client falls back to All files).
- **`folder=trash`** lists trashed items, newest trash first (`trashedAt` desc, then id desc). All other
  filters and `sort` are **ignored** there (system.md §7), and the echoed `query` shows them as `null` and
  `date-desc`. Without trash enabled the Trash is usually empty, but items trashed before MEDIA_TRASH was
  turned off still show.
- Every other folder value lists items with status `inherit` or `private`, never trashed ones.
- **Search** (`q`): the text is split on whitespace into terms (more than 10 terms → 400
  `invalid_request`); every term must match (AND),
  and a term matches if it is a case-insensitive substring of **any** of: title, caption, description,
  alt text, the original file name, the stored file path, and EXIF keywords, title and caption.
- **Filters combine with AND.**
- `layout`, `density` and `item` (and `view`, until M5) are client-only URL state and are never sent.

**Sort keys** (every sort ends with the item **id** as the tiebreaker, so the order is total and stable):

| Key | Order |
|---|---|
| `date-desc` | Upload date (`post_date_gmt`) newest first, then id desc |
| `date-asc` | Upload date oldest first, then id asc |
| `title-asc` | Title A–Z (database collation, case-insensitive), then id asc |
| `name-asc` | Original file name A–Z, then id asc |
| `size-desc` | File size largest first (unknown last), then id desc |
| `size-asc` | File size smallest first (unknown last), then id asc |
| `dimensions-desc` | Pixel count (width × height) largest first (unknown last), then id desc |
| `type-asc` | MIME type A–Z, then upload date newest first, then id desc |

The response echoes the normalised query (`CollectionQuery`) with every key present:

```json
{ "folder": 0, "q": "beach", "type": "image", "alt": null, "size": null, "orient": null, "month": null, "sort": "date-desc" }
```

`folder` is echoed as `"all"`, `"trash"` or a number (0 = Uncategorized).

## 7. Routes

### 7.1 GET `bootstrap`

The first call the media manager makes after login. **Always 200**, even when WordPress is down, so the
client can always decide which screen to show (interaction-spec §13.7).

**Params:** none.

**Response:** `Bootstrap`.

```ts
interface Bootstrap {
  wp: { state: 'ok' | 'unreachable' | 'auth_failed'; message: string | null }
  plugin: PluginStatus | null   // null unless wp.state is 'ok'
  site: SiteInfo | null         // null unless plugin.state is 'ok' or 'update-available'
  rev: string | null            // null when site is null
}

interface PluginStatus {
  state: 'ok' | 'missing' | 'forbidden' | 'outdated' | 'too-new' | 'update-available'
  version: string | null        // installed WPU_VERSION; null when missing
  api: string | null            // installed WPU_API ('1.0'); null when missing
  features: string[]            // the plugin's features[]
  missingFeatures: string[]     // optional features this server wants and the plugin lacks
  required: { major: number; minMinor: number }   // PLUGIN_API_REQUIRED
  bundled: BundledPlugin | null // null without a bundled zip (dev mode, ci.yml tests)
  message: string | null        // why, for any state but 'ok'
}

interface BundledPlugin {
  version: string; api: string; features: string[]
  changelog: { version: string; date: string; changes: string[] }[]  // newer than installed; all when missing
}

interface SiteInfo {
  user: WpUser                  // { id, name, roles[], caps: WpUserCaps }
  filebird: FileBirdInfo | null // { active, version, pro, perUser }; null when not installed
  trash: TrashConfig            // { enabled, days }
  upload: UploadConfig          // { maxBytes, mimes: [{ extensions[], mime }] }
  imageSizes: ImageSizeDef[]    // [{ name, width, height, crop }]
  imageEditor: ImageEditorConfig // { mimes[], bigImageThreshold }
  index: IndexStatus            // { media: IndexPart, usage: IndexPart }
}
```

**How the states are decided.** The server calls the plugin's `GET /info` (10 s timeout):

| Outcome of `GET /info` | `wp.state` | `plugin.state` |
|---|---|---|
| No response / timeout / 5xx / 3xx / non-JSON | `unreachable` (message from §2.3's mapping) | — (`plugin: null`) |
| 401 | `auth_failed` | — |
| 404 `rest_no_route` | `ok` | `missing` |
| 403 `wpu_forbidden` | `ok` | `forbidden` (version and api from the error's `data`) |
| Other 403 | `unreachable` ("WordPress refused the request (HTTP 403)") | — |
| 200, `api` major < required major, or same major and minor < `minMinor` | `ok` | `outdated` |
| 200, `api` major > required major | `ok` | `too-new` |
| 200, compatible, and (bundled version is newer by semver, or `missingFeatures` is not empty) | `ok` | `update-available` |
| 200, compatible otherwise | `ok` | `ok` |

The 200 case parses `/info` leniently: it reads `plugin`, `version`, `api` and `features` first (the
frozen identity, plugin-api.md §3.1) and validates the rest only when the plugin is compatible.

- `PLUGIN_API_REQUIRED = {major: 1, minMinor: 0}` and `PLUGIN_FEATURES_OPTIONAL = []` live in the server
  (in S1's library code). The bundled plugin's `plugin.json` and `changelog.json` are
  read once at startup (implementation plan §2.6).
- `site.upload.maxBytes` = min(WordPress's `upload.maxBytes`, `MAX_FILE_SIZE_MB` × 1 048 576).
- When `site.index` isn't `ready`, `bootstrap` also starts the server's maintenance loop (§9.2).
- Not cached (`no-store`); `/info` itself is cached for 30 s per rev (§3.2).

**Example** (`bootstrapOk` in `shared/fixtures/bootstrap.ts`; abbreviated):

```json
{
  "wp": { "state": "ok", "message": null },
  "plugin": {
    "state": "ok", "version": "1.0.0", "api": "1.0",
    "features": ["collection", "facets", "media-batch", "trash", "usage", "image-edit", "image-regenerate", "image-replace", "folders", "folder-colors", "maintenance", "usage-visual-portfolio"],
    "missingFeatures": [], "required": { "major": 1, "minMinor": 0 },
    "bundled": { "version": "1.0.0", "api": "1.0", "features": ["…"], "changelog": [] },
    "message": null
  },
  "site": {
    "user": { "id": 2, "name": "Anna Berg", "roles": ["editor"],
      "caps": { "uploadFiles": true, "editPosts": true, "editOthersPosts": true, "deletePosts": true, "deleteOthersPosts": true, "manageOptions": false } },
    "filebird": { "active": true, "version": "6.5.9", "pro": false, "perUser": false },
    "trash": { "enabled": false, "days": 30 },
    "upload": { "maxBytes": 67108864, "mimes": [{ "extensions": ["jpg", "jpeg", "jpe"], "mime": "image/jpeg" }] },
    "imageSizes": [{ "name": "thumbnail", "width": 150, "height": 150, "crop": true }],
    "imageEditor": { "mimes": ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"], "bigImageThreshold": 2560 },
    "index": { "media": { "state": "ready", "done": 20, "total": 20 }, "usage": { "state": "ready", "done": 8, "total": 8 } }
  },
  "rev": "1795867200000"
}
```

Other examples: `bootstrapPluginMissing`, `…Forbidden`, `…Outdated`, `…TooNew`, `…UpdateAvailable`,
`bootstrapWpUnreachable`, `bootstrapWpAuthFailed`, `bootstrapAuthor`, `bootstrapTrash`,
`bootstrapFileBirdPro`, `bootstrapFileBirdPerUser`, `bootstrapNoFileBird`, `bootstrapIndexing`.

**What the client shows** (implementation plan §2.6, D9): `wp.state` `unreachable` → "WordPress
unreachable" state with retry; `auth_failed` → "WordPress rejected the app password"; `missing` →
onboarding; `forbidden` → "needs an Editor account"; `outdated` → blocking update screen with
`bundled.changelog` and `plugin/download`; `too-new` → "update the app"; `update-available` → the app,
with a dismissible notice, and features in `missingFeatures` gated off (`can()` reason "Needs plugin
x.y"); `ok` → the app.

**Errors:** only the session ones (401 `unauthorized`). Everything else is a state in the body.

### 7.2 GET `rev`

Cheap change detection. The client polls it every **15 s** while the page is visible, and on focus and
reconnect. When `rev` differs from the one it holds, it invalidates its queries (the central
`invalidate.ts` map).

**Params:** none. **Response:** `RevResponse`, `no-store`.

```json
{ "rev": "1795867200000", "index": { "media": { "state": "ready", "done": 20, "total": 20 }, "usage": { "state": "ready", "done": 8, "total": 8 } } }
```

**Errors:** §2.3 rows 1–5, 11–12; 409 `plugin_missing`, `plugin_incompatible`. The client uses its
connectivity failures (`wp_unreachable`, `wp_timeout`) to drive the offline banner.

### 7.3 GET `collection`

The whole ordered collection, as compact rows. This is the **single source of order** for the grid,
filmstrip, detail stepping, peek and Save & next.

**Params:** §6.

**Response:** `CollectionResponse`.

```ts
interface CollectionResponse {
  rev: string
  query: CollectionQuery     // normalised echo (§6)
  total: number
  rows: number[]             // [id, width, height, kindCode] × total, in order
  indexComplete: boolean     // false while the plugin's media index is still building
}
```

```json
{
  "rev": "1795867200000",
  "query": { "folder": "all", "q": null, "type": null, "alt": null, "size": null, "orient": null, "month": null, "sort": "date-desc" },
  "total": 18,
  "rows": [1029, 2560, 1207, 0, 1090, 0, 0, 3, 1092, 0, 0, 5, 1091, 512, 512, 1, "…"],
  "indexComplete": true
}
```

- `rows.length === total * 4` (`ROW_STRIDE`). Width and height are those of the file `url` points to (the
  same numbers as the item's `width`/`height`), **0 = unknown** (audio, archives, items not indexed yet).
  The client lays unknown-aspect items out as cards.
- While `indexComplete` is false, every item is still listed, but items not yet indexed have width/height
  0, sort last on size/dimensions, and may be missed by `alt`, `size`, `orient` and alt/EXIF search. The
  client shows "Indexing library…" (from `bootstrap`/`rev` index state).
- **Visibility** matches what `items` can hydrate: the plugin applies core's read rules (plugin-api.md
  §5.2), so an Author never gets rows that hydrate as `missing`. Should an id still come back in
  `missing` (deleted in between), the client drops that row and refetches `collection`.
- Caching: §3 (`private, no-cache`, ETag, LRU by rev).

**Errors:** 400 `invalid_request`; 404 `wpu_folder_not_found`; 409 `wpu_filebird_inactive`; 422
`wpu_collection_too_large`; §2.3.

### 7.4 GET `facets`

Counts for the filter bar, the chips, the months menu and the inspector's summary.

**Params:** §6 (the same values as the `collection` call they belong to).

**Response:** `Facets`.

```ts
interface Facets {
  rev: string
  query: CollectionQuery
  view: FacetCounts      // exactly the collection for this query: filter-bar summary, inspector summary
  folder: FacetCounts    // the folder alone, no other filter: type chips, missing-alt chip, alt coverage
  months: MonthCount[]   // the folder alone, newest first, only months with items: "+ Filter → Uploaded"
  indexComplete: boolean
  usageComplete: boolean // false: `unused` may be too high
}

interface FacetCounts {
  total: number
  bytes: number          // sum of file sizes (unknown sizes count 0)
  types: { image: number; video: number; audio: number; document: number }  // by TYPE_FILTERS
  missingAlt: number     // image-like items with empty alt
  unused: number         // items the usage index knows no use of
  editable: number       // items the WordPress user may edit
}
```

Example (`facetsAll`; `facetsUncategorizedMissingAlt` shows a filtered view):

```json
{
  "rev": "1795867200000",
  "query": { "folder": "all", "q": null, "type": null, "alt": null, "size": null, "orient": null, "month": null, "sort": "date-desc" },
  "view": { "total": 18, "bytes": 126891208, "types": { "image": 13, "video": 2, "audio": 1, "document": 2 }, "missingAlt": 4, "unused": 10, "editable": 18 },
  "folder": { "total": 18, "bytes": 126891208, "types": { "image": 13, "video": 2, "audio": 1, "document": 2 }, "missingAlt": 4, "unused": 10, "editable": 18 },
  "months": [{ "month": "2026-11", "count": 1 }, { "month": "2026-06", "count": 1 }, { "month": "2024-12", "count": 3 }],
  "indexComplete": true,
  "usageComplete": true
}
```

- With `folder=trash`, `view` and `folder` both describe the Trash, and `months` is empty.
- Alt coverage = `folder.types.image - folder.missingAlt` of `folder.types.image`.
- `editable` = `total` for users with `edit_others_posts`, else the user's own items.

**Errors and caching:** as `collection`.

### 7.5 GET `items`

Hydrates items by id. The grid hydrates visible rows in chunks of at most 100 (`view=tile`); the
inspector and detail mode ask for `view=full`.

**Params:**

| Param | Type | Default | Validation |
|---|---|---|---|
| `ids` | comma-separated ids | required | 1–100 distinct positive integers |
| `view` | `tile` \| `full` | `tile` | |

**Response:** `ItemsTileResponse` or `ItemsFullResponse`:

```ts
{ rev: string; items: LibraryItemTile[] | LibraryItemFull[]; missing: number[] }
```

- `items` follows the order of `ids`; `missing` lists ids that don't exist (any more) or that WordPress
  doesn't show this user. Trashed items **are** returned (with `trash` set), so the Trash view hydrates
  the same way.
- The DTOs are defined field by field in §8.1. Examples: `tileItems` and `fullItems` in
  `shared/fixtures/items.ts`.
- Source: `GET /wp/v2/media?include=<ids>&per_page=100&status=inherit,private,trash&context=view&_fields=…`
  including the plugin's `wpu` field. `context=view`, never `edit`: edit context silently drops items
  the user can't edit (research 01 §1.4). Raw title, caption and description come from `wpu.raw`.
- Caching: §3, per rev.

**Errors:** 400 `invalid_request`; §2.3.

### 7.6 PATCH `items/:id`

Autosave of one item's metadata from the inspector, and attach/detach.

**Body:** `ItemPatch`, at least one field. Unknown fields → 400.

```ts
interface ItemPatch {
  title?: string        // ≤ 1000 characters; plain text
  alt?: string          // ≤ 1000
  caption?: string      // ≤ 5000; may contain HTML
  description?: string  // ≤ 65535; may contain HTML
  post?: number | null  // attach to this post id; null detaches
}
```

**Response 200:** `ItemPatchResponse`. `previous` holds the old values of the patched fields only, so
Undo can send them back as another PATCH.

```json
{
  "rev": "1795867200001",
  "id": 1001,
  "previous": { "alt": "" },
  "item": { "title": "detail-oisin-conolly-330", "alt": "Close-up of a woven textile", "caption": "", "description": "", "post": 202, "modifiedAt": "2024-12-14T19:11:42Z" }
}
```

- Last write wins; there is no `expectedModified` on metadata.
- Changing only `alt` does not change `modifiedAt` (WordPress stores alt as post meta); the other fields
  do.
- Sent to the plugin as a one-item `POST /media/batch`; a per-item failure becomes the response error
  with its own status (`wpu_forbidden` → 403 `forbidden`, `wpu_not_found` → 404,
  `wpu_post_not_found` → 404, `wpu_invalid_parent` → 400).

**Errors:** 400 `invalid_request`; 403 `forbidden`; 404 `not_found`, `wpu_not_found`,
`wpu_post_not_found`; 400 `wpu_invalid_parent`; §2.3.

### 7.7 POST `items/batch`

Batch metadata edit (inspector with N selected) and its Undo.

**Body:** `BatchRequest`, one of two forms, each with at most 100 items:

```ts
// The same change for every id ("Editing 4 items"):
interface BatchSameRequest { ids: number[]; set: ItemPatch; appendDescription?: string }
// A different change per item (Undo restoring each previous value):
interface BatchEachRequest { items: { id: number; set: ItemPatch; appendDescription?: string }[] }
```

- `set` may be empty only when `appendDescription` is given.
- `appendDescription` adds the text as a new paragraph: the new description is the old one, trimmed of
  trailing whitespace, then `"\n\n"`, then the text; or just the text when the old one is empty. It
  can't be combined with `set.description`.
- The client sends `alt` only for image-like items ("alt text applies to image-like items only").

**Response 200:** `BatchResponse`: one result per item, in request order. Per-item failures
(`wpu_forbidden`, `wpu_not_found`, `wpu_post_not_found`, `wpu_invalid_parent`) never fail the request.

```json
{
  "rev": "1795867200002",
  "results": [
    { "id": 1002, "ok": true, "previous": { "caption": "" }, "item": { "title": "workspace-davide-ragusa-687", "alt": "", "caption": "Summer party 2025", "description": "", "post": null, "modifiedAt": "2026-11-22T12:00:04Z" } },
    { "id": 1000, "ok": false, "error": { "code": "wpu_forbidden", "message": "You can’t edit media uploaded by others." } }
  ]
}
```

The example is an Author's request: item 1000 belongs to another user (fixture `batchCaption`). For
`appendDescription`, `previous.description` holds the whole old description.

The server forwards the items to the plugin's `POST /media/batch` and re-sends any `remaining` ids (the
plugin's time budget, plugin-api.md §1.6) until none are left.

**Errors:** 400 `invalid_request` (shape, limits, more than 100 items); §2.3.

### 7.8 POST `items/delete`

Move to Trash, or delete permanently (D8; system.md §2).

**Body:** `DeleteRequest`:

```ts
{ ids: number[] /* 1–100 */; mode: 'trash' | 'delete' }
```

- `trash` needs `site.trash.enabled`; otherwise the whole request fails with **409
  `wpu_trash_disabled`**.
- `delete` deletes files and every size for good, whether the item is trashed or not. WordPress clears
  `_thumbnail_id` on posts that used the item as their featured image.

**Response 200:** `DeleteResponse`, per item in request order:

```json
{
  "rev": "1795867200003",
  "results": [
    { "id": 1017, "ok": true, "trash": { "trashedAt": "2026-11-22T12:00:03Z", "daysLeft": 30 } },
    { "id": 999999, "ok": false, "error": { "code": "wpu_not_found", "message": "Media item 999999 does not exist." } }
  ]
}
```

`trash` is set for mode `trash` and null for `delete`. Per-item errors: `wpu_forbidden` (no
`delete_post`), `wpu_not_found`. The server re-sends `remaining` ids like `items/batch`.

**Errors:** 400 `invalid_request`; 409 `wpu_trash_disabled`; §2.3.

### 7.9 GET `usage`

Where items are used: the Usage panel, the rail count, the delete confirm's where-used notice.

**Params:** `ids` (1–100 ids, required).

**Response 200:** `UsageResponse`:

```ts
interface UsageResponse {
  rev: string
  complete: boolean          // false while the usage index is building: say "may be incomplete"
  items: { id: number; count: number; refs: UsageRef[] }[]   // in request order; count = refs found (refs capped at 200)
}

interface UsageRef {         // the one unified UsageRef (implementation plan §2.1)
  postId: number | null      // null for site-level uses
  postType: string           // 'post', 'page', … or 'site'
  postTypeLabel: string      // 'Post', 'Page', … 'Site'
  title: string              // plain text; '(no title)' when empty
  status: string             // 'publish', 'draft', 'private', 'future', 'pending'
  editUrl: string | null     // null when the WordPress user can't edit it
  viewUrl: string | null     // null when not publicly viewable
  contexts: UsageContext[]   // at least one; how the item is used there
}
```

`UsageContext` is one of `featured`, `image-block`, `gallery-block`, `file-block`, `cover-block`,
`media-text`, `video-block`, `audio-block`, `content` (a URL or `wp-image-N` class in other content),
`shortcode-gallery` (`[gallery ids=…]`, or a `[gallery]` without ids, which shows a post's attached images,
D40), `visual-portfolio` (Visual Portfolio galleries and saved layouts, D22; and, as a site-level ref titled
"Visual Portfolio placeholder image", Visual Portfolio's "no image" placeholder, D44), `site-logo`,
`site-icon`. Refs are sorted: site-level refs first, then refs
with `featured`, then by post title.

```json
{
  "rev": "1795867200000",
  "complete": true,
  "items": [
    { "id": 1003, "count": 2, "refs": [
      { "postId": 205, "postType": "post", "postTypeLabel": "Post", "title": "Conference 2025 recap", "status": "publish",
        "editUrl": "https://example.com/wp-admin/post.php?post=205&action=edit", "viewUrl": "https://example.com/?p=205", "contexts": ["gallery-block"] },
      "…"
    ] },
    { "id": 1000, "count": 0, "refs": [] }
  ]
}
```

A site-level use (fixture `usageSiteLogo`):

```json
{ "postId": null, "postType": "site", "postTypeLabel": "Site", "title": "Site logo", "status": "publish",
  "editUrl": "https://example.com/wp-admin/site-editor.php", "viewUrl": "https://example.com/", "contexts": ["site-logo"] }
```

Refs to posts the user can't read (another user's private post, for an Author) appear with the title
"Private post" and both URLs null. Unknown ids are returned with `count: 0`.

**Errors:** 400 `invalid_request`; §2.3. Caching: §3.

### 7.10 GET `posts`

The post picker for Attach / Change… (inspector §5).

**Params:**

| Param | Type | Default | Validation |
|---|---|---|---|
| `search` | string | empty | ≤ 200 characters. Empty: the most recent posts |
| `limit` | integer | 10 | 1–20 |

**Response 200:** `PostsResponse` = `{ posts: PostRef[] }`.

```json
{ "posts": [
  { "postId": 208, "postType": "post", "postTypeLabel": "Post", "title": "Product launch: Outdoor line", "status": "publish",
    "editUrl": "https://example.com/wp-admin/post.php?post=208&action=edit", "viewUrl": "https://example.com/?p=208" }
] }
```

- Source: core `GET /wp/v2/search?type=post&subtype=any&search=…&per_page=…` (implementation plan §2.2).
  Core search returns only **published** entries of public post types; drafts can't be picked in v1.
  `postTypeLabel` comes from `GET /wp/v2/types` (cached 10 minutes); `editUrl` is always built as
  `<WP_URL>/wp-admin/post.php?post=<id>&action=edit` (core search can't say whether the user may edit
  the post; WordPress checks when it is opened). `attachedTo` and usage refs follow the stricter rule:
  null when the user can't edit the post.
- `no-store`.

**Errors:** 400 `invalid_request`; §2.3.

### 7.11 Folders

All folder routes need active FileBird; without it the plugin answers **409 `wpu_filebird_inactive`**.
In per-user mode (D10) the **mutations** (`POST`, `PATCH`, `DELETE`, `assign`) answer **409
`wpu_filebird_per_user`**; `GET folders` and `collection?folder=` keep working (folders.md §9).

#### GET `folders`

**Response 200:** `FolderTree`:

```ts
interface FolderTree {
  rev: string
  mode: { pro: boolean; perUser: boolean; readOnly: boolean; colorsWritable: boolean }
  folders: Folder[]                     // flat; sorted by parent, then ord, then id
  counts: { all: number; uncategorized: number }
}
interface Folder {
  id: number
  name: string          // plain text, 1–200 characters
  parent: number        // 0 = top level
  ord: number           // FileBird's sibling order
  color: string | null  // '#rrggbb'; always null unless mode.pro (Pro features are hidden on Lite)
  count: number         // files directly in it, trash excluded
}
```

```json
{
  "rev": "1795867200000",
  "mode": { "pro": false, "perUser": false, "readOnly": false, "colorsWritable": false },
  "folders": [
    { "id": 1, "name": "Brand", "parent": 0, "ord": 0, "color": null, "count": 1 },
    { "id": 4, "name": "Blog", "parent": 0, "ord": 3, "color": null, "count": 1 },
    { "id": 2, "name": "Logos", "parent": 1, "ord": 1, "color": null, "count": 1 }
  ],
  "counts": { "all": 18, "uncategorized": 2 }
}
```

- Nested counts ("count files in subfolders too") are summed by the client from `count`.
- `all` and `uncategorized` count non-trashed items.
- In per-user mode the tree is the WordPress user's own folders, and counts are relative to it.
- Sorting folders by name (Pro) is a client-side preference; the server always returns FileBird's order.
- Caching: §3.

Fixtures: `folderTree`, `folderTreePro`, `folderTreePerUser`.

#### POST `folders`

**Body:** `FolderCreateRequest` = `{ name: string; parent: number }` (`parent` 0 = top level). The name is
trimmed and inner whitespace collapsed; 1–200 characters after that.

**Response 201:** `FolderMutationResponse`:

```ts
interface FolderMutationResponse {
  rev: string
  folder: Folder              // as stored: the final name
  renamed: boolean            // the final name differs (auto-suffixed "Name (1)")
  requestedName: string | null // the name as sent (normalised); null when no name was sent
  tree: FolderTree            // the whole tree after the change, with counts
}
```

Example (`folderCreateRenamed`): `{name: "Logos", parent: 1}` where "Logos" exists → `folder.name` is
`"Logos (1)"`, `renamed: true`, `requestedName: "Logos"`. The client words its toast from these.

**Errors:** 400 `invalid_request`, `wpu_invalid_folder_name` (empty after FileBird's own sanitising);
404 `wpu_folder_not_found` (parent); 409 `wpu_folder_name_exhausted`, `wpu_filebird_inactive`,
`wpu_filebird_per_user`; §2.3.

#### PATCH `folders/:id`

**Body:** `FolderUpdateRequest`, at least one field:

```ts
{
  name?: string            // rename; auto-suffixed on a clash, like create
  parent?: number          // move under this folder (0 = top level)
  position?: number        // 0-based index among the siblings under the (new) parent, counted
                           // without the moved folder; larger = last; default: last
  color?: string | null    // '#rrggbb' or null (no colour); only when mode.colorsWritable
}
```

- `parent` and `position` together are one move. `position` alone reorders within the current parent.
- Moving a folder into itself or its subtree → 409 `wpu_folder_cycle`.
- `color` without Pro → 409 `wpu_pro_required`.
- Undo of a move: PATCH the folder back to its previous `parent` and `position`, where `position` is
  its index in the old parent's children sorted by `ord`, **counted without the folder itself** (as
  taken from the tree before the move). Undo of a rename: PATCH the previous name.

**Response 200:** `FolderMutationResponse` (above).

**Errors:** 400 `invalid_request`, `wpu_invalid_folder_name`; 404 `wpu_folder_not_found` (the folder or
the new parent); 409 `wpu_folder_cycle`,
`wpu_pro_required`, `wpu_folder_name_exhausted`, `wpu_filebird_inactive`, `wpu_filebird_per_user`; §2.3.

#### DELETE `folders/:id`

Deletes the folder **and its subtree**; their files move to Uncategorized. No media is deleted, and there
is no undo (folders.md §5).

**Response 200:** `FolderDeleteResponse`:

```json
{ "rev": "1795867200013", "deletedIds": [8, 9, 10], "movedFiles": 1, "tree": { "…": "FolderTree after the delete" } }
```

**Errors:** 404 `wpu_folder_not_found`; 409 `wpu_filebird_inactive`, `wpu_filebird_per_user`; §2.3.

#### POST `folders/assign`

Moves items into a folder (drag and drop, Move to…, remove from folder, upload filing, and their Undo).

**Body:** `FolderAssignRequest` = `{ folder: number; ids: number[] }`: `folder` 0 = Uncategorized
(remove from folder); 1–5000 ids.

**Response 200:** `FolderAssignResponse`:

```ts
interface FolderAssignResponse {
  rev: string
  previous: { id: number; folder: number }[]  // each assigned item's folder before; includes items already there
  skipped: ItemFailure[]                       // not moved: wpu_not_found, wpu_forbidden (no edit_post)
  moved: number                                // items whose folder actually changed
  counts: { all: number; uncategorized: number; byId: Record<string, number> }  // fresh direct counts
}
```

```json
{
  "rev": "1795867200005",
  "previous": [{ "id": 1002, "folder": 10 }, { "id": 1003, "folder": 6 }],
  "skipped": [{ "id": 999999, "ok": false, "error": { "code": "wpu_not_found", "message": "Media item 999999 does not exist." } }],
  "moved": 2,
  "counts": { "all": 18, "uncategorized": 2, "byId": { "6": 1, "10": 0, "15": 4, "…": 0 } }
}
```

- `moved: 0` with no `skipped` means "Already in “X”".
- Undo: group `previous` by folder and send one assign per group.

**Errors:** 400 `invalid_request`; 404 `wpu_folder_not_found`; 409 `wpu_filebird_inactive`,
`wpu_filebird_per_user`; §2.3.

### 7.12 Image operations

In-place image maintenance (D7; inspector §6). Each route validates its input **synchronously** (400),
then answers **202 `{ "jobId": "…" }`** and runs the plugin call as a job (§7.13). The plugin's errors
(`wpu_stale`, `wpu_unsupported_type`, …) arrive in `job.error`.

Jobs share the upload concurrency budget (`UPLOAD_CONCURRENCY`, `acquireSlot` in `uploadJobs.ts`): an image
job waits in `queued` until a slot is free. Most jobs hold their slot until they finish. A `regenerate` job
takes the slot per item and releases it between items (D48), so uploads waiting for a slot interleave with a
long regenerate instead of queueing behind all of it. It is `queued` until its first item gets a slot and
stays `running` from then on, also while it waits for the next item's slot.

| Route | Body | Plugin route | Job kind |
|---|---|---|---|
| `POST items/:id/edit` | `EditRequest` | `POST /media/{id}/edit` | `edit` |
| `POST items/:id/edit/undo` | `{ expectedModified }` | `POST /media/{id}/edit/undo` | `edit-undo` |
| `POST items/:id/restore` | `{ expectedModified }` | `POST /media/{id}/restore` | `restore` |
| `POST items/:id/replace` | multipart: `file` (required), `expectedModified` (required) | `POST /media/{id}/replace` | `replace` |
| `POST items/regenerate` | `{ ids: number[] }` (1–1000) | `POST /media/{id}/regenerate`, one item at a time | `regenerate` |

**`EditRequest`:**

```ts
interface EditRequest {
  ops: EditOp[]                         // 0–20, applied in order
  scale?: { width: number; height: number }  // after the ops; proportional, down only
  applyTo: 'all' | 'thumbnail' | 'nothumb'
  expectedModified: string              // the item's modifiedAt when editing started
}
type EditOp =
  | { op: 'rotate'; angle: 90 | 180 | 270 }   // clockwise
  | { op: 'flipH' } | { op: 'flipV' }          // as seen on screen
  | { op: 'crop'; x: number; y: number; width: number; height: number }  // integer px of the image as it looks after the preceding ops
```

```json
{ "ops": [{ "op": "rotate", "angle": 90 }, { "op": "crop", "x": 120, "y": 0, "width": 1334, "height": 750 }],
  "scale": { "width": 1067, "height": 600 }, "applyTo": "all", "expectedModified": "2026-10-02T08:41:19Z" }
```

- The editor sends the full recipe in the order rotate/flip → crop → scale (inspector §6). Coordinates
  refer to the file `url` points to (the `-scaled` file for big images, as wp-admin does).
- At least one op or a `scale`. Validation the server does itself: shape, limits, integer coordinates,
  `width`/`height` ≥ 1. The plugin checks bounds, proportionality and "down only" (400
  `wpu_invalid_edit`, in `job.error`).
- `expectedModified` must equal the item's current `modifiedAt`; otherwise the job fails with
  **`wpu_stale`** (status 409 in the plugin) and `details.modifiedAt`.
- `replace` keeps the id and, as far as possible, the URL: the new file must have the **same MIME type**
  (`wpu_mime_mismatch`, 415). `result.urlChanged` reports the rare case where the URL could not be kept
  (spike X3).
- `regenerate` runs its ids one by one and reports per-item results; one item failing (e.g.
  `wpu_unsupported_type` for an SVG) doesn't fail the job. Errors that mean WordPress or the plugin is
  gone (`wp_unreachable`, `wp_auth_failed`, `wp_redirect`, `plugin_missing`) fail the whole job.
- If the operation succeeded in WordPress but reading the item back failed, the job fails with that
  error and `details: {applied: true, itemId}`; the client refetches the item rather than retrying.

**Result** (in `job.result` once `succeeded`):

```ts
interface ImageJobResult { item: LibraryItemFull; sizesRegenerated: number; urlChanged: boolean }
interface RegenerateJobResult { results: ({ id: number; ok: true; sizesRegenerated: number } | ItemFailure)[] }
```

`item` is re-hydrated by the server after the plugin call (`view=full`), so the client gets the new
dimensions, sizes and flags (`edited`, `undoable`, `restorable`) in one go.

**Errors of the 202 routes themselves:** 400 `invalid_request`; 404 `not_found` (non-numeric id); 413
`file_too_large`; 409 `plugin_incompatible`, `feature_unavailable` (`image-edit`, `image-regenerate` or
`image-replace` missing); 401 session. Everything from WordPress arrives in `job.error`, mapped by §2.3.

### 7.13 GET `jobs`

Polls jobs of any kind. Image jobs: every 1.5 s. Uploads use `upload/jobs` (§7.15); both read the same
job registry.

**Params:** `ids` (1–100 job ids, required).

**Response 200:** `JobsResponse` = `{ jobs: JobLookup[] }`, in request order. `no-store`.

```ts
type JobLookup = Job | { id: string; state: 'not_found' }
type Job = UploadJob | ImageJob | RegenerateJob

interface JobCommon {
  id: string
  state: 'queued' | 'running' | 'processing' | 'succeeded' | 'failed'
  createdAt: string
  updatedAt: string
  progress: { done: number; total: number; unit: 'bytes' | 'items' } | null
  error: ApiError | null                 // set when failed; mapped by §2.3
}
interface UploadJob extends JobCommon { kind: 'upload'; filename: string; result: UploadJobResult | null }
interface ImageJob extends JobCommon { kind: 'edit' | 'edit-undo' | 'restore' | 'replace'; itemId: number; result: ImageJobResult | null }
interface RegenerateJob extends JobCommon { kind: 'regenerate'; itemIds: number[]; result: RegenerateJobResult | null }
```

| State | Meaning |
|---|---|
| `queued` | Waiting for a concurrency slot (regenerate: for its first item's; §7.12) |
| `running` | Talking to WordPress. Uploads: sending bytes (`progress` in bytes). Regenerate: `progress` in items |
| `processing` | Uploads only: every byte is sent and WordPress is generating sub-sizes ("Processing"; after 8 s the client says "Still processing…") |
| `succeeded` | `result` is set |
| `failed` | `error` is set |

- Finished jobs stay readable for 10 minutes, then read `not_found`. A server restart loses all jobs
  (they read `not_found`); the client says it lost track and refetches the item.
- Example: `jobsEveryState` in `shared/fixtures/jobs.ts` (one job per state, plus `not_found`).

**Errors:** 400 `invalid_request`.

### 7.14 Trash

Only meaningful when `site.trash.enabled`, but the routes work regardless (items trashed before the
constant changed can still be restored or deleted).

#### GET `trash`

**Response 200:** `TrashSummary` = `{ rev, enabled, days, count, bytes }`: the Trash row's count in the
folder column, and the purge notice ("deleted after 30 days").

```json
{ "rev": "1795867200000", "enabled": true, "days": 30, "count": 2, "bytes": 2241760 }
```

The Trash view itself is `collection?folder=trash` plus `items?ids=` (every row hydrates as a
`TrashItem`: a `LibraryItemTile` whose `trash` is set). Caching: §3.

#### POST `trash/restore`

**Body:** `{ ids: number[] }` (1–100). Restores items to where they were: WordPress's own untrash, and
FileBird keeps the folder while an item is trashed.

**Response 200:** `RestoreResponse`, per item: `{ id, ok: true, folder: number | null }` or an
`ItemFailure` (`wpu_not_found`, `wpu_forbidden`, `wpu_not_trashed`).

```json
{ "rev": "1795867200006", "results": [{ "id": 1017, "ok": true, "folder": 12 }, { "id": 1026, "ok": true, "folder": 6 }] }
```

The server re-sends the plugin's `remaining` ids like `items/batch`.

#### POST `trash/empty`

Deletes trashed items permanently, oldest first, in **one time-budgeted step** (about 10 s). The client
calls it again while `remaining > 0`, showing progress.

**Body:** none (or `{}`). **Response 200:** `EmptyTrashResponse`:

```json
{ "rev": "1795867200007", "deleted": 1, "remaining": 1, "skipped": 0 }
```

`skipped` counts trashed items this user may not delete (an Author and others' items); they stay.

**Errors (all three):** 400 `invalid_request`; §2.3.

### 7.15 Upload

These reuse the server's `uploadJobs.ts` internals (streamed multipart to `POST /wp/v2/media`, the
concurrency gate, background jobs). The client's transport is `core/uploads`.

#### POST `upload`

**Body:** `multipart/form-data`:

| Field | Required | Meaning |
|---|---|---|
| `file` | yes | The file. UTF-8 file names are kept (`defParamCharset: 'utf8'`) |
| `folder` | no | Folder id to file it in. Absent, empty or `0` = Uncategorized. Without active FileBird the field is ignored and `result.folder` is null |

**Response 202:** `{ "jobId": "6f1c2a4e-…" }`, as soon as the file is on the server's disk.

- The job uploads to WordPress, then (when `folder` > 0) files the item through the plugin's
  `POST /folders/assign` (or `?fbv=` on the upload, if spike X6 succeeds), then hydrates the new item.
- A filing failure doesn't fail the upload: `result.folder = { id, assigned: false, message }`.
- In per-user mode filing is skipped and reported the same way (`assigned: false`).
- If the upload succeeded in WordPress but reading the new item back failed, the job fails with that
  error and `details: {applied: true, itemId}`; the client refetches the item rather than retrying (a
  retried upload would create a duplicate).

**Errors:** 400 `upload_error` (no `file`); 413 `file_too_large`; 400 `invalid_request` (`folder` not a
non-negative integer); 409 `plugin_incompatible`; 401 session.

#### GET `upload/jobs`

**Params:** `ids` (1–100). **Response 200:** `JobsResponse`, like `jobs`, but only upload jobs are found
(other kinds read `not_found`). The client polls every 1 s while uploads run.

```json
{ "jobs": [
  { "id": "6f1c2a4e-…-0a02", "kind": "upload", "state": "running", "createdAt": "2026-11-22T11:59:50Z", "updatedAt": "2026-11-22T11:59:57Z",
    "progress": { "done": 1572864, "total": 4194304, "unit": "bytes" }, "error": null, "filename": "team-offsite.png", "result": null },
  { "id": "d0000000-…-0009", "state": "not_found" }
] }
```

A succeeded upload's `result` is `{ item: LibraryItemTile, folder: FolderAssignment | null }`
(`jobUploadSucceeded`).

#### DELETE `upload/jobs/:id`

Cancels an upload: a queued job never starts; a running one is aborted (WordPress may already have
created the item). **204**, or **404 `job_not_found`**. A cancelled job is forgotten at once: later polls
read it as `not_found`.

#### GET `upload/check`

Duplicate check before queueing a file (best effort, as today's `media/check`).

**Params:** `filename` (required, 1–255 characters).

**Response 200:** `UploadCheckResponse`:

```json
{ "duplicate": true, "matches": [{ "id": 1091, "title": "logo-mark", "filename": "logo-mark.svg", "thumb": null }] }
```

At most 5 matches. `no-store`.

**Errors:** 400 `invalid_request`; §2.3.

### 7.16 GET `items/:id/download`

Downloads an item's file through the server, so the browser saves it under its real name (`<a download>`
is ignored cross-origin).

**Params:** `variant` = `file` (default: the file `url` points to) or `original` (the untouched upload;
falls back to `file` when there is none).

**Response 200:** the file, streamed:

```
Content-Type: <the item's MIME type>
Content-Length: <bytes, when WordPress sends it>
Content-Disposition: attachment; filename="beach.jpg"; filename*=UTF-8''beach.jpg
Cache-Control: private, no-store
```

- The server looks the item up (as `items`), then streams the file URL WordPress reports. It follows at
  most 3 redirects and only fetches `http(s)` URLs that came from WordPress's own response. The file is
  fetched without WordPress credentials (`source_url` is often on a CDN).
- The download name is the original file name, or for `file` of a `-scaled` image, its actual basename.

**Errors:** 404 `not_found` (unknown or not visible); 502 `wp_unreachable` / 504 `wp_timeout` when the
file can't be fetched; 502 `wp_unexpected_response` when the file server sends a header the server can't
pass on; §2.3.

### 7.17 GET `plugin/download`

The companion plugin zip bundled in the app's image (D12), for onboarding and the update screens.

**Response 200:** the zip:

```
Content-Type: application/zip
Content-Disposition: attachment; filename="wp-upload-companion-1.0.0.zip"
ETag: "1.0.0"
```

**Errors:** **404 `plugin_not_bundled`** when the image has no bundled zip (dev mode before a build,
`ci.yml`'s server tests).

## 8. DTO reference

All types are in `shared/library-api.ts`; this section says where each field comes from.

### 8.1 `LibraryItem` (tile and full)

`LibraryItemTile` (`view: "tile"`) carries what the grid, filmstrip, peek, selection and drag preview
need. `LibraryItemFull` (`view: "full"`) adds what the inspector and detail mode need. Both share these
fields:

| Field | Type | Source and rules |
|---|---|---|
| `id` | number | `id` |
| `view` | `'tile'` \| `'full'` | which view this is |
| `kind` | `MediaKind` | `wpu.kind` (§5) |
| `mime` | string | `mime_type` |
| `title` | string | `wpu.raw.title` (plain text) |
| `filename` | string | `filename` (7.0+): the **original** upload's basename, never `-scaled` |
| `width`, `height` | number | `wpu.width`, `wpu.height`: the same numbers as the collection rows. Images: the file `url` points to. Video: its frame size. PDF: the preview image. 0 = unknown |
| `filesize` | number \| null | `wpu.filesize`: bytes of the file `url` points to |
| `alt` | string | `alt_text`; `''` when none |
| `uploadedAt` | string | `date_gmt` + `Z` |
| `modifiedAt` | string | `modified_gmt` + `Z`. Used as `expectedModified` |
| `authorId` | number | `author` (0 when the item has no author) |
| `folder` | number \| null | `wpu.folder`: 0 = Uncategorized, null without active FileBird |
| `url` | string | `source_url` |
| `thumb` | `ImageSource` \| null | `media_details.sizes.thumbnail` (usually a 150 px square crop) |
| `srcset` | `ImageSource[]` | every **uncropped** size in `media_details.sizes` plus the full file, ascending by width, each file once. Empty for items without image renditions. PDFs: the preview sizes |
| `poster` | `ImageSource` \| null | `wpu.poster`: a video's or audio's cover image (`featured_media`), medium-large size |
| `duration` | number \| null | `wpu.duration` (seconds), video and audio |
| `pages` | number \| null | `wpu.pages`: PDF page count when known |
| `sizesPending` | boolean | `wpu.sizesPending`: registered sub-sizes are still missing (the "Processing" badge) |
| `perms` | `{edit, delete}` | `wpu.perms`: `edit_post` / `delete_post` for this user |
| `trash` | `{trashedAt, daysLeft}` \| null | `wpu.trashedAt`; `daysLeft` = `site.trash.days` (`EMPTY_TRASH_DAYS`) − whole days since, at least 0; null only when `EMPTY_TRASH_DAYS` is 0 (WordPress then never purges). WordPress's daily purge runs whether or not `MEDIA_TRASH` is on |

`LibraryItemFull` adds:

| Field | Type | Source and rules |
|---|---|---|
| `caption`, `description` | string | `wpu.raw.caption`, `wpu.raw.description` (raw, may contain HTML) |
| `author` | `{id, name}` | `wpu.author` |
| `attachedTo` | `PostRef` \| null | `post` + `_embedded["wp:attached-to"]` (or one `GET /wp/v2/posts/{id}`); null when 0 |
| `original` | `{url, width, height, filename}` \| null | `wpu.original`: the untouched upload when WordPress scaled (`-scaled`) or rotated it |
| `sizes` | `NamedSize[]` | every entry of `media_details.sizes` (`name`, `url`, `width`, `height`, `mime`, `filesize`), in the order of `bootstrap.site.imageSizes` (the registered sizes), then other sizes by pixel count, ending with `full`. A PDF's `full.filesize` is null (REST replaces that entry with the PDF's MIME type and no size). SVG: just `full`. Video, audio, archives: `[]` |
| `exif` | `ExifInfo` \| null | `media_details.image_meta` (images only; null when it has no useful value). `shutter` is formatted from `shutter_speed` ("1/60", "2s"); `takenAt` from `created_timestamp`; `lens` from the plugin's `lens` key when present |
| `media` | `MediaFileInfo` \| null | video/audio `media_details`: `fileformat`, `codec`/`dataformat`, `bitrate`, `sample_rate`, `channels` |
| `edited`, `undoable`, `restorable` | boolean | `wpu.edited` (edited in place), `wpu.undoable` (the last plugin edit can be undone), `wpu.restorable` (an original backup exists) |
| `editedAt` | string \| null | `wpu.editedAt`: when it was last edited in place (the inspector's "edited on"); null if never |
| `usageCount` | number \| null | `wpu.usageCount`; null while the usage index doesn't cover the item |
| `links` | `{edit, view}` | `edit`: `<WP_URL>/wp-admin/post.php?post=<id>&action=edit`; `view`: null for now. REST's `link` is `?attachment_id=N` whether or not the site has attachment pages, so the server can't tell; a plugin signal (`/info.attachmentPages`) is an open owner decision |

Examples: `shared/fixtures/items.ts`. Tile of a big image (item 1000):

```json
{
  "id": 1000, "view": "tile", "kind": "image", "mime": "image/jpeg",
  "title": "still-life-joshua-earle-548", "filename": "still-life-joshua-earle-548.jpg",
  "width": 2560, "height": 1706, "filesize": 1290746,
  "alt": "Sample still life photograph by Joshua Earle",
  "uploadedAt": "2024-12-09T19:36:02Z", "modifiedAt": "2024-12-09T19:36:02Z",
  "authorId": 1, "folder": 5,
  "url": "https://example.com/wp-content/uploads/2024/12/still-life-joshua-earle-548-scaled.jpg",
  "thumb": { "url": "https://example.com/wp-content/uploads/2024/12/still-life-joshua-earle-548-150x150.jpg", "width": 150, "height": 150 },
  "srcset": [
    { "url": "https://example.com/wp-content/uploads/2024/12/still-life-joshua-earle-548-300x200.jpg", "width": 300, "height": 200 },
    { "url": "https://example.com/wp-content/uploads/2024/12/still-life-joshua-earle-548-768x512.jpg", "width": 768, "height": 512 },
    { "url": "https://example.com/wp-content/uploads/2024/12/still-life-joshua-earle-548-1024x682.jpg", "width": 1024, "height": 682 },
    { "url": "https://example.com/wp-content/uploads/2024/12/still-life-joshua-earle-548-1536x1024.jpg", "width": 1536, "height": 1024 },
    { "url": "https://example.com/wp-content/uploads/2024/12/still-life-joshua-earle-548-2048x1365.jpg", "width": 2048, "height": 1365 },
    { "url": "https://example.com/wp-content/uploads/2024/12/still-life-joshua-earle-548-scaled.jpg", "width": 2560, "height": 1706 }
  ],
  "poster": null, "duration": null, "pages": null, "sizesPending": false,
  "perms": { "edit": true, "delete": true }, "trash": null
}
```

A video tile (item 1086): `"kind": "video"`, `"thumb": null`, `"srcset": []`,
`"poster": { "url": "https://example.com/wp-content/uploads/2025/06/studio-tour-poster-768x432.jpg", "width": 768, "height": 432 }`,
`"duration": 94`.

The full view of an edited, attached, scaled image (item 1009) adds:

```json
{
  "caption": "", "description": "",
  "author": { "id": 1, "name": "Site Admin" },
  "attachedTo": { "postId": 203, "postType": "page", "postTypeLabel": "Page", "title": "About us", "status": "publish",
    "editUrl": "https://example.com/wp-admin/post.php?post=203&action=edit", "viewUrl": "https://example.com/?p=203" },
  "original": { "url": "https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314.jpg", "width": 4608, "height": 3072, "filename": "travel-fre-sonneveld-314.jpg" },
  "sizes": [
    { "name": "thumbnail", "url": "https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-150x150.jpg", "width": 150, "height": 150, "mime": "image/jpeg", "filesize": 8262 },
    { "name": "full", "url": "https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314-scaled.jpg", "width": 2560, "height": 1707, "mime": "image/jpeg", "filesize": 1604636 }
  ],
  "exif": { "camera": "iPhone 15 Pro", "lens": "Main camera 6.86mm f/1.78", "focalLength": 85, "aperture": 8, "shutter": "1/1000", "iso": 200,
    "takenAt": "2025-04-06T05:43:26Z", "credit": "Fré Sonneveld", "copyright": null, "keywords": [] },
  "media": null,
  "edited": true, "editedAt": "2026-10-02T08:41:19Z", "undoable": true, "restorable": true,
  "usageCount": 3,
  "links": { "edit": "https://example.com/wp-admin/post.php?post=1009&action=edit", "view": null }
}
```

**Image URLs after an edit.** Image operations keep the file URL (§7.12), so a browser or CDN may still
hold the old image. The client appends `?v=<modifiedAt as Unix seconds>` to every rendition it
*displays* (never to URLs it copies or shows), so a changed item is fetched afresh.

**The "Processing" state.** `sizesPending: true` means the item exists but WordPress hasn't made every
sub-size yet (an upload still processing, or interrupted). The client shows the Processing badge and
disables image-edit actions until it turns false (system.md §1). Upload *progress* before the item exists
is not part of `LibraryItem`; it lives in `UploadJob` and the client's tile upload state
`{phase, progress, error, previewUrl}`.

### 8.2 `TrashItem`

`LibraryItemTile` with `trash: { trashedAt: string; daysLeft: number | null }` always set. Fixture:
`trashItems`.

### 8.3 `PostRef` and `UsageRef`

`PostRef` = `{ postId, postType, postTypeLabel, title, status, editUrl, viewUrl }` (§7.10).
`UsageRef` = the same fields with `postId: number | null`, plus `contexts` (§7.9). Both use one shape so
the Usage panel, the delete confirm and the post picker render posts the same way.

### 8.4 `FolderTree`, `Facets`, `Bootstrap`, `Job`

Defined in §7.11, §7.4, §7.1 and §7.13.

## 9. What the server does behind the routes

### 9.1 Module layout (implementation plan §4)

- `server/src/routes/library/index.ts` mounts one router per area under `/api/library` (after
  `requireSession`, before the `/api` 404 catch-all), with `express.json({ limit: '4mb' })`.
- `lib/library/pluginClient.ts`: typed calls to `wp-upload/v1` over `wpAxios` (types from
  `shared/plugin-api.ts`), with the timeouts of §4.2. It sends real `PATCH`/`DELETE`, and retries once
  with `X-HTTP-Method-Override` on a 405 (some hosts block those methods).
- `lib/library/errors.ts`: `toLibraryError()` (§2.3).
- `lib/library/cache.ts`: the rev-keyed LRU with single-flight (§3).
- `lib/library/jobs.ts`: the job registry for image jobs, extending the upload job model (§7.13).
- `lib/library/normalise/<area>.ts`: WordPress/plugin → DTO mapping.

### 9.2 Maintenance loop

The plugin's indexes are kept current by hooks, but are built (first install) and repaired (after the
plugin was deactivated) by `POST /maintenance/step` (plugin-api.md §5.21). The server drives it, not
WP-Cron:

- When `bootstrap` or `rev` sees `index.media.state` or `index.usage.state` other than `ready`, the server
  starts **one** background loop per process (single-flight). It also runs the loop once after the
  first successful `bootstrap` of each process, whatever the state says: a step is cheap when
  nothing is left, and it catches gaps the plugin couldn't flag itself (plugin-api.md §9.3).
- The loop calls `/maintenance/step` with `budgetMs: 5000`, waits 250 ms, and repeats while `more` is
  true. It updates `currentRev` from each answer.
- It stops when `more` is false, after 3 consecutive errors (it restarts on the next trigger), or when the
  plugin answers `locked: true` five times in a row (another server is running it).
- It also stops after 5 steps in a row that did nothing (`did` all zero, not locked) although `more` was
  true. After that, neither `bootstrap` nor `rev` restarts it for 10 minutes, so a plugin that keeps
  saying `more` isn't stepped forever.

### 9.3 Plugin version check

§7.1. The bundled plugin's `plugin.json` (`{version, api, features}`) and `changelog.json` are read at
startup from the image (path decided by the orchestrator's Dockerfile change). Without them
`plugin.bundled` is null, the checks use only `PLUGIN_API_REQUIRED`, and `plugin/download` answers 404.

### 9.4 Guards

Every library route except `bootstrap` and `plugin/download` checks the last known plugin state (from
the most recent `/info`, refreshed by `bootstrap` and at most every 5 minutes): when it isn't `ok` or
`update-available` the route answers **409 `plugin_incompatible`**, and routes needing an optional
feature the plugin lacks answer **409 `feature_unavailable`** with `details.feature`.

## 10. Route summary

Relative to `<mount>/api/library/`.

| Method | Route | Request | Response | Owner |
|---|---|---|---|---|
| GET | `bootstrap` | — | 200 `Bootstrap` (always) | S1 |
| GET | `rev` | — | 200 `RevResponse` | S1 |
| GET | `collection` | §6 params | 200 `CollectionResponse` | S1 |
| GET | `facets` | §6 params | 200 `Facets` | S1 |
| GET | `items` | `ids`, `view` | 200 `ItemsTileResponse` \| `ItemsFullResponse` | S1 |
| PATCH | `items/:id` | `ItemPatch` | 200 `ItemPatchResponse` | S1 |
| POST | `items/batch` | `BatchRequest` | 200 `BatchResponse` | S2 |
| POST | `items/delete` | `DeleteRequest` | 200 `DeleteResponse` | S2 |
| POST | `items/:id/edit` | `EditRequest` | 202 `JobAccepted` | S2 |
| POST | `items/:id/edit/undo` | `ExpectedModified` | 202 `JobAccepted` | S2 |
| POST | `items/:id/restore` | `ExpectedModified` | 202 `JobAccepted` | S2 |
| POST | `items/:id/replace` | multipart `file`, `expectedModified` | 202 `JobAccepted` | S2 |
| POST | `items/regenerate` | `RegenerateRequest` | 202 `JobAccepted` | S2 |
| GET | `items/:id/download` | `variant` | 200 file | S2 |
| GET | `jobs` | `ids` | 200 `JobsResponse` | S2 |
| GET | `usage` | `ids` | 200 `UsageResponse` | S2 |
| GET | `posts` | `search`, `limit` | 200 `PostsResponse` | S2 |
| GET | `folders` | — | 200 `FolderTree` | S1 |
| POST | `folders` | `FolderCreateRequest` | 201 `FolderMutationResponse` | S1 |
| PATCH | `folders/:id` | `FolderUpdateRequest` | 200 `FolderMutationResponse` | S1 |
| DELETE | `folders/:id` | — | 200 `FolderDeleteResponse` | S1 |
| POST | `folders/assign` | `FolderAssignRequest` | 200 `FolderAssignResponse` | S1 |
| GET | `trash` | — | 200 `TrashSummary` | S2 |
| POST | `trash/restore` | `RestoreRequest` | 200 `RestoreResponse` | S2 |
| POST | `trash/empty` | — | 200 `EmptyTrashResponse` | S2 |
| POST | `upload` | multipart `file`, `folder` | 202 `JobAccepted` | S2 |
| GET | `upload/jobs` | `ids` | 200 `JobsResponse` | S2 |
| DELETE | `upload/jobs/:id` | — | 204 | S2 |
| GET | `upload/check` | `filename` | 200 `UploadCheckResponse` | S2 |
| GET | `plugin/download` | — | 200 zip | S2 |
