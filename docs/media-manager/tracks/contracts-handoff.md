# Handoff: contracts track (M0-C)

Branch `mm/contracts`, from `feature/media-manager` @ `c1e5e0b`. For the owner's review at
**Checkpoint 4**; after approval the contracts are frozen and only the orchestrator changes them.

## Summary

| Deliverable | Where |
|---|---|
| Plugin contract (`wp-upload/v1`): every route with params, limits, responses (types + JSON), errors, capabilities, rev bumps, time budgets; `/info`'s frozen shape; versioning and the additive-only policy; the `wpu` field and its provider model; `wpu_rev` and the hooks that bump it; install modes, schema and deactivation; the plugin's tables; FileBird integration (D17); security | [`contracts/plugin-api.md`](../contracts/plugin-api.md) |
| Server contract (`/api/library/*`): every route with params, DTOs (with JSON examples), errors and caching; the error envelope and the full mapping table with its precedence (401 → 502 wins); revision, LRU, ETag/304, single-flight; compression; every limit and timeout; the DTO field reference | [`contracts/server-api.md`](../contracts/server-api.md) |
| Types for every DTO and request, plus `as const` lists (`MEDIA_KINDS`, `SORT_KEYS`, `TYPE_FILTERS`, `ERROR_CODES`, `PLUGIN_STATES`, `JOB_STATES`, `USAGE_CONTEXTS`, `PLUGIN_FEATURES`, `LIMITS`, …). Dependency-free, no enums | `shared/library-api.ts` |
| Plugin wire types (`PluginInfo`, `WpuField`, batch envelopes, image-op and maintenance responses) | `shared/plugin-api.ts` |
| zod schemas for all 111 types, with a **type-level drift check**: each schema's inferred type must be *identical* to its hand-written type, or the typecheck fails (verified by introducing a deliberate mismatch) | `shared/library-api.schema.ts` |
| Fixtures typed with `satisfies`: 20 items from the prototype's sample data (tile and full views; 2 trashed, 1 processing, 1 edited), the prototype's 16-folder tree (Lite, Pro and per-user variants, create/delete/assign results), collection and facets, a bootstrap for each of the six `plugin.state`s plus WordPress unreachable/auth-failed and Author/trash/Pro/per-user/no-FileBird/indexing variants, a job in each state, usage, posts, mutation results, error bodies, and plugin responses (`/info`, 403, `wpu` field, maintenance) | `shared/fixtures/*.ts` |
| A test that parses every fixture with its schema and cross-checks rows vs items and facets vs folder counts, plus negative cases for the request schemas (63 tests, passing) | `shared/fixtures/fixtures.spec.ts` (runs once CR-5 is applied) |
| `shared/package.json` = `{"type":"module","private":true}` | `shared/package.json` |

Checks run before committing: `npx @biomejs/biome check shared docs/media-manager/contracts` (clean);
`npm run typecheck -w server` and `npm run typecheck -w client` (clean, spike files removed); the spike
checks below.

## Spike M0-1: `shared/` types

**Result: the mechanism works. Use `shared/` (no fallback to `server/src/contracts/`), with change
requests CR-1 to CR-3.**

| Check | How | Result |
|---|---|---|
| Server typecheck with a server file importing types and an `as const` list from `shared/` (`.ts` extension) | temporary `server/src/spike.ts` importing `library-api.ts`, `plugin-api.ts` and (type-only) the schema; `npm run typecheck -w server` | **Pass**, including all 111 drift checks |
| `shared/package.json` needed? | the same check without it | **Yes.** Without it, `nodenext` treats `shared/*.ts` as CommonJS: `TS1287`/`TS1295` errors under `verbatimModuleSyntax` |
| Imports between `shared/` files | `plugin-api.ts` → `library-api.ts` (type-only), schema and fixtures → `library-api.ts` (values), `fixtures/index.ts` re-exports | Server: **pass**. Client: see the next row |
| `allowImportingTsExtensions` needed on the client? | client file importing `shared/fixtures`, `shared/library-api.schema` and `shared/library-api` without extensions; `npm run typecheck -w client` | **Yes, for value imports between shared files** (`TS5097` on `fixtures/index.ts`, `fixtures/plugin.ts` and the schema). **Type-only** `.ts` imports and `library-api.ts`/`plugin-api.ts` alone pass without it. With `--allowImportingTsExtensions` (or `--rewriteRelativeImportExtensions`) everything passes → CR-2 |
| Node runtime | `node server/src/spike.ts` (host Node 26), and in the **distroless `nodejs24` image** (Node 24.22.3) built from a copy of the Dockerfile with CR-3's lines | **Pass** in both. Type-only imports of the schema are erased, so zod isn't needed at runtime. (Node 24 also runs it without `shared/package.json`, by syntax detection, but the typecheck needs the file, so copy it) |
| Client `vite build` | temporary lib-mode Vite config bundling a client file that imports from `shared/` (no extension) and runs the zod schema; plus the full `npm run build` inside the Docker client-builder stage | **Pass** (Vite resolves extensionless and `.ts` imports; zod bundles) |
| Vite dev server | `vite` dev, fetched the transformed client file and the `/@fs/…/shared/*.ts` modules | **Pass**: Vite's default `server.fs.allow` is the workspace root (from the root `package.json` `workspaces`), which contains `shared/`; no config change |
| Docker | `docker build` of a temp Dockerfile = the repo's + CR-1 (zod, simulated with `npm install --no-save`) + CR-2 (simulated with `sed` in the build) + CR-3's `COPY` lines, then `docker run` of the server spike | **Pass** |
| Server Vitest over `shared/` specs | temp Vitest config with `include: ['src/**/*.spec.ts', '../shared/**/*.spec.ts']` | **Pass** (62 tests) → CR-5 |
| Server typecheck of all of `shared/` | temp tsconfig adding `"../shared/**/*.ts"` to `include` | **Pass** → CR-6 |

Notes for the Docker change:

- `shared/` is not a workspace and has no dependencies, so it is **not** needed in either `npm ci`
  stage (no lockfile impact).
- **client-builder** needs **all** of `shared/` before `npm run build` (`tsc -b` typechecks the mocks,
  which import fixtures and schemas).
- **final** needs only the runtime files. Copying them by name (CR-3) enforces the runtime rule: if
  server code ever imports the schema or fixtures at runtime, the image fails at start instead of
  silently shipping test data. A new runtime file in `shared/` then needs a `COPY` line too.
- The image's `server-deps` stage installs production dependencies only, so zod (a root
  devDependency) is correctly absent from the final image.

All temporary spike files (`server/src/spike.ts`, `client/src/spike*.ts`, the Vite config, temp
tsconfig/Vitest configs) were deleted before committing; the temporary Dockerfile lived outside the repo.

## Change requests (orchestrator-owned files)

### CR-1: zod as a root devDependency

`package.json` (root), then `npm install` to update the lockfile (zod 4.6.7 was used for the checks):

```diff
   "devDependencies": {
     "@biomejs/biome": "2.5.14",
     "concurrently": "^9.1.0",
     "husky": "^9.1.7",
-    "typescript": "^7.0.2"
+    "typescript": "^7.0.2",
+    "zod": "^4.6.7"
   }
```

Root, because `shared/` isn't a workspace: server tests and client mocks both resolve `zod` from
`shared/` by walking up to the root `node_modules`. It must stay a **dev** dependency (runtime rule).

### CR-2: client tsconfig allows `.ts` imports

`client/tsconfig.json`:

```diff
     "jsx": "react-jsx",
     "types": ["vite/client"],
     "isolatedModules": true,
+    "allowImportingTsExtensions": true,
     "moduleDetection": "force",
```

Valid because the base config has `noEmit: true`. Needed as soon as client code imports fixtures or
schemas (F2's mocks and tests).

### CR-3: Dockerfile copies `shared/`

```diff
 RUN npm ci
+COPY shared shared
 COPY server server
 COPY client client
 RUN npm run build
@@ final stage
 COPY server/package.json server/package.json
 COPY server/src server/src
+COPY shared/package.json shared/package.json
+COPY shared/library-api.ts shared/library-api.ts
+COPY shared/plugin-api.ts shared/plugin-api.ts
 COPY --from=client-builder /app/client/dist client/dist
```

### CR-4: response compression

`server/package.json` (via `npm install compression@^1.8.0 -w server` and
`npm install -D @types/compression -w server`); server-api.md §3.4 relies on it (gzip, brotli since
1.8.0):

```diff
   "dependencies": {
     "axios": "^1.7.9",
+    "compression": "^1.8.0",
     "dotenv": "^16.4.7",
@@
   "devDependencies": {
+    "@types/compression": "^1.8.0",
     "@types/express": "^4.17.21",
```

### CR-5: server Vitest also runs `shared/` specs

`server/vitest.config.ts`:

```diff
-    include: ['src/**/*.spec.ts'],
+    include: ['src/**/*.spec.ts', '../shared/**/*.spec.ts'],
```

### CR-6: server typecheck covers all of `shared/`

`server/tsconfig.json`, so the drift checks and fixtures are typechecked in CI even before any server
file imports them (needs CR-1):

```diff
-  "include": ["src/**/*.ts"]
+  "include": ["src/**/*.ts", "../shared/**/*.ts"]
```

### CR-7: `biome ci .` already fails on the branch (not caused by this track)

`npm run check` fails on `feature/media-manager` @ `c1e5e0b` because of committed design files:
`docs/media-manager/design/scripts/token-report.mjs` (`noFlatMapIdentity`) and
`docs/media-manager/design/prototype/css/components.css` (4 × `noDescendingSpecificity`). Suggested fix
in `biome.json` (the prototype is reference material, not shipped code):

```diff
-    "includes": ["**", "!package-lock.json"]
+    "includes": ["**", "!package-lock.json", "!docs/media-manager/design/**"]
```

### CR-8: spec lines the contracts supersede (for the M0 strike pass)

- `design/interaction-spec.md` §1 "Trash view (not yet in the URL)": now `folder=trash`
  (server-api.md §6).
- `design/interaction-spec.md` §12 and `design/specs/folders.md` §10: the `fbv_folder` field and
  `/wp/v2/media?fbv=` listing are replaced by `wpu.folder` and the plugin's `/collection`.
- `design/specs/inspector.md` §10: the proposed edit body `{rotate, flipH, flipV, crop, scale, applyTo}`
  and `usage` shape are replaced by `EditRequest` (an ordered `ops` list) and `UsageRef`.
- `design/specs/system.md` §8: the where-used shape `[{id, type, title, context}]` is replaced by
  `UsageRef`; "processing status" is `sizesPending` / the `processing` job state.

## Decisions taken (please confirm)

Where the plan left something open, I chose the simplest option that satisfies the specs.

**Revision and caching**

1. **`rev` is an opaque decimal string.** A bump sets `max(rev + 1, now in ms)` in **one atomic SQL
   `UPDATE`** (no read-modify-write through the options cache), so concurrent bumps never collide and a
   reinstalled plugin never reuses an old value (plugin-api.md §6). Routes read it *before* querying.
2. **Added a plugin `GET /rev`** (not in the plan's route table) for cheap polling; the server caches it
   for 2 s and the client polls `api/library/rev` every 15 s while visible.
3. **Post saves bump `rev` only when the post's usage rows change**, so editing posts doesn't invalidate
   the library caches.
4. Server LRU: 30 s TTL, 200 entries / 64 MB, single-flight; ETag `W/"<rev>-<query hash>"`; compression
   ≥ 1 kB with gzip or brotli.

**Collection, facets, items**

5. **Seven media kinds** (`image`, `svg`, `video`, `audio`, `document`, `archive`, `other`) with frozen
   numeric codes for the rows; `type=document` covers document, archive and other. Width/height **0 =
   unknown** (the prototype used 1).
6. **Facets have two scopes:** `view` (exactly the filtered collection: filter-bar summary, inspector
   summary) and `folder` (folder only: type chips, missing-alt chip, alt coverage, months), matching
   what the prototype computes. `editable` for Authors = their own items.
7. **Search** matches title, caption, description, alt, original file name, file path and EXIF
   title/caption/keywords; terms are ANDed.
8. `month` uses the site's time zone (as wp-admin); size filters are decimal MB; orientation thresholds
   1.1 / 0.9 (all from the prototype). Every sort ends with the id as the tiebreaker, with the direction
   per key listed in server-api.md §6.
9. **`folder` other than `all`/`trash` without FileBird → 409**, unknown folder id → 404.
10. **`folder=trash` ignores every other filter and sort** (system.md §7) and is ordered newest-trash
    first. `daysLeft` follows `EMPTY_TRASH_DAYS` (null only when it is 0), since WordPress's daily purge
    runs whether or not `MEDIA_TRASH` is on.
11. **Hydration uses `context=view` plus the `wpu` field**, not `context=edit` (which silently drops
    items an Author can't edit). Raw title/caption/description come from `wpu.raw`.
12. **The `wpu` field carries more than the plan listed**: `kind`, `width`, `height`, `filesize`,
    `trashedAt`, `duration`, `pages`, `poster`, `original`, `raw`, `author`, `undoable`, `editedAt` (the
    inspector's "edited on"; owners per key in
    `WPU_FIELD_PROVIDERS`). This makes rows and items agree exactly and saves `_embed` calls.
13. **Tile vs full view** split as in server-api.md §8.1; tiles include `perms`, `authorId`, `folder`,
    `url`, `poster`, `duration`, `pages`, `sizesPending` and `trash`.
14. **Collections over 250 000 items → 422 `wpu_collection_too_large`.**
15. **Collection visibility mirrors core's read check** (attachments of unreadable parents, and
    others' trashed items, are left out for Authors), so every row hydrates; a row that still comes
    back `missing` is dropped by the client, which refetches the collection.
16. PDF page count is best effort; `exif.lens` only when the plugin captured it.

**Trash and delete**

17. **The Trash view uses `collection?folder=trash` + `items?ids=`** like the grid. `GET /trash` (plugin
    and server) is a summary (`enabled`, `days`, `count`, `bytes`); `TrashItem` = a tile with `trash` set.
    The plan's "`GET /trash` with trashedAt and daysLeft" is satisfied through the items.
18. **Per-item mutation routes are time-budgeted (20 s) and return `remaining`** ids, which the server
    re-sends. `trash/empty` is one budgeted step per call; the client loops while `remaining > 0`
    (no job).
19. **Mutation limits: 100 ids per request** for batch, delete and restore; the **client** chunks larger
    selections and shows progress (the server doesn't). `folders/assign` takes 5000, `regenerate` 1000.

**Metadata**

20. **Two `items/batch` forms:** `{ids, set, appendDescription?}` (batch edit) and `{items: [...]}` (per-item
    Undo).
21. **Metadata is last-write-wins** (no `expectedModified`). An alt-only change doesn't change
    `modifiedAt` (as in WordPress); title/caption/description/attach do.
22. Field limits: title 1000, alt 1000, caption 5000, description 65 535 characters.

**Image operations**

23. **Edits are an ordered `ops` list** (`rotate` clockwise 90/180/270, `flipH`, `flipV`, `crop` in pixels
    of the image after the preceding ops) plus `scale`, matching the editor's recipe order.
24. **Every image operation updates `post_modified`**, so `expectedModified` detects concurrent edits.
25. **Target: same id and same URL** (spec promise). If spikes X2/X3 can't keep the URL, `urlChanged:
    true` reports it (see open questions). The client cache-busts displayed renditions with
    `?v=<modifiedAt>`.
26. Image jobs share the upload concurrency budget; only upload jobs can be cancelled.

**Folders**

27. **Flat folder list** (`parent`, `ord`), recursive counts summed by the client; every mutation returns
    the **whole tree** so the client never patches `ord`s itself. `position` is a 0-based index among the
    new siblings **counted without the moved folder**; Undo of a move is a PATCH back to the old parent
    and old index (also counted without it).
28. **Per-user mode:** reads show the current user's own tree (resolved at request time, not FileBird's
    cached user 0); all mutations → 409.
29. `filebird: null` = not installed; `{active: false}` = installed but inactive (treated like null).
30. **Colours are Pro-only in both directions:** `color` is null on Lite even when FileBird has stored
    colours (folders.md §1, plan §0); writes need Pro detected (`mode.colorsWritable`). (The synthesis's
    D3 allowed showing existing colours read-only on Lite; the newer folders spec and plan win.)

**Errors, bootstrap, versioning**

31. **Upstream 403 → 403 `forbidden`** for library routes (today's `upstreamErrorStatus` maps 403 to 502;
    the legacy routes keep that until M5). `rest_no_route` → 409 `plugin_missing`; other 400s → 400
    `invalid_request`.
32. **`/info` answers 403 with `data.{plugin, version, api}`**, so a `forbidden` plugin is still
    identified. Any other 403 on `/info` → `wp.state: unreachable`.
33. Library routes answer **409 `plugin_incompatible`** while the plugin state blocks the app, and **409
    `feature_unavailable`** when an optional feature is missing.
34. `/info` gained `install` (`plugin` | `mu-plugin`), `wpVersion` and `imageEditor` (`mimes`,
    `bigImageThreshold`); the frozen identity is `plugin`, `version`, `api`, `features`.
35. API 1.0 lists all eleven features; the first release is `1.0.0`. Minimums: WordPress 7.0, PHP 8.1
    (header `Requires at least` / `Requires PHP`); below them the plugin registers no routes, so the app
    shows onboarding.
36. **Missed hooks are detected:** `/info` runs a cheap count/date consistency check (cached 60 s) that
    marks an index `stale`, and the server runs one maintenance step per process start.

**Upload, jobs, posts, download**

37. **New job states** for library routes: `queued`, `running`, `processing` (uploads: bytes sent,
    WordPress making sizes), `succeeded`, `failed`. The legacy `/api/media/jobs` keeps its
    `success`/`error` until M5.
38. The upload's folder field is `folder` (0 or absent = Uncategorized); today's route calls it
    `folderId`.
39. One job registry; `upload/jobs` only finds upload jobs. Poll intervals: uploads 1 s, image jobs
    1.5 s.
40. `posts` uses core `/wp/v2/search`, so **only published posts** can be picked for Attach; its
    `editUrl` is always set (core can't tell), while usage refs and `attachedTo` null it when the user
    can't edit the post.
41. `items/:id/download?variant=file|original`.

**Plugin internals**

42. Usage contexts add **`video-block` and `audio-block`** (the prototype uses them); site-level uses
    have `postId: null`, `postType: "site"`, and are listed first, then featured uses, then by title.
43. `set.post` attaches with a post id ≥ 1 and detaches with `null` only (0 is rejected).
44. The zod request schemas are strict (unknown keys fail) and encode the cross-field rules (at least
    one change; not both `set.description` and `appendDescription`; an edit needs an op or a scale),
    so F2's mocks reject what the real server rejects.
45. A third table, **`wpu_usage_sources`**, records which posts were scanned; edit backups live in
    `_wpu_edit_backups` meta plus files next to the original.

## Open questions

1. **Same URL after an in-place edit (spike X2).** wp-admin's editor saves edits under a new file name
   (`-e<timestamp>`), which changes the URL; the spec promises "same file, same URL". The contract
   targets same-URL (our own write path with backups) and has `urlChanged` as an escape hatch. If X2
   lands on `wp_save_image()` semantics, the UI copy ("The URL stays the same") must change. Which do you
   prefer if both are feasible: wp-admin parity (new URL; posts keep showing the old version) or
   overwrite in place (posts update; CDN/browser caches may lag)?
2. **Replacing a `-scaled` image (spike X3)** may not keep the URL for some inputs; the contract reports
   it with `urlChanged`. Is a warning in the UI acceptable, or should replace refuse those cases?
3. **Drafts in the attach picker:** core search finds only published posts. Acceptable for v1, or add a
   plugin `/posts` route (an additive feature)?
4. **Large mutations:** batch/delete/restore are client-chunked at 100 per request. Fine for the spec's
   flows; should "select all 50k → delete" ever need to survive a page reload, it would need server
   jobs instead.
5. **Per-user mode reads:** the contract shows the current WordPress user's own folders. FileBird's
   behaviour for Application Password users in per-user mode is unverified (research 02 §2.1); D18's
   per-user live check should confirm this is what users expect.
6. **Usage index scope:** post types and block attributes covered are listed in plugin-api.md §8.2.
   Page builders, ACF fields and WooCommerce galleries are not detected (the UI says so). OK for v1?
7. **CR-7:** should the design prototype stay excluded from Biome, or be fixed?
