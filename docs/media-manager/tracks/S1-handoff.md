# Track S1 (M1): handoff

Branch `mm/s1`, from `feature/media-manager` @ `e09ac4f`. Scope: the read side of
[server-api.md](../contracts/server-api.md) (§1–6; §7.1–7.6 and §7.11) plus the shared server
plumbing S2 builds on.

## For S2: the first deliverable

**`pluginClient.ts` and `errors.ts` with their final signatures are in commit `ecc1eab`.** Later
commits only added to them (validation helpers in `errors.ts`, `SEND_MAX_IDLE_ROUNDS` in
`pluginClient.ts`); nothing S2 would call was renamed. What S2 can use:

| Module | Exports |
|---|---|
| `lib/library/pluginClient.ts` | `pluginClient.*` (one typed method per plugin route, each with its §4.2 timeout; `imageReplace` takes a prebuilt multipart body), `sendUntilDone()` (re-sends `remaining` ids, results in request order), `pluginRequest()`, `wpCall()`, `wpGet()`, `wpGetHref()`, `postTypes()` (singular labels, cached 10 min, for `posts`), `TIMEOUTS`, `CallOptions` (`timeoutMs`, `signal`) |
| `lib/library/errors.ts` | `toLibraryError()` (§2.3; also maps the legacy `WpError` objects that `uploadToWordPress()` throws, for `job.error`), `LibraryError`, `invalidRequest()`, `notFound()`, `itemErrorToLibraryError()`, `asyncRoute()`, `sendLibraryError()`, and validation helpers: `queryParams()`, `parseId()`, `pathId()`, `parseIdList()`, `parseIdArray()`, `objectBody()`, `rejectUnknownFields()` |
| `lib/library/cache.ts` | `sendNoStore()` (no-store, `X-Library-Rev`, no Express ETag), `serveCachedRead()` (for `usage` and `trash` GET), `cached()`, `currentRev()`, `setNoStore()` |
| `lib/library/normalise/items.ts` | `hydrateItems(ids, 'tile' \| 'full')` for job results and uploads, `fetchMedia()`, `normaliseTile()`/`normaliseFull()`, `decodeHtml()`, `editPostUrl()` |
| `routes/library/bootstrap.ts` | `requireFeature(feature)` for the image routes (`feature_unavailable`) |

- **Every plugin response's `rev` reaches `currentRev` by itself** (the client reports it to
  `cache.ts`), so a mutation's new rev invalidates reads at once without S2 doing anything.
- **The plugin-state guard is central:** `routes/library/index.ts` runs `requireUsablePlugin` before
  every router except `bootstrap` and `plugin/download`. S2's routers don't add it.
- `libraryRouter` already has `express.json({ limit: 4 MiB })`, compression (skipping
  `*/download` and `/upload*`) and the `ApiError` error handler at the end, so S2's handlers can just
  `throw` (inside `asyncRoute`).

## What works

All of it with unit/route specs (`vi.spyOn(wpAxios, 'request')` + supertest, fixtures from
`shared/fixtures/`, every answer parsed with the zod schemas):

| Area | Where | What |
|---|---|---|
| Plugin client | `lib/library/pluginClient.ts` | All `wp-upload/v1` routes; wall-clock timeouts for reads/mutations, idle-only `WP_REQUEST_TIMEOUT_MS` for image operations; no redirects followed; a 2xx that isn't JSON is `wp_unexpected_response`; `PATCH`/`DELETE` retried once as `POST` + `X-HTTP-Method-Override` on a 405 |
| Errors | `lib/library/errors.ts` | `toLibraryError()`: every row of §2.3 top-down (401 wins over pass-through and calls `invalidateConnection()`); per-item → request errors for `PATCH items/:id` |
| Revision and cache | `lib/library/cache.ts` | `currentRev` polled at most every 2 s (single-flight), moved forward by every plugin response, followed down only by a `/rev` poll (a restored database); LRU 30 s / 200 entries / 64 MB with single-flight and no cached failures; `W/"<rev>-<hash>"` ETags and 304 *before* any upstream call; `X-Library-Rev` |
| `GET bootstrap` | `routes/library/bootstrap.ts` | Always 200; every `wp.state` and `plugin.state` of §7.1; `/info` cached per rev; one timeout only when WordPress hangs (a failing `/rev` stands in for `/info`, except a 403, where only `/info` identifies the plugin); `upload.maxBytes` capped by `MAX_FILE_SIZE_MB`; the bundled plugin's `plugin.json`/`changelog.json` read once at startup (changelog filtered to versions newer than the installed one); semver incl. pre-releases |
| Guards | `routes/library/bootstrap.ts`, `index.ts` | 409 `plugin_incompatible` (with `details.state`), 409 `feature_unavailable` (with `details.feature`); `/info` re-read at most every 5 minutes; WordPress being down never blocks a route (it reports its own error) |
| Maintenance loop | `routes/library/bootstrap.ts` | §9.2: one loop per process, started by `bootstrap`/`rev` when an index isn't ready and once after the first successful bootstrap; `budgetMs: 5000`, 250 ms pause; stops on `more: false`, 3 errors in a row or 5 `locked` in a row; skipped without the `maintenance` feature |
| `GET rev` | `routes/library/rev.ts` | Shares the 2 s refresh (many polling clients → one plugin call); `no-store`; triggers maintenance |
| `GET collection`, `GET facets` | `collection.ts`, `facets.ts` | Full §6 validation (unknown or repeated params, every value list, `q` trimmed/collapsed, ≤ 200 chars, ≤ 10 terms, `folder=trash` drops the rest); one cache key per normalised query, whatever the parameter order |
| `GET items` | `items.ts`, `normalise/items.ts` | `ids` 1–100 (deduplicated, order kept), `view=tile\|full`; one `include=` call with `_fields` and `wpu`, `context=view`, every status; cached per id *set*; `missing`; the full view resolves attached-to posts once each (one `context=view` read; `targetHints` say whether the user may edit) |
| `PATCH items/:id` | `items.ts` | Strict `ItemPatch` validation (character limits in code points; `post` a positive integer or `null`), one-item `media/batch` with `remaining` re-sends, per-item errors as the request's error |
| Folders | `folders.ts`, `normalise/folders.ts` | `GET` (cached), `POST` (201), `PATCH`, `DELETE`, `POST assign` (1–5000 ids); names trimmed and collapsed; colours validated and lowercased; the tree sorted and colours hidden without Pro |
| Compression | `routes/library/index.ts` | gzip/brotli for answers ≥ 1 kB, except downloads and uploads |

The normaliser is tested both ways: every fixture item is turned back into the `/wp/v2/media` answer
WordPress would give (`specSupport.ts` `wpMediaFor()`), and normalising it must give the fixture's
tile and full DTOs.

### Commands

```sh
npm run check                       # Biome: clean
npm run typecheck -w server         # clean
npm run build && npm run test -w server   # 584 passed, 15 skipped (the live specs skip themselves)

# Live specs, against this worktree's stacks:
dev/run test server-live            # test stack, in the runner (what the gate runs)
dev/run up dev && dev/run seed small
(cd server && npx vitest run --config vitest.live.config.ts)   # host, against the dev stack
```

Live results: see "Gate runs" below.

## What's missing, and why

- **Live checks of the plugin-backed routes.** P1 hasn't landed: the scaffold answers 501 everywhere
  and has no `wpu` field. `routes.live.spec.ts` covers bootstrap, rev, collection (incl. ETag/304),
  facets, folders, items (rows and items agree on dimensions, nothing `missing`) and a `PATCH`
  round trip; each skips itself until `/info` answers and lists its feature. Until then the items
  route was checked end to end once with a temporary stand-in (spike X5), not in the committed specs.
- **`notImplemented.ts` stays:** S2's routers still use it.

## Deviations and interpretations

1. **`sizes` order** (§8.1 "smallest first"): sorted by `/info`'s registered `imageSizes` order, then
   unknown names by pixel count, then `full`. WordPress stores sizes in generation order (medium,
   large, thumbnail, …); the registered order is what the fixtures use, and for a portrait image
   `medium_large` (768×1152) then comes before `large` (682×1024). See CR-S1-3.
2. **`links.view` is always null for now.** REST's `link` is `?attachment_id=N` whether or not the
   site has attachment pages, so the server can't honour "link when attachment pages are enabled"
   without a signal from the plugin (CR-S1-2). It already reads `/info.attachmentPages` if present.
3. **Non-JSON 403 and 404** (a WAF page, a wrong `WP_URL` path) map to 502
   `wp_unexpected_response`, not `forbidden`/`not_found`: rows 5 and 10 talk about WordPress answers,
   and a WAF block isn't "this user may not do that". A 401 maps to `wp_auth_failed` with any body.
   Statuses the table doesn't name (405, 410, 429 with a JSON body) → 502 `wp_error`.
4. **`attachedTo` for an unreadable parent** is `{title: "Private post", status: "private", editUrl:
   null, viewUrl: null}`, mirroring usage refs; a parent that no longer exists gives `null`. Titles
   come from `title.rendered` (entity-decoded, so WordPress's curly quotes stay), like `/wp/v2/search`
   gives S2's `posts`.
5. **A srcset never lists one file twice** (fixture item 1004 does, see CR-S1-3).
6. **PDF `sizes.full.filesize` is null:** REST overwrites a PDF's `full` entry (the preview image)
   with the PDF's MIME type and no size. The server takes the MIME type from the file name; the size
   isn't available (fixture 1088 says 168000).
7. **`bootstrap` ignores query parameters** (it must always answer 200); other routes reject unknown
   ones.
8. **`rev` calls use 10 s everywhere** (also the 2 s refresh behind reads), not only behind `GET rev`.
9. **Express's automatic ETag** is avoided on `no-store` answers (they're written with `res.end()`),
   so §3.3's "ETag: none" holds; `app.ts` is unchanged.
10. **The live config** sets the WordPress credentials itself (`test.env`), so no separate setup file
    was needed.

## Change requests

**CR-S1-1 — `server/vitest.config.ts`: exclude the live specs** (plan §5.2 says the default config
excludes them; today they're collected and skip themselves without `WPU_LIVE`):

```diff
-import { defineConfig } from 'vitest/config'
+import { configDefaults, defineConfig } from 'vitest/config'
@@
     include: ['src/**/*.spec.ts', '../shared/**/*.spec.ts'],
+    exclude: [...configDefaults.exclude, 'src/**/*.live.spec.ts'],
```

**CR-S1-2 — `/info.attachmentPages` (plugin-api.md §3.2, additive):** `attachmentPages: boolean` =
`(bool) get_option('wp_attachment_pages_enabled')`, in `PluginInfo` (`shared/plugin-api.ts`) and the
fixture `pluginInfo` (`false`); server-api.md §8.1 `links.view`: "`link` when `/info.attachmentPages`
is true, else null". P1 would add the key; the server already reads it.

**CR-S1-3 — server-api.md §8.1 and fixtures:**
- `sizes`: "smallest first" → "in the order of `bootstrap.site.imageSizes` (registered sizes),
  then other sizes by pixel count, ending with `full`".
- `srcset`: add "each file once".
- `shared/fixtures/items.ts`: item 1004's `srcset` lists `…-768x1024.jpg` twice (tile and full view);
  drop the second. Item 1088's `full` size: `filesize: null` (see deviation 6), or document that the
  mocks may know more than the server.

**CR-S1-4 — the bundled plugin's location (Dockerfile, `env.ts`):** the server reads `plugin.json`
and `changelog.json` from `$WPU_PLUGIN_BUNDLE_DIR`, default `<repo>/plugin/dist` (read directly from
`process.env` in `bootstrap.ts` because `env.ts` is orchestrator-owned). Suggested: move it into
`env.ts` as `pluginBundleDir`, and copy the build's `plugin.json`, `changelog.json` and zip to
`/app/plugin/dist/` in the final image. `changelog.json` is read as `ChangelogEntry[]` (or
`{entries: [...]}`); P1's build should write that shape.

**CR-S1-5 — server-api.md §2.3 wording** for deviation 3: rows 5–11 apply to WordPress JSON error
bodies; any non-JSON body except on a 401 is row 12. Also name what happens to statuses the table
doesn't list (→ 502 `wp_error`).

**Noticed outside S1 (for S2/the orchestrator):** the scaffold's `images.ts` registers
`POST /regenerate`, and `index.spec.ts` checks it, but server-api.md §7.12 and §10 say
`POST items/regenerate`.

## Spike X5

**Keep `include=` hydration; no plugin `tiles` route.** 100 tiles with `_fields` and a naive,
unprimed stand-in `wpu` field: median 61 ms, p95 75 ms (core fields alone 36 ms; the full view
130 ms). Through the server's `items` route: about 100 ms. Details, and five facts about live
WordPress 7.1 the normaliser now follows, in [spikes/X5.md](spikes/X5.md). The live spec re-measures
on every `server-live` run and fails above 500 ms.

## Open questions

1. **Bundled sidecars:** is `plugin/dist/plugin.json` + `changelog.json` the layout P1's build writes
   (CR-S1-4)?
2. **`sizes` order:** registered order (as built) or strict pixel count (CR-S1-3)?
3. **Attachment pages:** OK to add `attachmentPages` to `/info` (CR-S1-2), or drop `links.view`?
4. **Guard refresh:** the guard re-reads `/info` every 5 minutes, but a route that gets
   `plugin_missing` doesn't reset it; the client re-runs `bootstrap` (which does). Good enough?

## Gate runs (this worktree, Docker available)

| Command | Result |
|---|---|
| `dev/run test lint` | pass |
| `dev/run test typecheck` | pass |
| `dev/run test unit` | pass: 584 passed, 15 skipped (the live specs, which skip themselves) |
| `dev/run test server-live` | pass: 8 passed, 7 skipped (the plugin-backed route checks, until P1's built plugin is in `plugin/dist`; the `test` stack had no companion plugin). X5 there: median 45 ms |
| `npx vitest run --config vitest.live.config.ts` on the host against `dev/run up dev` + `seed small` | pass: 8 passed, 7 skipped (the scaffold plugin answers 501) |

Both stacks were stopped with `dev/run down` (volumes kept). `dev/run test all` can't pass yet:
other suites are still "not available" (track D's summary).

## Commits on `mm/s1`

- `ecc1eab` feat(server): add the library plugin client and error mapping (**S2's starting point**)
- `6596df0` feat(server): add the library read routes, cache and plugin checks
- `952b91a` fix(server): match item normalisation to live WordPress 7.1
- `a612604` test(server): add live specs for the library and the X5 spike note
- this note

Spec helpers live in `server/src/lib/library/specSupport.ts` (test-only; not in the brief's path list,
but part of "their specs").
