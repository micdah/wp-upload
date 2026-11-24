# Track S2 (M1): handoff

Branch `mm/s2`, from `mm/s1` @ `ecc1eab`, with S1's later commits merged in (`git merge mm/s1`, a
fast-forward to `36bf149`). Scope: the write side of [server-api.md](../contracts/server-api.md):
§7.7–7.10 and §7.12–7.17, plus the job registry and the upload `fileInto` hook.

## What works

Every route has route specs in S1's style (`fakeLibrary()` + supertest, fixtures from
`shared/fixtures/`, answers parsed with the zod schemas):

| Route | Where | What |
|---|---|---|
| `POST items/batch` | `routes/library/batch.ts` | Both forms (`{ids, set, appendDescription?}` and `{items: […]}`), strict validation with `details.param` paths (`items[2].set.alt`), S1's `parseItemPatch` for `set`, the cross-field rules (empty `set` only with `appendDescription`, never both `set.description` and `appendDescription`, no duplicate ids in `items`), 1–100 items, `remaining` re-sent with `sendUntilDone`, results in request order |
| `POST items/delete` | `delete.ts` | `{ids (1–100), mode: trash\|delete}` → `/media/trash` or `/media/delete`, `remaining` re-sent; 409 `wpu_trash_disabled` passes through |
| `GET trash`, `POST trash/restore`, `POST trash/empty` | `trash.ts` | `GET` cached per rev with ETag/304 (S1's `serveCachedRead`); restore re-sends `remaining`; empty runs one plugin step (`{}`: the plugin's 10 s default) and accepts no body or `{}` |
| `GET usage`, `POST usage` | `usage.ts` | 1–100 ids, cached per rev and id list (both methods share the entry); `POST {ids}` mirrors the plugin's `POST /usage` and keeps the route the scaffold registered |
| `GET posts` | `posts.ts`, `normalise/posts.ts` | Core `/wp/v2/search?type=post&subtype=any`, `search` trimmed and collapsed (≤ 200 characters), `limit` 1–20 (default 10); labels from S1's `postTypes()`; titles entity-decoded and tag-stripped, `(no title)` when empty |
| Image operations | `images.ts` | `items/:id/edit`, `edit/undo`, `restore`, `replace` (multipart) and `items/regenerate` (the scaffold's `/regenerate` path fixed): synchronous validation (400), `requireFeature` (409 `feature_unavailable`) before multer reads an upload, then 202 `{jobId}`; the job calls the plugin with the idle timeout and re-hydrates the item (`view=full`) for `result.item` |
| `GET jobs` | `jobs.ts` (route) | 1–100 job ids, deduplicated, in order; `not_found` for unknown or expired ids |
| `POST upload`, `GET upload/jobs`, `DELETE upload/jobs/:id`, `GET upload/check` | `upload.ts`, `normalise/upload.ts` | See "Uploads" below |
| `GET items/:id/download` | `download.ts`, `normalise/download.ts` | Looks the item up (`fetchMedia`), streams `url` (or `wpu.original.url` for `variant=original`, falling back to the file) with `Content-Disposition` (ASCII `filename` + RFC 5987 `filename*`), the item's MIME type, `Content-Length` when known, `private, no-store`, never compressed; at most 3 redirects, http(s) only |
| `GET plugin/download` | `pluginDownload.ts` | Serves `<bundle dir>/wp-upload-companion.zip` (the name P1's `build.mjs` writes) as `wp-upload-companion-<version>.zip`, `ETag: "<version>"`, 304 on a match, `private, max-age=0, must-revalidate`; 404 `plugin_not_bundled` without the zip or without `plugin.json` |

**The job registry** (`lib/library/jobs.ts`):

- One in-memory registry for every kind (`upload`, `edit`, `edit-undo`, `restore`, `replace`,
  `regenerate`). `jobs` finds all of them, `upload/jobs` only uploads.
- A job waits in `queued` for a slot of the shared budget (`acquireSlot`/`releaseSlot` from
  `uploadJobs.ts`, so legacy uploads and library jobs share `UPLOAD_CONCURRENCY`), then `running`;
  uploads switch to `processing` once the last byte has been handed to the connection.
- `progress`: bytes for uploads and replace, items for regenerate.
- `error` is `toLibraryError(err).body`: a WordPress 401 is `wp_auth_failed`, plugin codes pass
  through with their `details` (e.g. `wpu_stale` + `modifiedAt`).
- Finished jobs stay readable for `LIMITS.finishedJobTtlMs` (10 minutes), then `not_found`.
- Only upload jobs can be cancelled: a queued one never starts and frees its temp file at once; a
  running one is aborted. Either way it reads `not_found` at once (as the legacy page does).
- `lookupJob()` answers a copy, so a poll never sees a half-updated job.

**Uploads** (`routes/library/upload.ts`):

- multer to a temp file (`receiveFile` in `jobs.ts`: UTF-8 names, `MAX_FILE_SIZE_MB` read per
  request, 413 `file_too_large` and 400 `upload_error` from the app's error handler), 202 as soon as
  the file is on disk.
- The job streams the file to `POST /wp/v2/media` with an exact `Content-Length` and the idle
  timeout, files the new item, then reads it back as a tile.
- **Filing** (spike X6: through the plugin, not `?fbv=`) uses the new **`fileInto` strategy hook** in
  `uploadJobs.ts`: `fileIntoFolder(mediaId, folderId, fileInto)` keeps the legacy rule that a filing
  failure never fails the upload, and the library passes a strategy that calls
  `POST /folders/assign` (a `skipped` item counts as a failure). The legacy page still files through
  FileBird's public API (the default strategy), so `/api/media` is unchanged.
- `folder`: absent, empty or `0` → no filing (`result.folder: null`); a positive integer → filing;
  anything else → 400 `invalid_request`. FileBird inactive or not installed (from the last `/info`)
  → ignored (`null`); per-user mode → `{assigned: false, message}` without a call.
- `upload/check`: core `/wp/v2/media?slug=<slug of the name>` (the legacy slug rules,
  `filenameToSlug`), at most 5 matches, normalised through S1's `normaliseTile` for `title`,
  `filename` and `thumb`.

### Commands

```sh
npm run check                              # Biome: clean
npm run typecheck -w server                # clean
npm run build && npm run test -w server    # 752 passed, 15 skipped (live specs skip themselves)

dev/run test unit                          # the CI way
dev/run test server-live                   # the live specs against the test stack
dev/run up dev && dev/run seed small
(cd server && npx vitest run --config vitest.live.config.ts)   # host, against the dev stack
```

### Live checks

`server/src/routes/library/mutations.live.spec.ts`. Every library route sits behind S1's plugin
guard, so each test skips itself until the plugin's `/info` answers:

- **`/info` only** (WordPress core does the rest): `posts` (lists and searches the seeded posts) and
  `items/:id/download` (the streamed bytes equal a direct fetch of `source_url`).
- **`/info` plus the feature:** upload into a folder plus `upload/check`, `items/batch` and its Undo,
  `usage`, `trash`, edit → stale undo → undo → restore, regenerate, replace, and
  trash/restore/delete. Each works on an image the spec uploads itself, and the spec deletes what it
  created through core REST, then drains the plugin's maintenance step so the next spec sees a quiet
  rev.

## What's missing, and why

- **Nothing in the brief is left out.** The plugin-backed live checks skip in the committed setup
  until P1 and P2 are merged (see "Gate runs" for the local run against both).
- **`notImplemented.ts` has no users left.** It isn't S2's file, so it stays (CR-S2-2).

## Deviations and interpretations

1. **`index.spec.ts`: one more line than the brief allowed.** Besides the regenerate row, the
   registration check had to change: `plugin/download` now answers 404 `plugin_not_bundled` in the
   specs (no bundle), which the old `expect(res.status).not.toBe(404)` took for a missing route. The
   check now only fails on the catch-all's 404 (`code: 'not_found'`). See CR-S2-1; revert it if you'd
   rather apply it yourself.
2. **The library's upload streams its own multipart body** (`multipartFileBody` in `jobs.ts`) instead
   of calling `uploadToWordPress()`: the job needs byte progress and the moment the last byte is sent
   (`running` → `processing`), and `wpUpload.ts` (not S2's) can't report either. It reuses the legacy
   file-name quoting (`multipartFilename`), the slot budget, the temp-file model, the 202 handoff and
   `fileIntoFolder`. The same builder makes the `replace` body (with the `expectedModified` field).
   In M5, `wpUpload.ts`'s private envelope could go in favour of it.
3. **A read-back that fails after WordPress did the work** fails the job with the mapped error plus
   `details.applied: true` and `details.itemId`, so the client refetches the item instead of retrying
   (a retried upload would create a duplicate). The contract doesn't say; CR-S2-3.
4. **Regenerate:** `wp_unreachable`, `wp_auth_failed`, `wp_redirect` and `plugin_missing` fail the
   whole job (the remaining items would fail the same way); every other error is that item's
   `ItemFailure`. The job holds one slot for all its items.
5. **Replace** reports byte progress while it sends, but no `processing` state (the contract keeps
   that for uploads).
6. **Downloads never carry the Application Password**: files are fetched with a plain axios client
   (`fileAxios`), because `source_url` is often on a CDN. A site that protects its uploads behind
   WordPress authentication can't be downloaded from (open question 2). A file server's error status
   becomes 502 `wp_unreachable` with `details.upstreamStatus`; a `Content-Encoding` the server
   insists on (despite `Accept-Encoding: identity`) is passed through with the bytes.
7. **Download names:** `file` saves under the URL's basename (the original name, or the `-scaled`
   name for scaled images); `original` under `wpu.original.filename`.
8. **`POST usage`** is answered exactly like `GET usage` (cached, ETag; a 304 only if a client sends
   `If-None-Match`, which browsers don't do for POST).
9. **Feature guards** on `items/batch` (`media-batch`, as S1's `PATCH`), `items/delete` and the trash
   routes (`trash`), and `usage` (`usage`), besides the image routes the contract names. API 1.0
   lists all of them, so this only matters for a plugin that drops one.
10. **Job ids** in `jobs?ids=` must match `^[A-Za-z0-9-]{1,64}$` (400 otherwise); `upload`'s
    `folder` rejects leading zeros (`01`). Multipart bodies take at most 10 text fields.
11. **The live spec** deletes the items it uploads with core's `DELETE /wp/v2/media/<id>?force=true`,
    so it cleans up even without the `trash` feature.

## Change requests

**CR-S2-1 — `server/src/routes/library/index.spec.ts`** (applied on `mm/s2`, see deviation 1):

```diff
   it.each(contractRoutes)('registers %s %s', async (method, path) => {
     const res = await request(libraryApp())[method](path)
-    expect(res.status).not.toBe(404)
+    // Only the catch-all's 404: a route may answer its own 404 code
+    // (plugin/download without a bundled zip: plugin_not_bundled).
+    expect(res.status === 404 && res.body.code === 'not_found').toBe(false)
   })
```

**CR-S2-2 — delete `server/src/routes/library/notImplemented.ts`.** Every library route is
implemented; nothing imports it any more.

**CR-S2-3 — server-api.md wording** for what S2 had to decide:

- §7.12 and §7.15: "If the operation succeeded in WordPress but reading the item back failed, the job
  fails with that error and `details: {applied: true, itemId}`; the client refetches the item rather
  than retrying."
- §7.12 regenerate: "Errors that mean WordPress or the plugin is gone (`wp_unreachable`,
  `wp_auth_failed`, `wp_redirect`, `plugin_missing`) fail the whole job."
- §7.15: "Ignored without active FileBird" → "Without active FileBird the field is ignored and
  `result.folder` is null."
- §7.16: "The file is fetched without WordPress credentials."

**CR-S2-4 — Dockerfile (with S1's CR-S1-4):** copy the plugin build's `wp-upload-companion.zip` next
to `plugin.json` and `changelog.json` in `$WPU_PLUGIN_BUNDLE_DIR`; `plugin/download` serves it from
there under that exact name.

## Spike X6

**`?fbv=` works, but the server keeps filing through the plugin's `POST /folders/assign`.** FileBird
files an upload sent to `POST /wp/v2/media?fbv=<id>` with an Application Password, but it doesn't
check that the folder exists: a stale id writes an orphaned relation, and the item then shows in no
folder and not in Uncategorized. Details in [spikes/X6.md](spikes/X6.md).

## Open questions

1. **Read-back failures** (deviation 3, CR-S2-3): is `details.applied` the signal the client (F1's
   `core/uploads`, A4's editor) should use, or should the job succeed with a partial result instead?
2. **Downloads without credentials** (deviation 6): fine for v1, or should same-origin file URLs be
   fetched through `wpAxios` (with the Application Password) for sites that protect uploads?
3. **One slot per regenerate job:** a 1000-item regenerate holds one slot for a long time. Enough, or
   should it release the slot between items so uploads interleave more fairly?

## Gate runs (this worktree, Docker available)

| Command | Result |
|---|---|
| `dev/run test lint` | pass |
| `dev/run test typecheck` | pass |
| `dev/run test unit` | pass: 752 passed, 25 skipped (the live specs skip themselves) |
| `dev/run test server-live`, committed setup (no plugin build in `plugin/dist`) | pass: 8 passed, 17 skipped (S1's core checks pass; S2's spec skips without a plugin) |
| `dev/run test server-live` against **P1 + P2's plugin** (see below) | S2's spec: **10 of 10 pass**. One S1 test fails, see below |
| `npx vitest run --config vitest.live.config.ts` on the host against `dev/run up dev` + `seed small` (the scaffold plugin, whose `/info` answers 501) | S2's spec: all 10 skip (an earlier version without that skip ran `posts` and `download` there: both passed) |

**Against the real plugin.** To exercise the plugin-backed routes before P1 and P2 merge, I built the
companion plugin from `mm/p1` and `mm/p2` merged in memory (`git merge-tree`, no conflicts; P1's
`build.mjs`, `1.0.0-dev.1`, all twelve features) into this worktree's gitignored `plugin/dist/`, ran
`dev/run test server-live` twice, and deleted the build again. Every S2 live test passed: upload
into a FileBird folder with read-back and `upload/check`, batch and its Undo, usage, trash, edit
(rotate 90°: width and height swap, same URL, `undoable`) → a stale undo (`wpu_stale` in
`job.error`) → undo → restore, regenerate (with `wpu_not_found` for an unknown id), replace (same URL,
new size), and `items/delete` (trash and restore, or the 409 when trash is off, then delete).

**Noticed outside S2:** with that plugin, S1's `routes.live.spec.ts` test "collection answers valid
rows and 304 for its ETag" fails (200 instead of 304), also in a run where it ran before S2's spec.
The rev moves between its two requests, most likely because the first `bootstrap` starts the
maintenance loop (server-api.md §9.2) and a step changes data. S1's or the orchestrator's call; S2's
spec drains the maintenance step in its `afterAll` so it never adds to this.

Both stacks were stopped with `dev/run down` (volumes kept).

## Commits on `mm/s2`

- `36bf149` and earlier: S1's commits, merged from `mm/s1` (fast-forward)
- `cb98793` feat(server): add the library mutation, job, upload and download routes
- `f2234a1` test(server): add live specs for the S2 routes and the X6 spike note
- `533d6b8` test(server): skip the S2 live checks until the plugin answers /info
- this note
