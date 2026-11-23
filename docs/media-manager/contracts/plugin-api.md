# Contract: the companion plugin's `wp-upload/v1` REST API

The companion plugin (`wp-upload-companion`) is the media manager's only way to do SQL on the WordPress
side (D1b, D4). The Express server is its only client: the browser never calls it. This document is the
complete contract between the two.

- **Status:** draft for Checkpoint 4. After approval it is frozen; only the orchestrator changes it,
  through change requests in track handoff notes (implementation plan §2).
- **Types:** the wire types are in [`shared/plugin-api.ts`](../../../shared/plugin-api.ts). Responses that
  are identical to the server's (collection, facets, folders, usage, trash) reuse the types in
  [`shared/library-api.ts`](../../../shared/library-api.ts); zod schemas are in
  `shared/library-api.schema.ts`. If this document and the types disagree, this document wins.
- **Owners:** P1 (info, rev, collection, facets, folders, maintenance, the `wpu` field, `MediaIndex`,
  `wpu_rev`, the FileBird adapter, the build) and P2 (media batch, trash, usage, image operations,
  `UsageIndex`), per implementation plan §7. The route table in §12 names the owner of every route.
- **Server side:** how the server maps these routes and errors to `/api/library/*` is in
  [server-api.md](server-api.md).

## Contents

1. [General rules](#1-general-rules)
2. [Versioning](#2-versioning)
3. [`GET /info`](#3-get-info)
4. [Errors](#4-errors)
5. [Routes](#5-routes)
6. [The library revision (`wpu_rev`)](#6-the-library-revision-wpu_rev)
7. [The `wpu` field on `/wp/v2/media`](#7-the-wpu-field-on-wpv2media)
8. [Tables and options](#8-tables-and-options)
9. [Install modes, schema and deactivation](#9-install-modes-schema-and-deactivation)
10. [FileBird integration](#10-filebird-integration)
11. [Security](#11-security)
12. [Route summary](#12-route-summary)

## 1. General rules

### 1.1 Namespace and transport

- Base: `<WP_URL>/wp-json/wp-upload/v1` (`PLUGIN_NAMESPACE`). Every path below is relative to it.
- Authentication is WordPress's own: the server sends its Application Password as HTTP Basic auth, as it
  does today. The plugin adds no nonce, key or other credential of its own.
- Request bodies are JSON (`Content-Type: application/json`), except `POST /media/{id}/replace`
  (multipart).
- `PATCH` and `DELETE` routes are registered with `WP_REST_Server::EDITABLE` / `DELETABLE`, so WordPress
  also accepts them as `POST` with `X-HTTP-Method-Override` (for hosts that block those methods).
- Responses are JSON. Errors are `WP_Error`s as WordPress serialises them:
  `{"code": "wpu_…", "message": "…", "data": {"status": 409, …}}` (§4).

### 1.2 Conventions

- JSON keys are camelCase (unlike core REST).
- Times are ISO 8601 UTC with whole seconds and a `Z`: `"2026-11-22T10:15:00Z"`, built from the `*_gmt`
  columns.
- Ids are integers. Folder `0` means Uncategorized; there is no folder `-1` in this API (All files is
  `folder=all`).
- Text is plain text: titles and folder names are HTML-entity **decoded** before they are returned
  (WordPress's kses stores `Tom &amp; Jerry`; the API returns `Tom & Jerry`). Caption and description are
  the raw stored values.
- `rev` is a string of decimal digits (§6).
- Lists in query strings are comma-separated (`ids=1,2,3`).
- Unknown body fields are rejected (400 `wpu_invalid_param`), so typos surface. Unknown query parameters
  are ignored (WordPress adds its own, e.g. `_locale`).

### 1.3 Capabilities

- **Baseline:** every route's `permission_callback` requires `current_user_can('upload_files')`.
  Without it, the answer is **403 `wpu_forbidden`** (for `GET /info` with identification data, §3.3).
- **Per item:** routes that change an item check `edit_post` (metadata, folders assign, image
  operations) or `delete_post` (trash, delete, restore) **for that item**. A batch route reports a
  missing capability per item (`wpu_forbidden` in that item's result) and **never fails the whole
  request with 403**.
- **Attaching** (`set.post`) also needs `edit_post` on the target post.
- Reads list every attachment, as wp-admin's Media Library does for any user with `upload_files`;
  `perms` tells the client what it may change.

### 1.4 The plugin never answers 401

A `permission_callback` that returns `false` makes WordPress answer 401 `rest_forbidden` for a logged-out
request. The plugin's callbacks therefore always return a `WP_Error` with **status 403** instead. A 401
from WordPress means core rejected the Application Password, and the server maps it to
`wp_auth_failed` (server-api.md §2.3).

### 1.5 Per-item results

Batch routes answer **200** with one result per requested id, in request order:

```json
{ "id": 1017, "ok": true, "…": "route-specific fields" }
{ "id": 999999, "ok": false, "error": { "code": "wpu_not_found", "message": "Media item 999999 does not exist." } }
```

A request-level problem (malformed body, too many ids, FileBird inactive, trash disabled) fails the
whole request with the matching 4xx error instead.

### 1.6 Time budgets

Shared hosts cap PHP execution time, so long routes bound their own work:

| Route | Budget | Behaviour |
|---|---|---|
| `/media/batch`, `/media/trash`, `/media/delete`, `/trash/restore` | 20 s (`WPU_BATCH_BUDGET_MS`) | Stops *starting* items once the budget is spent; unprocessed ids come back in `remaining` (in request order). The caller sends them again. |
| `/trash/empty` | `budgetMs`, default 10 000, 100–20 000 | Deletes oldest-trashed first until the budget is spent; reports `remaining` |
| `/maintenance/step` | `budgetMs`, default 5000, 100–20 000 | Indexes until the budget is spent; reports `more` |
| `/media/{id}/edit`, `/edit/undo`, `/restore`, `/regenerate`, `/replace` | none | One item, synchronous, can take minutes (WordPress makes every sub-size). Calls `wp_raise_memory_limit('image')` and `set_time_limit(0)` where allowed. The server calls them from a job with a long timeout |
| `/collection`, `/facets`, `/folders` | none | Must be fast: p95 ≤ 300 ms at 50k attachments (implementation plan §9) |

### 1.7 Read the revision first

Every response that reads library data includes `rev`. The route reads `wpu_rev` **before** it runs its
queries, so a response is never tagged with a newer rev than its data (the server caches by rev).
Mutation responses report the rev **after** the change.

### 1.8 FileBird

FileBird is optional. The plugin **never modifies FileBird** (D17): no schema or index changes, no direct
writes to its tables or options. Folder mutations go only through FileBird's own PHP functions, so its
hooks fire. Reads may query FileBird's tables read-only. Details in §10.

## 2. Versioning

### 2.1 Two numbers

| Constant | Where | Format | Names |
|---|---|---|---|
| `WPU_VERSION` | the plugin header's `Version:` and the constant | semver, e.g. `1.0.0` (pre-releases `1.0.0-dev.3`) | the release |
| `WPU_API` | constant | `major.minor`, e.g. `1.0` | the contract level of this document |

Both live in the entry file `plugin/wp-upload-companion/wp-upload-companion.php`, which only the
orchestrator edits. Tracks never bump them (implementation plan §2.6). This document describes
**API 1.0**; the first release is `1.0.0`.

**Minimum versions:** the header declares `Requires at least: 7.0` (the REST `filename` field and the
6.9 `wp:attached-to` link the server relies on) and `Requires PHP: 8.1` (CI lints 8.1 and 8.4).
WordPress enforces them when the plugin is activated. A mu-plugin isn't checked by WordPress, so the
plugin checks itself on load: below either minimum it registers **no routes** and logs why, so the
server reports `plugin.state: "missing"` and onboarding names the minimums.

### 2.2 `features[]`

`/info` lists the optional capabilities this build has (`PLUGIN_FEATURES` in `shared/library-api.ts`):

| Feature | Routes |
|---|---|
| `collection` | `GET /collection` |
| `facets` | `GET /facets` |
| `media-batch` | `POST /media/batch` |
| `trash` | `POST /media/trash`, `POST /media/delete`, `GET /trash`, `POST /trash/restore`, `POST /trash/empty` |
| `usage` | `GET\|POST /usage`, `wpu.usageCount`, the `unused` facet |
| `image-edit` | `POST /media/{id}/edit`, `/edit/undo`, `/restore` |
| `image-regenerate` | `POST /media/{id}/regenerate` |
| `image-replace` | `POST /media/{id}/replace` |
| `folders` | `/folders` routes, `folder=` filters, `wpu.folder` |
| `folder-colors` | `PATCH /folders/{id}` with `color` |
| `maintenance` | `POST /maintenance/step` |
| `usage-visual-portfolio` | The `visual-portfolio` usage context (D22); scanned only while the Visual Portfolio plugin is active |

API 1.0 builds list all twelve. `/info` and `/rev` are not features: every build has them. A feature
name is never removed or renamed within a major.

### 2.3 Additive-only policy

Within a major version:

- routes, parameters, fields, error codes and feature names are **never renamed or removed**, and their
  meaning never changes;
- new optional parameters, new response fields, new routes and new error codes may be added; consumers
  ignore unknown fields;
- every new capability gets a new `features[]` entry, so an older plugin degrades gracefully;
- `WPU_API`'s minor goes up with every contract addition; its major only for a breaking change;
- the server raises its `minMinor` (a blocking update for users) only for security or data-correctness
  fixes.

### 2.4 Compatibility checks and tests

- The server declares `PLUGIN_API_REQUIRED = {major: 1, minMinor: 0}` and `PLUGIN_FEATURES_OPTIONAL`; its
  bootstrap derives `plugin.state` from `/info` (server-api.md §7.1).
- **Contract tests assert `api >=` the level they need, never equality**, and skip feature-specific
  tests when the feature is absent. A track's new route therefore passes before the orchestrator raises
  the level.
- CI runs the contract tests against the current build and against the oldest supported build
  (`plugin-v<minimum>`; until the first release, the current build), installed as a regular plugin and
  once in `mu-plugins/`.

## 3. `GET /info`

Identifies the plugin and describes the site. **Its shape is frozen across every version**: fields are
only ever added, so any build, even an incompatible one, can be identified.

**Capability:** `upload_files`. **Bumps rev:** no. **Owner:** P1.

### 3.1 The identity (read first)

These four fields come first and are present in every build, forever:

| Field | Type | Value |
|---|---|---|
| `plugin` | string | always `"wp-upload-companion"` |
| `version` | string | `WPU_VERSION` |
| `api` | string | `WPU_API` |
| `features` | string[] | §2.2 |

### 3.2 Response 200 (`PluginInfo`)

```ts
interface PluginInfo {
  plugin: 'wp-upload-companion'
  version: string                 // WPU_VERSION
  api: string                     // WPU_API
  features: string[]
  install: 'plugin' | 'mu-plugin' // how it is loaded (§9)
  wpVersion: string               // get_bloginfo('version')
  user: {
    id: number
    name: string                  // display_name
    roles: string[]
    caps: { uploadFiles: boolean; editPosts: boolean; editOthersPosts: boolean;
            deletePosts: boolean; deleteOthersPosts: boolean; manageOptions: boolean }
  }
  filebird: { active: boolean; version: string; pro: boolean; perUser: boolean } | null  // §10.2
  trash: { enabled: boolean; days: number }  // MEDIA_TRASH && EMPTY_TRASH_DAYS > 0; EMPTY_TRASH_DAYS
  upload: { maxBytes: number; mimes: { extensions: string[]; mime: string }[] }  // wp_max_upload_size(); get_allowed_mime_types() for this user
  imageSizes: { name: string; width: number; height: number; crop: boolean }[]  // wp_get_registered_image_subsizes()
  imageEditor: { mimes: string[]; bigImageThreshold: number | null }  // MIME types wp_image_editor_supports(); the big_image_size_threshold filter (null = disabled)
  index: {
    media: { state: 'ready' | 'building' | 'stale'; done: number; total: number }
    usage: { state: 'ready' | 'building' | 'stale'; done: number; total: number }
  }
  rev: string
}
```

```json
{
  "plugin": "wp-upload-companion",
  "version": "1.0.0",
  "api": "1.0",
  "features": ["collection", "facets", "media-batch", "trash", "usage", "image-edit", "image-regenerate", "image-replace", "folders", "folder-colors", "maintenance", "usage-visual-portfolio"],
  "install": "plugin",
  "wpVersion": "7.1.5",
  "user": { "id": 2, "name": "Anna Berg", "roles": ["editor"],
    "caps": { "uploadFiles": true, "editPosts": true, "editOthersPosts": true, "deletePosts": true, "deleteOthersPosts": true, "manageOptions": false } },
  "filebird": { "active": true, "version": "6.5.9", "pro": false, "perUser": false },
  "trash": { "enabled": false, "days": 30 },
  "upload": { "maxBytes": 67108864, "mimes": [{ "extensions": ["jpg", "jpeg", "jpe"], "mime": "image/jpeg" }, { "extensions": ["png"], "mime": "image/png" }] },
  "imageSizes": [{ "name": "thumbnail", "width": 150, "height": 150, "crop": true }, { "name": "medium", "width": 300, "height": 300, "crop": false }],
  "imageEditor": { "mimes": ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"], "bigImageThreshold": 2560 },
  "index": { "media": { "state": "ready", "done": 20, "total": 20 }, "usage": { "state": "ready", "done": 8, "total": 8 } },
  "rev": "1795867200000"
}
```

(Fixture `pluginInfo` in `shared/fixtures/plugin.ts`.)

- `mimes` keys come from `get_allowed_mime_types()`'s `jpg|jpeg|jpe` patterns, split and lowercased.
- `index.media.total` is the number of attachments (any status but `auto-draft`); `index.usage.total` is
  the number of indexable posts (§8.2).

### 3.3 Response 403 (identifiable)

Without `upload_files`:

```json
{ "code": "wpu_forbidden", "message": "You need the upload_files capability (Author role or higher).",
  "data": { "status": 403, "plugin": "wp-upload-companion", "version": "1.0.0", "api": "1.0" } }
```

The server reports `plugin.state: "forbidden"` with that version (fixture `pluginInfoForbidden`).

## 4. Errors

All errors are `WP_Error`s with `data.status`. Codes are `wpu_*` (`PLUGIN_ERROR_CODES`). Extra `data`
keys are listed per code; the server passes them on as `details`.

| Code | Status | Meaning | Extra `data` |
|---|---|---|---|
| `wpu_forbidden` | 403 | Missing `upload_files` (request) or `edit_post`/`delete_post` (per item, in results) | `/info` only: `plugin`, `version`, `api` |
| `wpu_invalid_param` | 400 | A parameter or body field is missing, of the wrong type, out of range, or unknown | `param` |
| `wpu_too_many_items` | 400 | More ids or items than the route allows | `param`, `max` |
| `wpu_not_found` | 404 | No attachment with that id (request) / per item | — |
| `wpu_folder_not_found` | 404 | No FileBird folder with that id (or not in this user's tree in per-user mode) | `folder` |
| `wpu_post_not_found` | 404 | Per item: `set.post` names no post | `post` |
| `wpu_invalid_parent` | 400 | Per item: `set.post` is an attachment, revision or other unattachable type | `post` |
| `wpu_collection_too_large` | 422 | The collection has more than 250 000 items | `total` |
| `wpu_stale` | 409 | `expectedModified` doesn't match the item's `modifiedAt` | `modifiedAt` |
| `wpu_locked` | 409 | Another image operation on this item is still running | — |
| `wpu_filebird_inactive` | 409 | A folder route or `folder=<id>` without active FileBird | — |
| `wpu_filebird_per_user` | 409 | A folder mutation in FileBird's per-user mode (D10) | — |
| `wpu_folder_cycle` | 409 | Moving a folder into itself or its subtree | — |
| `wpu_invalid_folder_name` | 400 | Empty after trimming, over 200 characters, or empty after FileBird's sanitising | — |
| `wpu_folder_name_exhausted` | 409 | FileBird can't find a free "Name (N)" (N ≤ 15) | — |
| `wpu_pro_required` | 409 | `color` without FileBird Pro detected | — |
| `wpu_trash_disabled` | 409 | `/media/trash` while trash is disabled | — |
| `wpu_not_trashed` | 409 | Per item: restore of an item that isn't in the Trash | — |
| `wpu_unsupported_type` | 415 | The item's type can't be edited/regenerated, or the replacement's type isn't allowed for this user | `mime` |
| `wpu_mime_mismatch` | 415 | The replacement's MIME type differs from the item's | `mime`, `expected` |
| `wpu_file_too_large` | 413 | The replacement is over `wp_max_upload_size()` | `maxBytes` |
| `wpu_invalid_edit` | 400 | Edit ops out of bounds, scale not proportional or not down, nothing to do | `reason` |
| `wpu_nothing_to_undo` | 409 | `edit/undo` without an undoable edit | — |
| `wpu_not_edited` | 409 | `restore` without an original to restore | — |
| `wpu_image_error` | 500 | `WP_Image_Editor` failed (load, edit, save) | `reason` (WordPress's message) |
| `wpu_io_error` | 500 | A file couldn't be written, moved or deleted | — |
| `wpu_time_budget` | 503 | Reserved: a single item couldn't start within the budget (not used in 1.0) | — |
| `wpu_not_implemented` | 501 | Scaffold stub: the route exists but isn't built yet | — |
| `wpu_internal` | 500 | Any other failure (a caught `Throwable`); details only in the PHP error log | — |

WordPress core may still answer with its own codes before the plugin runs: 401 (`incorrect_password`,
`invalid_username`, …) for a rejected Application Password, and 404 `rest_no_route` when the namespace or
route isn't registered.

## 5. Routes

Every route requires `upload_files` (§1.3). "Bumps rev" says whether a successful call changes `wpu_rev`
(§6).

### 5.1 `GET /rev`

Cheap change detection; the server polls it (server-api.md §3.1). **Owner:** P1. **Bumps rev:** no.

**Response 200:** `{ rev: string; index: IndexStatus }` (`RevResponse`):

```json
{ "rev": "1795867200000", "index": { "media": { "state": "ready", "done": 20, "total": 20 }, "usage": { "state": "ready", "done": 8, "total": 8 } } }
```

Must not run anything heavier than reading the options in §8.4.

### 5.2 `GET /collection`

The whole ordered collection as compact rows. The single source of order. **Owner:** P1. **Feature:**
`collection`. **Bumps rev:** no.

**Params** (all optional; identical to server-api.md §6, which has the full semantics):

| Param | Type | Allowed | Default |
|---|---|---|---|
| `folder` | string | `all`, `trash`, `0`, positive folder id | `all` |
| `q` | string | ≤ 200 characters after trim and whitespace collapse; ≤ 10 whitespace-separated terms (more → 400) | — |
| `type` | string | `image`, `video`, `audio`, `document` | — |
| `alt` | string | `missing` | — |
| `size` | string | `gt1`, `gt5` | — |
| `orient` | string | `landscape`, `portrait`, `square` | — |
| `month` | string | `YYYY-MM` | — |
| `sort` | string | `date-desc`, `date-asc`, `title-asc`, `name-asc`, `size-desc`, `size-asc`, `dimensions-desc`, `type-asc` | `date-desc` |

**Response 200:** `CollectionResponse`:

```json
{
  "rev": "1795867200000",
  "query": { "folder": "all", "q": null, "type": null, "alt": null, "size": null, "orient": null, "month": null, "sort": "date-desc" },
  "total": 18,
  "rows": [1029, 2560, 1207, 0, 1090, 0, 0, 3, 1092, 0, 0, 5, 1091, 512, 512, 1],
  "indexComplete": true
}
```

**Rules** (the SQL contract):

- `rows` = `[id, width, height, kindCode]` per item, in order. `kindCode` indexes `MEDIA_KINDS`
  (server-api.md §5). Width/height: images and SVG = the file `_wp_attached_file` points to (the
  `-scaled` one for big images; SVG from its `width`/`height` or `viewBox` when parseable); video = frame
  size; PDF = the preview image's full size; everything else 0.
- **Visibility mirrors core's read check**, so every row hydrates through `/wp/v2/media?context=view`
  (server-api.md §7.5) and nothing comes back `missing`:
  - `inherit` items, except those attached to a parent the user can't read (core's "follow the
    parent" rule: a draft, pending, future or private parent of another user, for users without
    `edit_others_posts` / `read_private_posts`);
  - `private` items when the user has `read_private_posts` or the item is their own;
  - `trash` items only with `folder=trash`, and only those the user may `edit_post` (core's read rule
    for trashed posts);
  - never `auto-draft`.

  For Editors and Administrators this is every attachment. `/facets` and `/trash` apply the same
  rule.
- **`folder`:** `all` = no folder condition. `0` = no FileBird relation row (in per-user mode: no row in
  one of this user's folders). `<id>` = a relation row for exactly that folder (not subfolders).
  `trash` = trashed items, ordered `trashed_gmt DESC, ID DESC`; `q`, `type`, `alt`, `size`, `orient`,
  `month` and `sort` are ignored and echoed as null / `date-desc`.
- **`q`:** split on whitespace; each term must match (AND) case-insensitively as a substring of
  `post_title`, `post_excerpt`, `post_content`, the alt text, the original file name, `_wp_attached_file`,
  or the EXIF title, caption and keywords (`search_extra` in §8.1). LIKE wildcards in terms are escaped
  (`$wpdb->esc_like`).
- **`type`:** by kind (`image` → image, svg; `document` → document, archive, other).
- **`alt=missing`:** kind image or svg, and alt text empty after trimming.
- **`size`:** filesize > 1 000 000 (`gt1`) / 5 000 000 (`gt5`); unknown sizes never match.
- **`orient`:** integer arithmetic on width/height: landscape `w*10 > h*11`, portrait `w*10 < h*9`,
  square otherwise; width or height 0 never matches.
- **`month`:** `post_date` (site-local) in that month.
- **`sort`:** server-api.md §6. Ties always end with `ID` (desc for `*-desc`, `date-desc` and `type-asc`;
  asc otherwise), so the order is total.
- `query` echoes the normalised parameters; `folder` as `"all"`, `"trash"` or a number.
- `indexComplete` is false while `index.media.state` isn't `ready`. Items without an index row are
  still listed (from `wp_posts`), with width/height 0, kind derived from `post_mime_type`, unknown size,
  and no alt/EXIF search.

**Errors:** 400 `wpu_invalid_param`; 404 `wpu_folder_not_found`; 409 `wpu_filebird_inactive` (`folder`
other than `all`/`trash` without active FileBird); 422 `wpu_collection_too_large`.

**Performance:** served from `wpu_media_index` joined to `wp_posts` by primary key; folder filters use the
denormalised `folder_id` in shared mode (§8.1) and never scan FileBird's relation table. p95 ≤ 300 ms at
50k (implementation plan §9).

### 5.3 `GET /facets`

Counts for the same query. **Owner:** P1 (the `unused` count asks P2's usage provider). **Feature:**
`facets`. **Bumps rev:** no.

**Params:** as `/collection` (`sort` is accepted and ignored).

**Response 200:** `Facets` (server-api.md §7.4 has the field meanings):

```json
{
  "rev": "1795867200000",
  "query": { "folder": 0, "q": null, "type": null, "alt": "missing", "size": null, "orient": null, "month": null, "sort": "date-desc" },
  "view": { "total": 1, "bytes": 4543667, "types": { "image": 1, "video": 0, "audio": 0, "document": 0 }, "missingAlt": 1, "unused": 1, "editable": 1 },
  "folder": { "total": 2, "bytes": 5874709, "types": { "image": 2, "video": 0, "audio": 0, "document": 0 }, "missingAlt": 1, "unused": 2, "editable": 2 },
  "months": [{ "month": "2025-01", "count": 1 }, { "month": "2024-12", "count": 1 }],
  "indexComplete": true,
  "usageComplete": true
}
```

(Fixture `facetsUncategorizedMissingAlt`.)

- `view` = exactly the `/collection` rows for this query. `folder` and `months` = the same `folder`, no
  other filter. With `folder=trash`: `view` and `folder` both describe the Trash; `months` is `[]`.
- `editable` = `total` when the user has `edit_others_posts`; otherwise the items whose `post_author` is
  the user.
- `unused` = items with no row in `wpu_usage`. `usageComplete` = `index.usage.state` is `ready`.

**Errors:** as `/collection`.

### 5.4 `POST /media/batch`

Metadata for up to 100 items, attach and detach. **Owner:** P2. **Feature:** `media-batch`. **Bumps
rev:** yes (when anything changed).

**Body:** `PluginMediaBatchRequest`:

```ts
{
  items: {                       // 1–100
    id: number
    set: {                       // only these keys
      title?: string             // ≤ 1000 characters
      alt?: string               // ≤ 1000
      caption?: string           // ≤ 5000
      description?: string       // ≤ 65535
      post?: number | null       // attach to this post id (≥ 1); null detaches (0 → 400)
    }
    appendDescription?: string   // 1–65535; not together with set.description
  }[]
}
```

Example, sent by an **Author** (item 1000 belongs to another user; fixture `batchCaption`):

```json
{ "items": [
  { "id": 1002, "set": { "caption": "Summer party 2025" } },
  { "id": 1000, "set": { "caption": "Summer party 2025" } }
] }
```

**Per item:**

1. Not an attachment → `wpu_not_found`. No `edit_post` → `wpu_forbidden`.
2. `set.post` (non-null): no such post → `wpu_post_not_found`; an attachment, revision, nav item or other
   type that can't own media → `wpu_invalid_parent`; no `edit_post` on it → `wpu_forbidden`.
3. Writes `title` (`post_title`), `caption` (`post_excerpt`), `description` (`post_content`) and `post`
   (`post_parent`) with **one** `wp_update_post()` call, which applies WordPress's own filters (kses for
   users without `unfiltered_html`) and **updates `post_modified`**. Writes `alt` with
   `update_post_meta(…, '_wp_attachment_image_alt', sanitize_text_field(…))`. An alt-only change does
   **not** touch `post_modified` (as in WordPress).
4. `appendDescription`: new description = old description with trailing whitespace removed, then
   `"\n\n"`, then the text; or just the text when the old one is empty.
5. Items that change nothing still succeed (with `previous` equal to `item`'s values).

**Response 200:** `PluginMediaBatchResponse`:

```ts
{
  rev: string
  results: (
    | { id: number; ok: true; previous: ItemPatch; item: ItemMetaSnapshot }
    | { id: number; ok: false; error: { code: string; message: string } }
  )[]
  remaining: number[]            // §1.6
}
// ItemPatch: the previous values of the keys in `set` (and `description` for appendDescription)
// ItemMetaSnapshot: { title, alt, caption, description, post: number | null, modifiedAt } after the write
```

```json
{
  "rev": "1795867200002",
  "results": [
    { "id": 1002, "ok": true, "previous": { "caption": "" },
      "item": { "title": "workspace-davide-ragusa-687", "alt": "", "caption": "Summer party 2025", "description": "", "post": null, "modifiedAt": "2026-11-22T12:00:04Z" } },
    { "id": 1000, "ok": false, "error": { "code": "wpu_forbidden", "message": "You can’t edit media uploaded by others." } }
  ],
  "remaining": []
}
```

Values are returned **as stored** (after WordPress's filters), so the client shows what WordPress kept.

**Errors (whole request):** 400 `wpu_invalid_param` (shape, unknown keys, empty `set` without
`appendDescription`, both `set.description` and `appendDescription`, over a length limit), 400
`wpu_too_many_items`.

### 5.5 `POST /media/trash`

Moves items to the Trash. **Owner:** P2. **Feature:** `trash`. **Bumps rev:** yes.

**Body:** `{ ids: number[] }` (1–100).

**Per item:** `wpu_not_found`; `wpu_forbidden` (no `delete_post`); otherwise `wp_trash_post()`. An item
that is already trashed succeeds with its existing trash state.

**Response 200:** `PluginDeleteResponse`:

```json
{ "rev": "1795867200003",
  "results": [{ "id": 1017, "ok": true, "trash": { "trashedAt": "2026-11-22T12:00:03Z", "daysLeft": 30 } }],
  "remaining": [] }
```

`trashedAt` is `_wp_trash_meta_time`; `daysLeft` = `EMPTY_TRASH_DAYS` − whole days since, at least 0
(null only when `EMPTY_TRASH_DAYS` is 0: WordPress's daily `wp_scheduled_delete` purges trashed items
whether or not `MEDIA_TRASH` is on). FileBird keeps the item's folder row while it is trashed.

**Errors:** 400 `wpu_invalid_param`, `wpu_too_many_items`; **409 `wpu_trash_disabled`** when
`trash.enabled` is false (checked before any item).

### 5.6 `POST /media/delete`

Deletes items permanently, trashed or not. **Owner:** P2. **Feature:** `trash`. **Bumps rev:** yes.

**Body:** `{ ids: number[] }` (1–100).

**Per item:** `wpu_not_found`; `wpu_forbidden` (no `delete_post`); `wp_delete_attachment($id, true)`
(files, every size, edit backups; FileBird's relation rows go through its own `delete_attachment` hook;
WordPress clears `_thumbnail_id` on posts that used it); `wpu_io_error` when it returns false.

**Response 200:** `PluginDeleteResponse` with `trash: null` (fixture `pluginDeletePartial` shows
`remaining`):

```json
{ "rev": "1795867200008", "results": [{ "id": 1004, "ok": true, "trash": null }], "remaining": [1005] }
```

**Errors:** 400 `wpu_invalid_param`, `wpu_too_many_items`.

### 5.7 `GET /trash`

The Trash summary. **Owner:** P2. **Feature:** `trash`. **Bumps rev:** no.

**Response 200:** `TrashSummary`:

```json
{ "rev": "1795867200000", "enabled": true, "days": 30, "count": 2, "bytes": 2241760 }
```

`count` and `bytes` cover every trashed attachment. The Trash's items and their order come from
`/collection?folder=trash`; their `trashedAt` from the `wpu` field.

### 5.8 `POST /trash/restore`

**Owner:** P2. **Feature:** `trash`. **Bumps rev:** yes.

**Body:** `{ ids: number[] }` (1–100).

**Per item:** `wpu_not_found`; `wpu_forbidden` (no `delete_post`, which WordPress requires to untrash);
`wpu_not_trashed`; otherwise `wp_untrash_post()` (status back to `inherit`).

**Response 200:** `PluginRestoreResponse`:

```json
{ "rev": "1795867200006", "results": [{ "id": 1017, "ok": true, "folder": 12 }, { "id": 1026, "ok": true, "folder": 6 }], "remaining": [] }
```

`folder` is the FileBird folder the item is in (0 = Uncategorized; null without active FileBird).

**Errors:** 400 `wpu_invalid_param`, `wpu_too_many_items`.

### 5.9 `POST /trash/empty`

Permanently deletes trashed attachments, oldest-trashed first, within a time budget. **Owner:** P2.
**Feature:** `trash`. **Bumps rev:** yes (when something was deleted).

**Body:** `{ budgetMs?: number }` (100–20 000, default 10 000).

**Response 200:** `EmptyTrashResponse`:

```json
{ "rev": "1795867200007", "deleted": 1, "remaining": 1, "skipped": 0 }
```

`remaining` = trashed items this user may delete that are still there; `skipped` = trashed items the
user may not delete (no `delete_post`), left alone. Each deletion is `wp_delete_attachment($id, true)`.

**Errors:** 400 `wpu_invalid_param`.

### 5.10 `GET /usage` and `POST /usage`

Where items are used. **Owner:** P2. **Feature:** `usage`. **Bumps rev:** no.

**Params:** `GET /usage?ids=1003,1000` or `POST /usage` with `{ "ids": [1003, 1000] }` (1–100 either
way; `POST` exists for proxies that limit URL length).

**Response 200:** `UsageResponse` (server-api.md §7.9 has the `UsageRef` fields):

```json
{
  "rev": "1795867200000",
  "complete": true,
  "items": [
    { "id": 1003, "count": 2, "refs": [
      { "postId": 205, "postType": "post", "postTypeLabel": "Post", "title": "Conference 2025 recap", "status": "publish",
        "editUrl": "https://example.com/wp-admin/post.php?post=205&action=edit", "viewUrl": "https://example.com/?p=205", "contexts": ["gallery-block"] },
      { "postId": 206, "postType": "post", "postTypeLabel": "Post", "title": "Five ideas for summer", "status": "publish",
        "editUrl": "https://example.com/wp-admin/post.php?post=206&action=edit", "viewUrl": "https://example.com/?p=206", "contexts": ["image-block"] }
    ] },
    { "id": 1000, "count": 0, "refs": [] }
  ]
}
```

- Source: `wpu_usage` (§8.2). One ref per using post (or site-level slot), with every context it was
  found in, at most 200 refs per item (`count` is the full number); site-level refs first, then refs with
  `featured`, then by title.
- `postTypeLabel` = the post type's `labels->singular_name`. `editUrl` = `get_edit_post_link($id, 'raw')`
  when the user can `edit_post` it, else null. `viewUrl` = `get_permalink()` when the post is publicly
  viewable (`is_post_publicly_viewable`), else null.
- Posts the user can't `read_post` (another user's private post, for an Author) appear as
  `title: "Private post"` with both URLs null.
- Site-level uses: `postId: null`, `postType: "site"`, `postTypeLabel: "Site"`, title "Site logo" /
  "Site icon", `editUrl` = the Site Editor or Customizer when the user has `edit_theme_options`.
- `complete` = `index.usage.state` is `ready`. Unknown ids get `count: 0`.

**Errors:** 400 `wpu_invalid_param`, `wpu_too_many_items`.

### 5.11 `POST /media/{id}/edit`

In-place image edit (D7). **Owner:** P2 (spike X2). **Feature:** `image-edit`. **Bumps rev:** yes.

**Body:** `EditRequest`:

```ts
{
  ops: (                                              // 0–20, applied in order
    | { op: 'rotate'; angle: 90 | 180 | 270 }         // clockwise, as on screen
    | { op: 'flipH' }                                 // mirror left↔right, as on screen
    | { op: 'flipV' }                                 // mirror top↔bottom, as on screen
    | { op: 'crop'; x: number; y: number; width: number; height: number }  // integer px of the image as it looks after the preceding ops
  )[]
  scale?: { width: number; height: number }           // after the ops; proportional, ≤ the current size
  applyTo: 'all' | 'thumbnail' | 'nothumb'
  expectedModified: string                            // the item's modifiedAt when editing started
}
```

```json
{ "ops": [{ "op": "rotate", "angle": 90 }, { "op": "crop", "x": 120, "y": 0, "width": 1334, "height": 750 }],
  "scale": { "width": 1067, "height": 600 }, "applyTo": "all", "expectedModified": "2026-10-02T08:41:19Z" }
```

**Checks, in order:** 404 `wpu_not_found` → 403 `wpu_forbidden` (no `edit_post`) → 415
`wpu_unsupported_type` (MIME not in `imageEditor.mimes`) → 409 `wpu_stale` (`expectedModified` ≠ the
item's `post_modified_gmt`; `data.modifiedAt` = the current one) → 409 `wpu_locked` → 400
`wpu_invalid_edit` (no op and no scale; a crop outside the image or under 1 px; a scale that isn't
proportional within 1 px or is larger than the cropped size).

**Semantics:**

- Coordinates refer to the file `_wp_attached_file` points to (the `-scaled` file for big images, as
  wp-admin does), after applying its EXIF orientation.
- `applyTo` follows wp-admin: `all` = the main file and every size; `thumbnail` = only the `thumbnail`
  size is replaced by the edited image (the main file stays); `nothumb` = the main file and every size
  except `thumbnail`.
- **Same id. Same URL as the target:** the plugin writes the result to the item's existing file path and
  keeps a backup of what it replaced, so posts using the URL show the edited image. If spike X2 shows that
  this can't be done reliably and WordPress's own `wp_save_image()` behaviour (a new `-e<timestamp>`
  file name) is used instead, `urlChanged` is `true` (raised as an open question at Checkpoint 4).
- Keeps a backup per edit so `edit/undo` can revert it, and the original so `restore` can bring it back
  (WordPress's `_wp_attachment_backup_sizes` for the original, the plugin's own backups for the undo
  stack; at least the last edit is undoable).
- Regenerates the affected sizes, updates `_wp_attachment_metadata`, the media index row, and
  `post_modified` (so `expectedModified` detects concurrent edits).
- Holds a per-item lock (a transient, 10 minutes) for the whole operation.

**Response 200:** `PluginImageOpResponse`:

```ts
{ rev: string; id: number; modifiedAt: string; width: number; height: number; mime: string
  sizesRegenerated: number; urlChanged: boolean; edited: boolean; undoable: boolean; restorable: boolean }
```

```json
{ "rev": "1795867200010", "id": 1009, "modifiedAt": "2026-11-22T12:01:40Z", "width": 1067, "height": 600, "mime": "image/jpeg",
  "sizesRegenerated": 6, "urlChanged": false, "edited": true, "undoable": true, "restorable": true }
```

`width`/`height` are the main file's after the edit (unchanged for `applyTo: thumbnail`).

**Errors:** as listed under checks, plus 500 `wpu_image_error`, `wpu_io_error`.

### 5.12 `POST /media/{id}/edit/undo`

Reverts the most recent plugin edit that hasn't been undone. **Owner:** P2. **Feature:** `image-edit`.
**Bumps rev:** yes.

**Body:** `{ expectedModified: string }`.

**Checks:** 404, 403, 409 `wpu_stale`, 409 `wpu_locked`, 409 `wpu_nothing_to_undo` (no undoable edit,
e.g. after `restore` or a `replace`).

**Response 200:** `PluginImageOpResponse` (`undoable` tells whether another undo is possible).

### 5.13 `POST /media/{id}/restore`

Restores the original image, like wp-admin's "Restore original image" (also for images edited in
wp-admin). Clears the undo stack. **Owner:** P2. **Feature:** `image-edit`. **Bumps rev:** yes.

**Body:** `{ expectedModified: string }`.

**Checks:** 404, 403, 409 `wpu_stale`, 409 `wpu_locked`, 409 `wpu_not_edited` (no original backup).

**Response 200:** `PluginImageOpResponse` (fixture `pluginRestoreImage`):

```json
{ "rev": "1795867200011", "id": 1009, "modifiedAt": "2026-11-22T11:58:02Z", "width": 2560, "height": 1707, "mime": "image/jpeg",
  "sizesRegenerated": 6, "urlChanged": false, "edited": false, "undoable": false, "restorable": false }
```

### 5.14 `POST /media/{id}/regenerate`

Rebuilds **every** registered sub-size from the current full image, keeping in-place edits (core's
`post-process` only creates missing ones). PDFs: rebuilds the preview and its sizes. Deletes old sub-size
files that are no longer referenced. **Owner:** P2. **Feature:** `image-regenerate`. **Bumps rev:** yes.

**Body:** none or `{}`.

**Checks:** 404, 403, 415 `wpu_unsupported_type` (not a raster image in `imageEditor.mimes` and not a
PDF), 409 `wpu_locked`.

**Response 200:** `PluginImageOpResponse`. Also updates `post_modified`.

**Errors:** plus 500 `wpu_image_error`, `wpu_io_error`.

### 5.15 `POST /media/{id}/replace`

Replaces the item's file, keeping its id, file name and URL. **Owner:** P2 (spike X3). **Feature:**
`image-replace`. **Bumps rev:** yes.

**Body:** `multipart/form-data` with `file` (the new file) and `expectedModified`.

**Checks, in order:** 404 `wpu_not_found` → 403 `wpu_forbidden` → 400 `wpu_invalid_param` (no file) →
409 `wpu_stale` → 409 `wpu_locked` → 413 `wpu_file_too_large` (> `wp_max_upload_size()`) → 415
`wpu_unsupported_type` (`wp_check_filetype_and_ext()` finds no type allowed for this user) → 415
`wpu_mime_mismatch` (the real type differs from the item's `post_mime_type`; `data.expected`).

**Semantics:**

- Writes the new file to the item's existing path (same name), regenerates metadata and every sub-size,
  deletes sub-size files that are no longer produced, clears the undo stack, updates the index row and
  `post_modified`.
- Works for every kind (images, SVG, video, audio, documents), as long as the MIME type matches.
- **`-scaled` images (spike X3):** the goal is that the attached file's URL stays the same. If X3 shows
  it can't for some inputs (e.g. the new image is under the big-image threshold, so WordPress wouldn't
  make a `-scaled` file), the plugin keeps the URL working where it can and reports
  `urlChanged: true`; the UI warns.

**Response 200:** `PluginImageOpResponse`.

**Errors:** as listed, plus 500 `wpu_image_error`, `wpu_io_error`.

### 5.16 `GET /folders`

The FileBird folder tree with counts. **Owner:** P1. **Feature:** `folders`. **Bumps rev:** no.

**Response 200:** `FolderTree`:

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

- `folders`: flat, sorted by `parent`, `ord`, `id`; from `{prefix}fbv` (read-only SQL, `type = 0`).
  `name` decoded (§1.2). `color` from the `fbv_folder_colors` option (lowercase `#rrggbb`; anything else
  → null), **only when `mode.pro` is true**; on Lite every `color` is null, because Pro features are
  hidden there (folders.md §1, implementation plan §0).
- `count`: non-trashed attachments directly in the folder (FileBird's own count semantics).
  `counts.all` = non-trashed attachments; `counts.uncategorized` = non-trashed attachments in no folder.
- `mode.pro` = `filebird.pro`; `mode.perUser` = `filebird.perUser`; `mode.readOnly` = `perUser`;
  `mode.colorsWritable` = `pro` and the `folder-colors` feature.
- **Per-user mode:** the tree is the folders with `created_by` = the current user, resolved at request
  time (not FileBird's cached user, research 02 §2.1); counts and `folder=` filters are relative to that
  tree.

**Errors:** 409 `wpu_filebird_inactive`.

### 5.17 `POST /folders`

Creates a folder through FileBird. **Owner:** P1. **Feature:** `folders`. **Bumps rev:** yes.

**Body:** `{ name: string; parent: number }` (`parent` 0 = top level).

**Rules:** the name is trimmed and inner whitespace collapsed; 1–200 characters. A duplicate among
siblings is auto-suffixed by FileBird ("Logos" → "Logos (1)", case-insensitive). The new folder is
appended to its siblings (`ord` = max + 1).

**Response 201:** `FolderMutationResponse`:

```json
{
  "rev": "1795867200012",
  "folder": { "id": 17, "name": "Logos (1)", "parent": 1, "ord": 3, "color": null, "count": 0 },
  "renamed": true,
  "requestedName": "Logos",
  "tree": { "rev": "1795867200012", "mode": { "…": "…" }, "folders": ["…"], "counts": { "all": 18, "uncategorized": 2 } }
}
```

**Errors:** 400 `wpu_invalid_param`, `wpu_invalid_folder_name`; 404 `wpu_folder_not_found` (parent); 409
`wpu_folder_name_exhausted`, `wpu_filebird_inactive`, `wpu_filebird_per_user`.

### 5.18 `PATCH /folders/{id}`

Renames, moves, reorders or recolours a folder. **Owner:** P1. **Feature:** `folders` (`folder-colors`
for `color`). **Bumps rev:** yes.

**Body:** at least one of:

| Field | Type | Rules |
|---|---|---|
| `name` | string | As in create; a clash is auto-suffixed ("Name (1)"), never an error. An unchanged name is a no-op |
| `parent` | number | New parent (0 = top level). Into itself or its subtree → 409 `wpu_folder_cycle` |
| `position` | number | 0-based index among the siblings under the (new) parent, counted without the moved folder; larger than the sibling count = last. Default when only `parent` is sent: last |
| `color` | string \| null | `#rrggbb` (case-insensitive, stored lowercase) or null to clear. Only with `mode.colorsWritable`, else 409 `wpu_pro_required` |

Several fields in one request are applied in the order name → move → colour. Undo of a move sends the
old `parent` and `position`.

**Response 200:** `FolderMutationResponse` (`renamed`/`requestedName` refer to `name`; both
`false`/`null` without it).

**Errors:** 400 `wpu_invalid_param` (empty body, bad colour), `wpu_invalid_folder_name`; 404
`wpu_folder_not_found` (the folder or the new parent); 409 `wpu_folder_cycle`, `wpu_pro_required`,
`wpu_folder_name_exhausted`, `wpu_filebird_inactive`, `wpu_filebird_per_user`.

### 5.19 `DELETE /folders/{id}`

Deletes the folder and its whole subtree through FileBird; their files become Uncategorized. No media is
deleted. **Owner:** P1. **Feature:** `folders`. **Bumps rev:** yes.

**Response 200:** `FolderDeleteResponse`:

```json
{ "rev": "1795867200013", "deletedIds": [8, 9, 10], "movedFiles": 1, "tree": { "…": "FolderTree after the delete" } }
```

`deletedIds` = the folder and every descendant (the folder first, then depth-first). `movedFiles` = the
non-trashed attachments that were directly in any of them, counted before the delete.

**Errors:** 404 `wpu_folder_not_found`; 409 `wpu_filebird_inactive`, `wpu_filebird_per_user`.

### 5.20 `POST /folders/assign`

Moves items into a folder (or out of all folders). **Owner:** P1. **Feature:** `folders`. **Bumps rev:**
yes (when an item moved).

**Body:** `{ folder: number; ids: number[] }`: `folder` 0 = Uncategorized; 1–5000 ids.

**Rules:** items that aren't attachments are skipped with `wpu_not_found`, items without `edit_post` with
`wpu_forbidden` (FileBird's own assign rejects the whole set if one fails, so the plugin filters first);
the rest are assigned in **one** call to FileBird's `setFoldersForPosts` (or its equivalent, §10.3), which
updates the denormalised `folder_id` through FileBird's hooks.

**Response 200:** `FolderAssignResponse`:

```json
{
  "rev": "1795867200005",
  "previous": [{ "id": 1002, "folder": 10 }, { "id": 1003, "folder": 6 }],
  "skipped": [{ "id": 999999, "ok": false, "error": { "code": "wpu_not_found", "message": "Media item 999999 does not exist." } }],
  "moved": 2,
  "counts": { "all": 18, "uncategorized": 2, "byId": { "1": 1, "2": 1, "6": 1, "10": 0, "15": 4, "…": 0 } }
}
```

`previous` lists every assigned (not skipped) item with its folder before the call, including items
that were already in the target; `moved` counts those whose folder changed. `counts.byId` has an entry
for every folder (fixture `folderAssignPressKit`).

**Errors:** 400 `wpu_invalid_param`, `wpu_too_many_items`; 404 `wpu_folder_not_found`; 409
`wpu_filebird_inactive`, `wpu_filebird_per_user`.

### 5.21 `POST /maintenance/step`

One time-budgeted unit of index work, driven by the server instead of WP-Cron (server-api.md §9.2).
**Owner:** P1 (the usage part calls P2's `UsageIndex`). **Feature:** `maintenance`. **Bumps rev:** yes
when it changed anything visible (index rows, usage rows, folder column).

**Body:** `{ budgetMs?: number }` (100–20 000, default 5000).

**What a step does, in order, until the budget is spent:**

1. Takes the lock (`add_option('wpu_maintenance_lock', …)`, which is atomic; a lock older than 2 minutes
   is stale and is taken over). If it can't, it answers at once with `locked: true`.
2. Ensures the schemas are current (§9.2).
3. **Media index:** indexes attachments without a row, or whose row is older than their
   `post_modified_gmt` or the current row format, in batches of 200 by ascending id. After a stale mark
   (§9.3) it reconciles every row once (new, changed and deleted attachments).
4. **Folder column:** in shared mode, compares `folder_id` with FileBird's relation table (read-only)
   for a batch of rows and fixes differences (FileBird changes made while the plugin was off, or through
   code paths without hooks).
5. **Usage index:** scans posts not yet scanned, or modified since, in batches of 50 (P2's
   `UsageIndex`), then the site logo and icon.
6. Releases the lock.

**Response 200:** `PluginMaintenanceResponse`:

```json
{ "rev": "1795867200009", "locked": false, "did": { "media": 8, "usage": 0, "folders": 0 }, "more": true,
  "index": { "media": { "state": "building", "done": 12, "total": 20 }, "usage": { "state": "building", "done": 0, "total": 8 } } }
```

`more` is true while any index isn't `ready`. (Fixture `pluginMaintenanceStep`.)

**Errors:** 400 `wpu_invalid_param`.

## 6. The library revision (`wpu_rev`)

`wpu_rev` is an option (not autoloaded) holding a monotonic integer. It replaces ETags and ID sweeps
(implementation plan §2.1): any change that could alter any route's answer bumps it.

- **Bump:** `wpu_rev = max(wpu_rev + 1, current time in milliseconds)`. Starting from the clock means a
  reinstalled plugin (option deleted) never reuses an old value, so the server's rev-keyed cache can't
  serve stale data.
- **Atomic:** the bump is **one SQL statement**, never a read-modify-write through `get_option()` (which
  may read a stale cached `alloptions` and lose or repeat a value under concurrency):
  `UPDATE {prefix}options SET option_value = GREATEST(CAST(option_value AS UNSIGNED) + 1, %d) WHERE
  option_name = 'wpu_rev'` (the option is created on install, §9.2). Afterwards the plugin reads the
  new value with a direct `SELECT` and drops the cached copies (`wp_cache_delete('wpu_rev', 'options')`,
  `wp_cache_delete('alloptions', 'options')`), so mutation responses report the fresh value.
- **Read:** routes read it before querying (§1.7) and return it as a decimal string; a direct `SELECT`
  is used there too when a persistent object cache is active.
- **Coalescing:** a request may coalesce bumps, as long as the stored rev is bumped after the request's
  last change (e.g. bump on the first change and again on `shutdown` if more changes followed). Mutation
  responses report the rev after their changes.
- Consumers compare revs for equality only.

**What bumps it** (hooks registered by `Plugin.php`'s `Rev` component; attachments only where noted):

| Source | Hooks |
|---|---|
| Attachments created, changed, deleted | `add_attachment`, `attachment_updated`, `edit_attachment`, `delete_attachment` |
| Trash | `trashed_post`, `untrashed_post` (attachments) |
| Metadata and files | `added_post_meta`, `updated_post_meta`, `deleted_post_meta` for `_wp_attachment_image_alt`, `_wp_attachment_metadata`, `_wp_attached_file`, `_wp_attachment_backup_sizes`, `_thumbnail_id` (any post), `_wp_trash_meta_time`; `wp_update_attachment_metadata` (filter, pass-through) |
| FileBird | `fbv_after_set_folder`, `fbv_after_assign_folder`, `fbv_after_folder_created`, `fbv_after_folder_renamed`, `fbv_after_folder_deleted`, `fbv_after_parent_updated`, `fbv_folder_parent_updated`, `fbv_after_delete_all`; `{add,update,delete}_option_fbv_folder_colors`, `{add,update,delete}_option_njt_fbv_folder_per_user` (`update_option()` on a missing option only fires `add_option_*`); FileBird activated or deactivated (`activated_plugin`, `deactivated_plugin`) |
| Usage | `UsageIndex` bumps only when a post's set of usage rows **actually changed** (on `save_post`, `deleted_post`, `trashed_post`, `untrashed_post` of indexable posts), and on `{add,update,delete}_option_site_logo` / `…_site_icon` |
| The plugin itself | every successful mutation route (via the hooks above, plus an explicit bump), schema upgrades, the deactivation stale mark (§9.3), and maintenance steps that changed visible data |

Post saves that don't change usage never bump rev, so editing posts doesn't invalidate the media
library's caches.

## 7. The `wpu` field on `/wp/v2/media`

The plugin registers a read-only REST field `wpu` on attachments (`register_rest_field`), in contexts
`view` and `edit`. The server hydrates items with `GET /wp/v2/media?include=…&_fields=…,wpu`
(server-api.md §7.5). The field is `null` for users without `upload_files`, and is only computed when
requested (WordPress skips unrequested fields under `_fields`).

### 7.1 Shape (`WpuField`)

| Key | Type | Meaning | Provider |
|---|---|---|---|
| `kind` | `MediaKind` | server-api.md §5 | P1 `MediaIndex` |
| `width`, `height` | number | Exactly the collection row's numbers (0 = unknown) | P1 `MediaIndex` |
| `filesize` | number \| null | Bytes of the attached file | P1 `MediaIndex` |
| `folder` | number \| null | FileBird folder (0 = Uncategorized); null without active FileBird. Per-user mode: this user's folder | P1 `FileBird\Adapter` |
| `perms` | `{edit, delete}` | `current_user_can('edit_post' \| 'delete_post', id)` | P1 |
| `trashedAt` | string \| null | `_wp_trash_meta_time` while trashed | P1 |
| `duration` | number \| null | Seconds (`length` in the metadata), video and audio | P1 `MediaIndex` |
| `pages` | number \| null | PDF page count when known (best effort, counted at index time) | P1 `MediaIndex` |
| `poster` | `{url, width, height}` \| null | The `featured_media` image of a video or audio item, `medium_large` size (else full) | P1 |
| `original` | `{url, width, height, filename}` \| null | `wp_get_original_image_path()` / `original_image` when the attached file is a scaled or rotated copy | P1 |
| `raw` | `{title, caption, description}` | Raw `post_title` (entity-decoded), `post_excerpt`, `post_content`, in every context | P1 |
| `author` | `{id, name}` | `post_author` and its `display_name` | P1 |
| `edited` | boolean | Edited in place (by the plugin or wp-admin's editor) | P2 |
| `editedAt` | string \| null | When it was last edited in place (the plugin records it; for wp-admin edits, the time of the newest backup in `_wp_attachment_backup_sizes` when known, else null) | P2 |
| `undoable` | boolean | `edit/undo` would succeed | P2 |
| `restorable` | boolean | `restore` would succeed | P2 |
| `sizesPending` | boolean | A registered size that applies to this item has no generated file yet (core's `missing_image_sizes` logic) | P2 |
| `usageCount` | number \| null | Refs in `wpu_usage`; null while the usage index hasn't scanned enough to know | P2 `UsageIndex` |

Example (item 1009; fixture `wpuFieldEdited`):

```json
{
  "kind": "image", "width": 2560, "height": 1707, "filesize": 1604636, "folder": 12,
  "perms": { "edit": true, "delete": true }, "trashedAt": null, "duration": null, "pages": null, "poster": null,
  "original": { "url": "https://example.com/wp-content/uploads/2025/04/travel-fre-sonneveld-314.jpg", "width": 4608, "height": 3072, "filename": "travel-fre-sonneveld-314.jpg" },
  "raw": { "title": "travel-fre-sonneveld-314", "caption": "", "description": "" },
  "author": { "id": 1, "name": "Site Admin" },
  "edited": true, "editedAt": "2026-10-02T08:41:19Z", "undoable": true, "restorable": true, "sizesPending": false, "usageCount": 3
}
```

### 7.2 The provider model (implementation plan §2.5)

- The field is assembled from **providers**, one per key group, registered in `Plugin.php`. Each
  provider implements `prime(int[] $ids): void` (load everything for a page of items in a few queries)
  and `value(int $id): mixed`.
- The field primes every provider once per REST response, for all attachment ids of that response (it
  collects them from the query results, e.g. through `the_posts` during a REST request), so a 100-item
  page costs a fixed number of queries, not 100 × N.
- **Scaffold:** P2's providers (`edited`, `editedAt`, `undoable`, `restorable`, `sizesPending`,
  `usageCount`) are registered as stubs returning `false`, `null`, `false`, `false`, `false`, `null`
  until P2 merges. The `unused`
  facet reads the usage provider the same way (all items unused while it is a stub, and
  `usageComplete: false`).
- Keys are never removed (§2.3); new keys get a provider and may be added in a minor version.

## 8. Tables and options

The plugin's own tables (`$wpdb->prefix` + name). Created and upgraded with `dbDelta()` (§9.2). Each
index class owns its tables and its schema-version option. Columns and indexes below are the 1.0 starting
point: they are internal, so P1/P2 may add indexes (e.g. after spike X4) without a contract change.

### 8.1 `wpu_media_index` (P1, `MediaIndex`)

One row per attachment (any status except `auto-draft`). Kept current by hooks (`add_attachment`,
`attachment_updated`, `wp_update_attachment_metadata`, alt meta changes, `trashed_post`/`untrashed_post`,
`delete_attachment`, the FileBird folder hooks) and repaired by `/maintenance/step`.

| Column | Type | Notes |
|---|---|---|
| `attachment_id` | `BIGINT UNSIGNED NOT NULL` | Primary key = `wp_posts.ID` |
| `status` | `VARCHAR(20) NOT NULL` | `inherit`, `private` or `trash` (copy of `post_status`) |
| `author` | `BIGINT UNSIGNED NOT NULL` | `post_author` |
| `uploaded_gmt` | `DATETIME NOT NULL` | `post_date_gmt` |
| `month` | `CHAR(7) NOT NULL` | `YYYY-MM` of `post_date` (site time) |
| `kind` | `TINYINT UNSIGNED NOT NULL` | `MEDIA_KINDS` code |
| `mime` | `VARCHAR(100) NOT NULL` | `post_mime_type` |
| `width`, `height` | `INT UNSIGNED NOT NULL DEFAULT 0` | As the collection rows |
| `pixels` | `BIGINT UNSIGNED NOT NULL DEFAULT 0` | `width * height` (dimensions sort) |
| `filesize` | `BIGINT UNSIGNED NULL` | Bytes of the attached file |
| `filename` | `VARCHAR(255) NOT NULL` | Original basename (name sort) |
| `has_alt` | `TINYINT(1) NOT NULL DEFAULT 0` | Alt text non-empty after trim |
| `search_extra` | `TEXT NOT NULL` | Lowercased alt text, attached file path, original file name, EXIF title, caption and keywords (search) |
| `duration` | `INT UNSIGNED NULL` | Seconds |
| `pages` | `INT UNSIGNED NULL` | PDF pages |
| `folder_id` | `BIGINT UNSIGNED NOT NULL DEFAULT 0` | **Denormalised FileBird folder** in shared mode (0 = none), written **by the plugin's own folder routes** right after their FileBird call (assign, delete), and kept current for changes made elsewhere (wp-admin, FileBird's own UI) from `fbv_after_set_folder` / `fbv_after_assign_folder` / `fbv_after_folder_deleted` / `fbv_after_delete_all` (some fire only from FileBird's controllers, so the plugin never relies on them for its own changes); reconciled by maintenance. FileBird's own tables are never altered (D17) |
| `trashed_gmt` | `DATETIME NULL` | From `_wp_trash_meta_time` |
| `row_version` | `SMALLINT UNSIGNED NOT NULL` | Format of this row; a lower value is re-indexed |
| `indexed_gmt` | `DATETIME NOT NULL` | When the row was written |

Indexes: `PRIMARY KEY (attachment_id)`, `KEY status_uploaded (status, uploaded_gmt, attachment_id)`,
`KEY status_folder (status, folder_id)`, `KEY status_kind (status, kind)`, `KEY status_month (status,
month)`, `KEY status_size (status, filesize)`, `KEY status_pixels (status, pixels)`, `KEY trashed
(status, trashed_gmt)`.

Title and MIME sorts join `wp_posts` by primary key. In per-user mode, folder filters read FileBird's
relation table directly (read-only), because `folder_id` mirrors the shared tree only.

### 8.2 `wpu_usage` and `wpu_usage_sources` (P2, `UsageIndex`)

`wpu_usage`: one row per (attachment, using post or site slot, context).

| Column | Type | Notes |
|---|---|---|
| `attachment_id` | `BIGINT UNSIGNED NOT NULL` | |
| `source_id` | `BIGINT UNSIGNED NOT NULL` | The using post's id; 0 for site-level uses |
| `context` | `VARCHAR(32) NOT NULL` | A `USAGE_CONTEXTS` value |

Indexes: `PRIMARY KEY (attachment_id, source_id, context)`, `KEY source (source_id)`.

`wpu_usage_sources`: which posts have been scanned.

| Column | Type | Notes |
|---|---|---|
| `source_id` | `BIGINT UNSIGNED NOT NULL` | Primary key; 0 = the site-level slots |
| `scanned_gmt` | `DATETIME NOT NULL` | Compared with the post's `post_modified_gmt` |
| `row_version` | `SMALLINT UNSIGNED NOT NULL` | Parser version; a lower value is rescanned |

**Indexable posts:** every post type with `show_ui` except `attachment`, `revision`, `nav_menu_item`,
`wp_global_styles`, `wp_font_family`, `wp_font_face`; statuses `publish`, `future`, `draft`, `pending`,
`private`. (`wp_template`, `wp_template_part`, `wp_block` and `wp_navigation` are included: synced
patterns and templates use media too.)

**What the parser finds** (P2, spike X7 tunes it):

| Context | Found as |
|---|---|
| `featured` | `_thumbnail_id` meta |
| `image-block`, `gallery-block`, `file-block`, `cover-block`, `media-text`, `video-block`, `audio-block` | The block's attachment id attribute(s) (`id`, `ids`, `mediaId`, gallery inner image blocks) in `post_content`, via `parse_blocks()` |
| `content` | `wp-image-<id>` classes, or an upload URL that resolves to the attachment (`attachment_url_to_postid()` on the original or a sub-size URL), outside the blocks above |
| `shortcode-gallery` | `[gallery ids="…"]` |
| `site-logo`, `site-icon` | `site_logo` and `site_icon` options (`source_id` 0) |
| `visual-portfolio` | Visual Portfolio galleries (D22, feature `usage-visual-portfolio`, only while that plugin is active; spike X10 confirms the storage): (1) the `images` attribute of a `visual-portfolio/block` and `imagesQuery.images` of its loop-gallery blocks, in the post that contains them; (2) a saved layout (`vp_lists` post) whose `vp_images` meta or layout content lists the attachment, reported on the layout itself; (3) a post that embeds a saved layout through the `visual-portfolio/saved` block (`id` attribute) or the `[visual_portfolio id=N]` shortcode, reported on that post with the layout's images. Image entries are `{id, …}` objects; entries without an id (external `imgUrl`) are ignored |

Uses in theme files, custom CSS or other plugins' settings aren't detected (inspector.md §5's
footnote).

### 8.3 Edit backups (P2)

The undo stack lives in post meta `_wpu_edit_backups` (a list, newest last, at most 10 entries, each
naming the backup file and the metadata it replaces). Backup files sit next to the original in the
uploads folder. Deleting the attachment deletes them. WordPress's own `_wp_attachment_backup_sizes` keeps
the original, so wp-admin's "Restore image" keeps working.

### 8.4 Options

| Option | Autoload | Owner | Holds |
|---|---|---|---|
| `wpu_rev` | no (read with a direct `SELECT`, §6) | P1 | §6 |
| `wpu_media_index_db_version` | yes | P1 | `MediaIndex` schema version |
| `wpu_usage_index_db_version` | yes | P2 | `UsageIndex` schema version |
| `wpu_media_index_state` | yes | P1 | `{state, done, total, staleSince}` for `/info` and `/rev` |
| `wpu_usage_index_state` | yes | P2 | same, for usage |
| `wpu_maintenance_lock` | no | P1 | lock expiry timestamp |
| `wpu_installed_version` | yes | P1 | last `WPU_VERSION` that ran (upgrade detection) |

## 9. Install modes, schema and deactivation

### 9.1 One file, two modes

The build (`plugin/scripts/build.mjs`) produces **one** PHP file, `wp-upload-companion.php`, plus a zip
and the sidecars `plugin.json` (`{version, api, features}`) and `changelog.json` (D12). The same file works:

- as a **regular plugin** (`wp-content/plugins/wp-upload-companion/wp-upload-companion.php`, installed
  from wp-admin with Plugins → Add New → Upload): `install: "plugin"`;
- as a **must-use plugin** (`wp-content/mu-plugins/wp-upload-companion.php`): `install: "mu-plugin"`
  (detected by comparing `__FILE__` with `WPMU_PLUGIN_DIR`).

It has no admin UI, no front-end hooks, no assets and no settings.

### 9.2 Schema creation and upgrades

- Never relies on `register_activation_hook` (mu-plugins don't fire it).
- On `plugins_loaded`, the plugin creates `wpu_rev` (`add_option`, value = the current time in ms) if
  it doesn't exist.
- On `plugins_loaded`, each index compares its `*_db_version` option with its code's version; when they
  differ it runs `dbDelta()` under a short lock (`add_option` of a lock key), updates the option, and
  marks its index `building` if the change needs a re-index (`row_version` bump).
- Also on `plugins_loaded`: if `wpu_installed_version` differs from `WPU_VERSION`, run upgrade steps and
  bump `wpu_rev`.

### 9.3 Deactivation and reactivation

- `register_deactivation_hook` (regular plugin only) sets both indexes' state to `stale`
  (`staleSince` = now) and bumps `wpu_rev`. While the plugin is off, no hook runs, so changes are missed.
- After reactivation, `/info` and `/rev` report `stale`; the server's maintenance loop reconciles
  (§5.21) and the state returns to `ready`. Until then, `collection` and `facets` say
  `indexComplete: false`.
- A mu-plugin can't be deactivated, and a regular plugin can be removed without its deactivation
  hook running; either way hooks were missed. To catch that, `/info` runs a cheap consistency check
  (cached for 60 s in a transient): the number of attachments vs index rows, and the newest
  attachment `post_modified_gmt` vs the newest `indexed_gmt`; for usage, the newest indexable post
  `post_modified_gmt` vs the newest `scanned_gmt`. A mismatch marks that index `stale`. The server also
  runs one maintenance step per process start (server-api.md §9.2), which reconciles anyway.

### 9.4 Uninstall

`register_uninstall_hook` (regular plugin only) drops `wpu_media_index`, `wpu_usage` and
`wpu_usage_sources`, deletes every `wpu_*` option and the `_wpu_edit_backups` meta. Media files, including
edit backups, are left untouched. For a mu-plugin, removing the file leaves the tables; they are
harmless, and a later install reuses them.

### 9.5 Multisite

Tables use `$wpdb->prefix`, so per-site activation works. Network activation and network-wide behaviour
are untested in v1.

## 10. FileBird integration

### 10.1 Rules (D17)

- **Never** alter FileBird's schema or indexes, **never** write to `{prefix}fbv`,
  `{prefix}fbv_attachment_folder` or FileBird's options directly.
- **Mutations** only through FileBird's own PHP functions, so its hooks fire (§10.3).
- **Reads** may query `{prefix}fbv` and `{prefix}fbv_attachment_folder` read-only, and read the
  `fbv_folder_colors` and `njt_fbv_folder_per_user` options.
- FileBird's REST routes (`filebird/v1`, `filebird/public/v1`) are not used (D2).
- `FileBird\Adapter` (P1) feature-detects FileBird's classes and methods and is the only code that touches
  FileBird. Contract tests are pinned to FileBird Lite 6.5.9.

### 10.2 Detection (`/info.filebird`)

| Field | How |
|---|---|
| (null) | FileBird is not installed |
| `active` | FileBird's main class is loaded (e.g. `FileBird\Model\Folder`); `false` when installed (found by `get_plugins()`) but inactive |
| `version` | `NJFB_VERSION`, or the plugin header |
| `pro` | **FileBird Pro detected**, by the method spike X9 settles (D15: from Lite's source and public signals, no licence). If X9 can't make it reliable, always `false` in v1, which hides Pro features |
| `perUser` | The `njt_fbv_folder_per_user` option is truthy |

When `active` is false, folder routes answer 409 `wpu_filebird_inactive` and `wpu.folder` is null.

### 10.3 Which FileBird code each mutation uses

| Plugin route | FileBird code (6.5.9) | Notes |
|---|---|---|
| `POST /folders` | `FolderModel::newUniqueFolder()` (what its public API uses), else `newOrGet()` plus our own suffix check | Auto-suffix "(1)…(15)" |
| `PATCH` name | The model method behind FileBird's `update-folder` (`Folder.php:392-433`) | FileBird refuses duplicates; the adapter picks the first free "Name (N)" first, reading siblings read-only |
| `PATCH` parent / position | The move/reorder logic behind `update-folder-ord` (`FolderController.php:146-353`), called in PHP with a `WP_REST_Request` it builds (`dropPosition` as an integer) | Its cycle check (`isSelfOrDescendant`) is mirrored by ours first, for a clean 409 |
| `PATCH` color | The logic behind `update-folder-color` (`FolderController.php:59-89`), which stores `fbv_folder_colors` | Pro detected only (D15) |
| `DELETE` | `FolderModel::deleteFolderAndItsChildren()` (`Folder.php:647-680`) | Recursive |
| `POST /folders/assign` | `FolderModel::setFoldersForPosts($ids, $folder)` (documented) | One call for all allowed ids |

If a method is missing in a FileBird version, the adapter returns 501 `wpu_not_implemented` for that
operation (never a direct table write), and `/info` keeps reporting FileBird's version so the problem is
visible.

**Per-user mode** (D10): FileBird caches the user at `plugins_loaded`, before Application Password
authentication, so its own mutations misbehave for API clients (research 02 §2.1). The plugin therefore
refuses every folder mutation with 409 `wpu_filebird_per_user` and serves reads from the current user's
tree (§5.16).

### 10.4 Uploads into a folder

The server files an uploaded item with `POST /folders/assign`. If spike X6 shows that FileBird's
`add_attachment` handler honours `?fbv=<id>` on `POST /wp/v2/media` with an Application Password, the
server may use that instead; nothing in this contract changes.

## 11. Security

- **Authentication and capabilities:** WordPress's Application Password only; `upload_files` on every
  route; per-item `edit_post`/`delete_post`; `edit_post` on attach targets (§1.3). Errors never leak more
  than the user could see in wp-admin.
- **SQL:** every query uses `$wpdb->prepare()`. Sort keys, filter values and columns come from
  whitelists, never from request strings. Search terms are escaped with `$wpdb->esc_like()`.
- **Input:** every parameter is validated against the limits in §5 before work starts; unknown body
  fields are rejected; ids are cast to integers.
- **Files:** replacement uploads go through `wp_handle_sideload()` with `test_form => false`, are checked
  with `wp_check_filetype_and_ext()` against the user's allowed MIME types, must match the item's MIME
  type, and are written only to the item's own path. SVG replacement is allowed only if this user may
  upload SVG at all (a plugin like Safe SVG decides; we add no SVG support). Paths are built from
  WordPress's stored relative path, never from the request.
- **Resources:** time budgets (§1.6), the item lock, the maintenance lock, and caps on every list keep
  one request from monopolising the site.
- **Output:** plain text and URLs only; no HTML is rendered by the plugin. Raw post content (`wpu.raw`) is
  only returned to users with `upload_files`, who can read it in wp-admin anyway.
- **Errors:** caught `Throwable`s become 500 `wpu_internal` with a generic message; the detail goes to the
  PHP error log only.
- **No front-end footprint:** no public routes, no shortcodes, no assets, nothing on the site's pages.
- **Review:** a security review of the plugin is part of M5 (implementation plan §7).

## 12. Route summary

| Method | Route | Feature | Capability | Bumps rev | Owner |
|---|---|---|---|---|---|
| GET | `/info` | — | `upload_files` (403 identifiable) | no | P1 |
| GET | `/rev` | — | `upload_files` | no | P1 |
| GET | `/collection` | `collection` | `upload_files` | no | P1 |
| GET | `/facets` | `facets` | `upload_files` | no | P1 |
| POST | `/media/batch` | `media-batch` | + `edit_post` per item (and on the attach target) | yes | P2 |
| POST | `/media/trash` | `trash` | + `delete_post` per item | yes | P2 |
| POST | `/media/delete` | `trash` | + `delete_post` per item | yes | P2 |
| GET | `/trash` | `trash` | `upload_files` | no | P2 |
| POST | `/trash/restore` | `trash` | + `delete_post` per item | yes | P2 |
| POST | `/trash/empty` | `trash` | + `delete_post` per item (others skipped) | yes | P2 |
| GET, POST | `/usage` | `usage` | `upload_files` | no | P2 |
| POST | `/media/{id}/edit` | `image-edit` | + `edit_post` | yes | P2 |
| POST | `/media/{id}/edit/undo` | `image-edit` | + `edit_post` | yes | P2 |
| POST | `/media/{id}/restore` | `image-edit` | + `edit_post` | yes | P2 |
| POST | `/media/{id}/regenerate` | `image-regenerate` | + `edit_post` | yes | P2 |
| POST | `/media/{id}/replace` | `image-replace` | + `edit_post` | yes | P2 |
| GET | `/folders` | `folders` | `upload_files` | no | P1 |
| POST | `/folders` | `folders` | `upload_files` | yes | P1 |
| PATCH | `/folders/{id}` | `folders` (`folder-colors`) | `upload_files` | yes | P1 |
| DELETE | `/folders/{id}` | `folders` | `upload_files` | yes | P1 |
| POST | `/folders/assign` | `folders` | + `edit_post` per item | yes | P1 |
| POST | `/maintenance/step` | `maintenance` | `upload_files` | when it changed data | P1 |
| (field) | `wpu` on `/wp/v2/media` | — | `upload_files` (else null) | — | P1 + P2 providers |
