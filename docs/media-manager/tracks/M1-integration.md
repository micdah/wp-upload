# M1 integration

Branch `mm/m1-int`, from `mm/m1` @ e991171: `feature/media-manager` plus the M1 track branches, merged
in plan order without conflicts (D `mm/d-m1`, P1, S1, F3, F2, F1, S2). The integrator applied the change
requests (CRs) of every M1 handoff note, fixed what integration broke, and ran the gate (§1–3). Track P2
(`mm/p2` @ 2ae2b4d) was merged afterwards, with its CRs, and the gate re-run: **all eight gate suites
pass** (§4). Three reviews followed; their findings are fixed in §5.

Status words: **applied**; **already met** (the merged code satisfies it, checked); **superseded**;
**deferred** (with where it goes); **owner decision** (the conservative option is applied).

## 1. Change requests

### Orchestrator-owned files

| CR | What | Status |
|---|---|---|
| F3 CR-1, F2 CR-2 | `client/tsconfig.json` includes `vitest.config.ts` and `vite.mock.config.ts` | Applied |
| F3 CR-2 | `@fontsource/orbitron` in `client/package.json` | Applied (dependency). The `import '@fontsource/orbitron/600.css'` in `theme/fonts.ts` and dropping `index.html`'s Google Fonts link are deferred to M2/M5 (F1 §8.11) |
| F3 CR-3 | Client scripts `test:unit`, `test:browser`, `budget` | Applied |
| F3 CR-4 | `npm run test -w client` in the repo `CLAUDE.md` | Deferred to M5 (docs), as the CR says |
| F2 CR-1 | Client scripts `dev:mock`, `build:mock` | Applied |
| D (M1) CR-1 | `e2e` `typecheck` script and `@types/node` | Applied |
| P1 CR-3 | `plugin/tsconfig.json` and a `typecheck` script | Applied. Also `@types/node` as a plugin devDependency (the config names `types: ["node"]`, which only resolved through hoisting, the same reason as D CR-1) |
| P1 CR-2, D (M1) CR-2 | `plugin/vendor/` in `.gitignore` | Applied (also in `.dockerignore`) |
| S1 CR-S1-1 | Default server Vitest config excludes `src/**/*.live.spec.ts` | Applied |
| S1 CR-S1-4 | Bundle dir in `env.ts` | Applied: `env.pluginBundleDir` (`WPU_PLUGIN_BUNDLE_DIR`, default `plugin/dist`); `bootstrap.ts` reads it; `pluginDownload.spec.ts` sets it on `env`; `env.spec.ts` covers it |
| S1 CR-S1-4, S2 CR-S2-4 | Dockerfile builds the plugin and ships zip + sidecars | Applied: a shared `workspace-deps` stage, then `client-builder` and a new `plugin-builder` stage; the final image gets `wp-upload-companion.zip`, `plugin.json` and `changelog.json` in `/app/plugin/dist` with `WPU_PLUGIN_BUNDLE_DIR` set. Verified on the built image through the test proxy: `GET /wp-upload/api/library/plugin/download` → 200, `Content-Disposition: attachment; filename="wp-upload-companion-1.0.0-dev.2.zip"`, `ETag: "1.0.0-dev.2"`, a valid zip; `bootstrap` reports `plugin.bundled.version` `1.0.0-dev.2` |
| S2 CR-S2-1 | `index.spec.ts` registration check | Already applied on `mm/s2`; kept |
| S2 CR-S2-2 | Delete `routes/library/notImplemented.ts` | Applied (no users left). The deletion landed in commit `a159791` with the config CRs |
| P1 CR-5 | Entry file: `@build-strip-start/-end` markers, `error_log` below the minimums | Applied; the build strips by markers |
| P1 CR-7 | `plugin/CHANGELOG.md` lines | Applied under "Unreleased", with a note on the release heading format `build.mjs` parses (`## 1.0.0 (2026-12-01)`) |
| — | Plugin version | Bumped to `1.0.0-dev.2` (header and `WPU_VERSION`), then `1.0.0-dev.3` with P2 (§4) |
| D (M0) CR-1…6, contracts CR-1…6 | M0 requests | Already met (applied in M0; checked: dev script, Vite env, ignores, zod, `allowImportingTsExtensions`, `shared/` in the Dockerfile, compression, server Vitest and typecheck over `shared/`) |

### Cross-track

| CR | What | Status |
|---|---|---|
| F2 CR-3 | F3's `unit` project runs `core/data/**` and `mocks/**` specs | Already met: the project includes `src/**/*.spec.ts`; all 242 F2 specs run in it (client total 545) |
| F2 CR-4 | No-MSW guard never matches `application/msword` | Already met (the guard matched `mockServiceWorker` and `[MSW]`); `setupWorker(` added, with a comment |
| F2 CR-5 | Shared contract suite in `server-live` | Applied: `server/src/routes/library/contract.live.spec.ts` runs the whole app (session, `/api` guard, library router) on an ephemeral port, logs in, and runs `defineLibraryContract({ mutations: true })` |
| F2 CR-6 | `e2e-mock` builds the mock first | Already met by D (it built with F2's config once it existed); simplified to `npm run build:mock -w client` |
| F2 CR-7 | Restated payload budget | Applied in plan §9 and server-api.md §3.4: ≤ 250 kB gzip for the default sort, ≤ 300 kB for any sort at 50k. `dev/perf` measures the default sort, so its 250 kB check is unchanged |
| P2 CR-P2-3 / env mismatch | P1 tests read `WPU_AUTHOR_PASSWORD`, D writes `WPU_AUTHOR_APP_PASSWORD` | Applied: `plugin/tests/contract/support/env.ts` reads D's name. The Author tests now run in the runner (73 → 78 passed per run) |
| D (M1) §9, for P1 | Vitest `include` relative to `plugin/`; `phpstan.neon.dist`; `build.mjs` paths from its own location | Already met by P1 (checked) |
| D (M1) §9, for P1 | Global setup drains maintenance | Applied: `drainMaintenance()` after `ensureMediaIndexReady()`. It stops on `more: false`, or once the media index is ready and a step did nothing (the P1-only usage stub keeps `more` true) |
| P1 CR-4 | `php -l` on PHP 7.4 for the shipped files | Applied: a digest-pinned `php74` one-off service (`php:7.4.33-cli`) lints `plugin/wp-upload-companion/**` and the built file in `plugin-static` |
| P1 CR-1, P2 CR-P2-2 | A variant switch the runner can reach | Applied with P2 (§4) |
| S1 "noticed outside" | `POST /regenerate` vs `items/regenerate` | Superseded: S2 fixed the path |
| Flaky S1 live test | "collection answers valid rows and 304 for its ETag" | Fixed: it waits (bounded) for the maintenance loop, then accepts a 200 only when the ETag really changed, and repeats the pair; a 200 with the same ETag fails at once |

### Contracts and `shared/` (additive only; `/info`'s shape unchanged)

| CR | Status |
|---|---|
| P1 CR-6 | Applied to plugin-api.md: §2.2 (a build lists what it implements), §3.2 (`mimes` tokens), §5.21 (`INSERT IGNORE` lock), §6 (`LAST_INSERT_ID` bump), §10.3 (`delete()` / `assignFolder()` first) |
| S1 CR-S1-2 | **Owner decision.** Conservative option applied: `/info` is unchanged and `links.view` stays null (documented in server-api.md §8.1). Adding `attachmentPages` to `/info` needs the owner's OK and a P1 change |
| S1 CR-S1-3 | Applied: §8.1 `sizes` order (registered sizes, then pixel count, then `full`), `srcset` "each file once", a PDF's `full.filesize` is null; fixtures: item 1004's duplicate `srcset` entry removed (tile and full), item 1088's PDF `full.filesize` null |
| S1 CR-S1-5 | Applied: §2.3 says rows 5–11 are for JSON bodies, non-JSON (except 401) is row 12, and unlisted statuses are 502 `wp_error` |
| S2 CR-S2-3 | Applied: §7.12 (regenerate whole-job failures; `details.applied`), §7.15 (`details.applied`; folder ignored → `result.folder` null), §7.16 (no WordPress credentials for file fetches) |
| F2 open question 1 | Applied as documented behaviour (both S2 and the fake do it): a cancelled upload job reads `not_found` afterwards (§7.15) |
| P2 CR-P2-4 | Applied: `wpu.author.id` may be 0 (`WpuFieldSchema`), and so may the item DTO's `authorId` and full `author.id` (the server copies them); plugin-api.md §7.1, server-api.md §8.1, doc comments in `shared/` |
| X9 note | The third-party directory-listing link is removed (the wordpress.org link stays). It remains in `mm/p1`'s history, which the integrator may not rewrite |

## 2. Integration fixes

- **Shared contract check too strict:** `mocks/contract/checks.ts` required `[0-9a-z]` in the ETag hash;
  server-api.md §3.3 doesn't fix the alphabet and the server uses base64url. Now `[A-Za-z0-9_-]`.
- **Unbounded waits on the maintenance loop:** with P1's stub usage index, `/maintenance/step` keeps
  answering `more: true`, so the server's loop (server-api.md §9.2) never ends and `maintenanceIdle()`
  never resolves. The new live specs bound their waits. S1's own `afterAll` still waits unbounded; P2's
  `UsageIndex::status()` ends the loop, and with P2 merged it does (§4).

## 3. Gate (before P2)

From a clean state: `dev/run down --volumes`, `dev/run up test`, `dev/run seed small`,
`dev/run test all`.

| Suite | Result |
|---|---|
| lint | pass |
| typecheck | pass (server, client, e2e, plugin) |
| unit | pass: server 758 tests (38 files), client 545 (32 files, both projects) |
| plugin-static | pass: build, `php -l` on 7.4 (shipped), 8.1 and 8.4, PHPStan level 8 `[OK] No errors` |
| plugin-contract | pass: `plugin`, `oldest` (= current, no `plugin-v*` tag yet) and `mu-plugin` runs, each 78 passed, 18 skipped (variants and `wp eval`, unreachable from the runner) |
| server-live | **fail**, P2-dependent (below) |
| e2e-mock | pass: 2 |
| e2e-live | pass: 2 |

`server-live` (re-run after the ETag fix): 37 passed, 8 skipped, 4 failed, plus one file-level hook
timeout. All of it needs P2:

- the contract suite's `usage`, `trash` and both `PATCH items/:id` checks get 409 `feature_unavailable`
  (the P1-only plugin lacks `usage`, `trash`, `media-batch`);
- `routes.live.spec.ts`'s `afterAll` waits for the maintenance loop, which never ends against the usage
  stub (§2).

Before the fix, the contract suite's ETag check also failed (integration, fixed in §2).

## 4. P2 merge (`mm/p2` @ 2ae2b4d)

`git merge mm/p2`: no conflicts.

### Its change requests

| CR | Status |
|---|---|
| CR-P2-1 | Applied: the helper block that headed `media`, `trash`, `usage` and `images` specs is `tests/contract/support/p2.ts`, built on P1's `env.ts`, `http.ts` (its retrying `fetchOnce`, now exported) and `variants.ts`. The two `*-internals` specs use the shared `wpEval` (`wpEvalJson`, `wpEvalAvailable`). `toggleVisualPortfolio` uses D's `vp=` variant only (its wp-cli fallback predated D's M1) |
| CR-P2-2 (and P1 CR-1) | Applied: the dev mu-plugin answers `GET\|POST /wp-json/wpu-dev/v1/variant` (local environments only; the app user or an administrator; the same validation and code as `wp wpu-dev variant`). `support/variants.ts` uses it where there is no Docker, so the runner now runs the Trash-on, FileBird-off, per-user, Visual Portfolio-off and role tests. `wp eval` stays host-only: the tests that need it are gated on `wpEvalAvailable` and say why (P1's suggested `eval` route or named lifecycle actions were not built). The collection Trash test restores through `POST /trash/restore` instead of `wp eval` |
| CR-P2-3 | Already applied in §1 |
| CR-P2-4 | Already applied in §1; P1's `field.spec.ts` passes with Visual Portfolio's placeholder (author 0) |
| CR-P2-5 | Applied: every item with an original must have `original.width >= wpu.width`; at least one item is 2560 px on its long side |
| CR-P2-6 | Applied to plugin-api.md: §5.11 the `INSERT IGNORE` option lock with token (the handoff's newer wording, not its `add_option()` diff); §5.12/§5.13 `sizesRegenerated`; §5.13 wp-admin restores give `urlChanged: true`; §5.14 PDF regenerate answers 415 when PDFs can't render, sizes are staged and a failure is 500 with nothing changed; §5.15 X3's replace semantics; §8.2 `modified_gmt` on `wpu_usage_sources` (and §9.3's consistency check now compares it); §8.3 the undo stack's contents |
| CR-P2-7 | Applied: `dev/wordpress/php/uploads.ini` (64 MB `upload_max_filesize`/`post_max_size`), loaded through `PHP_INI_SCAN_DIR` on the `wordpress` service. Verified: `bootstrap.site.upload.maxBytes` is 67 108 864 |
| Changelog lines | Applied under "Unreleased" |
| Version | `1.0.0-dev.3` (header and `WPU_VERSION`); `dev/run test version-bump` passes |

### Integration fixes after the merge

- **PHPStan:** P2 never ran it (P1 owned the composer setup), and the merged `plugin-static` found 27
  level-8 errors in P2's sources. Fixed without behaviour changes: the `method_exists()` guards around
  `provide_feature()`, `add_provider()` and P1's `Rev` went (both tracks are always present now;
  `Mutation\Rev` forwards to P1's `Rev`); null checks for `get_post()` (404 `wpu_not_found`) and
  `array_pop()`; `array_values()` for list types; PHPDoc for two hook callbacks; a `method_exists()` guard
  for `make_subsize()` (the stubs' base class lacks it); the stale `UsageBridge` ignore removed from
  `phpstan.neon.dist`.
- **Plugin typecheck:** the new `plugin/tsconfig.json` (P1 CR-3) failed on the P2 specs (`Buffer` as a
  `BlobPart`, possibly-undefined indexes); fixed in the shared helpers and `images.spec.ts`.

### Gate (P1 + P2)

From a clean state: `dev/run down --volumes`, `dev/run up test`, `dev/run seed small`,
`dev/run test all` → **exit 0**.

| Suite | Result |
|---|---|
| lint | pass |
| typecheck | pass (server, client, e2e, plugin) |
| unit | pass: server 758 (38 files), client 545 (32 files) |
| plugin-static | pass: build (39 classes, all twelve features), `php -l` on 7.4 (shipped), 8.1, 8.4, PHPStan level 8 `[OK] No errors` |
| plugin-contract | pass: `plugin`, `oldest` (= current) and `mu-plugin` runs, each 160 passed, 20 skipped (13 files; the skips are the 12 `*-internals` checks, 6 maintenance lifecycle tests and 1 stale-index test that need `wp eval`, and the role-switch Author fallback, which only runs without a separate Author user) |
| server-live | pass: 49 tests in 4 files (S1's routes incl. the ETag/304 test, S2's mutations, X5, and F2's contract suite against the real server) |
| e2e-mock | pass: 2 |
| e2e-live | pass: 2 |

The first post-merge run failed only `plugin-static` (the PHPStan errors above); every other suite passed.
`dev/run test version-bump` passes. `bootstrap` on the built image reports `plugin.state: ok`, bundled
`1.0.0-dev.3`, both indexes `ready`.

## 5. Review findings (three independent reviews of `mm/m1-int`)

None of the findings was critical. Every finding below is fixed with a regression test, except C-10, which is report-only (§5.2). Each new test was checked to fail without its fix, except where noted. The plugin version is now `1.0.0-dev.4`.

### 5.1 Findings → fix → test

Paths: plugin `plugin/wp-upload-companion/src/`, tests `plugin/tests/contract/`; server `server/src/`;
client `client/src/media-manager/`.

| # | Fix | Test |
|---|---|---|
| P-1 | `Images/EditStateProvider.php`: a size counts as pending only if `image_resize_dimensions()` allows it from the attached file's own width and height | `images.spec.ts` › "reports no pending sizes after editing a -scaled item below a size its original allows" |
| P-2 | `Index/MediaIndex.php`: new `modified_gmt` column (schema and row version 2). `check_consistency` and building-mode `next_ids` compare it per row. Outdated rows are rebuilt once, in `building` state | `maintenance.spec.ts` › "stays ready with a future-dated attachment, and never re-picks its row"; "rebuilds rows of an older format after a schema upgrade" |
| P-3 | `MediaIndex::step` runs sub-batches of 20. The first always runs; the deadline is checked before each and the cursor saved after each. `pdf_pages` reads a PDF whole only up to 2 MB, otherwise just its first and last MB | `maintenance.spec.ts` › "makes progress in every step, saving its cursor per sub-batch"; "counts PDF pages, reading only both ends of a large PDF" |
| P-4 | `Rest/TrashController.php`: the summary applies `Query\Visibility::trash()`; plugin-api.md §5.7 now says so | `trash.spec.ts` › "GET /trash counts only the items the Author sees in the Trash (§5.7, P-4)" |
| P-5 | Restore uses `Adapter::folders_of($ids, Adapter::owner())`, and gives null without FileBird. `Mutation/Folders.php` is deleted | Existing `trash.spec.ts` › "restores a filed item into its FileBird folder" |
| P-6 | `Rev.php`: `ensure_exists()` uses `INSERT IGNORE` and clears the caches. `current()` recreates the option once, then falls back to the clock | `rev.spec.ts` › "is recreated once, even when a stale options cache claims it exists (P-6)" (host only, `wp eval`) |
| P-7 | `Rest/FoldersController.php`: only items that move go to FileBird. The rev is committed if anything moved or the rev is dirty | `folders.spec.ts` › "counts only changed items as moved, and does not bump for no change" |
| P-8 | `wpu_maintenance_lock` and `wpu_media_index_schema_lock` use `Mutation\OptionLock` | `maintenance.spec.ts` › "leaves a maintenance lock it doesn't hold in place" |
| P-9 | `Plugin.php`: in plugin mode the deactivation hook is registered on every request | New `lifecycle.spec.ts` › "marks the index stale when the plugin is deactivated over REST (P-9)" |
| P-10 | `Mutation\Api::positive_int` accepts JSON integers only. The media and usage id lists go through `Support\Params::ids`, and crop values must be integers | `trash.spec.ts` › "reads ids as JSON integers only, and answers once per distinct id (§1.2, P-10)"; `usage.spec.ts` › "reads ids like every other route…" |
| Extra | `Images/Engine.php` `touch_modified()` marks the index row. Regenerate and restore change only `post_modified`, so P-2's per-row check would otherwise flag the index stale | `maintenance.spec.ts` › "keeps up with image operations that change only post_modified" |
| S-1 | `lib/library/normalise/items.ts`: the parent post is read below `WP_URL` at its post type's `restNamespace`/`restBase`. If the type is unknown it falls back to the route inside the href, and otherwise to `/wp/v2/posts/<id>`. The href's origin and path prefix are never used. `wpGetHref` is removed | `normalise/items.spec.ts` › "reads the parent below a WP_URL in a subdirectory, without doubling it"; "reads the parent when WordPress links to another origin than WP_URL"; `parentRoute` cases |
| S-2 | `lib/library/cache.ts` `expireRevPoll()`, called after core-REST writes (library and legacy uploads) | `upload.spec.ts` › "makes the next cached read see the new item at once (polls /rev again)"; `cache.spec.ts`; `wpUpload.spec.ts` |
| S-3 | A `/rev` poll that raced a write (a response rev or an expiry) can only raise `currentRev`. Without such a race it still follows a restored database down | `cache.spec.ts` › "never lets a poll that raced a mutation move the rev back"; "follows a poll down when no write raced it (a restored database)" |
| S-4 | `lib/library/jobs.ts` `receiveFile`: any parser error that isn't a `MulterError` becomes 400 `upload_error` | `jobs.spec.ts` › `receiveFile` (2 cases); `images.spec.ts` › "answers 400 upload_error to a malformed multipart body" |
| S-5 | `routes/library/download.ts`: a failed fetch destroys the body stream. Headers are collected first; if Node refuses one, the stream is destroyed and the answer is 502 `wp_unexpected_response` | `download.spec.ts` › "closes the body stream of a failed file fetch"; "closes the file stream and answers 502 when a header can't be sent" |
| S-6 | `routes/library/bootstrap.ts`: the maintenance loop stops after 5 idle steps in a row (`did` all zero, `more` true). Neither `bootstrap` nor `rev` restarts it for 10 minutes | `bootstrap.spec.ts` › "stops after five steps in a row that did nothing but say more, and stays stopped"; "keeps stepping while steps make progress, however long" |
| S-7 | A cache entry holds only a UTF-8 `Buffer` of the JSON plus `rev`, and counts body + key + 256 B. `cached()` returns `{ body, rev, value() }` | `cache.spec.ts` › "keeps only the UTF-8 JSON, and counts it against the budget" |
| S-8 | One `characters()` in `lib/library/errors.ts`, replacing four copies; `q` is counted in code points | `collection.spec.ts` › "counts q in characters, not UTF-16 units (astral characters)"; `errors.spec.ts` › `characters` |
| S-9 | New tests only | `app.spec.ts` › "rejects library requests without a session with a JSON 401 and no challenge"; "rejects a cross-site library mutation with 403, even with a session" |
| C-1 | `core/data/session.ts` gets an epoch per session. `http.ts` retries a 401 from an older epoch without marking the session lost or telling the app. To do that it calls `fetch` and `notifyUnauthorized` itself instead of `apiFetch` | `http.spec.ts` › "retries a 401 sent before a re-login without marking the new session lost (C-1)" |
| C-2 | `app/auth/useAuthSession.ts`: the gate is restored when auth becomes `authenticated` and on every login, and abandoned on logout. It loads the gate with a dynamic `import()` to stay within the bundle budget | `app/auth/useAuthSession.browser.spec.ts` (3 tests) |
| C-3 | `core/data/invalidate.ts`: after an own mutation, every rev-dependent query is also marked stale (`refetchType: 'none'`). The contract has no `revBefore` (revs are opaque), so this is the simplest option that is always correct | `invalidate.spec.ts` › "a change elsewhere hidden behind our own mutation's rev is fetched on next use (C-3)" |
| C-4 | `core/data/optimistic.ts`: a rollback invalidates what it touched | `optimistic.spec.ts` › "after a rollback, refetches what it touched so the server wins over a stale snapshot (C-4)" |
| C-5 | `core/ui/toast.tsx`: calls `notifications.update()` and then `show()`, so a reused id replaces the toast | `core/ui/toast.browser.spec.tsx` (Mantine's real `Notifications`, 3 tests) |
| C-6 | `core/uploads/transport.ts`: a signal that is already aborted rejects with `AbortError`. The abort listener is removed on load, error and abort | `core/uploads/transport.browser.spec.ts` (4 tests) |
| C-7 | `app/runtime.ts` `settledCollection()`: select-all and detail stepping are unavailable ("Still loading") while the rows are a placeholder or not yet loaded | `app/runtime.browser.spec.tsx` › "select all and ←/→ wait while the previous folder's rows are shown (C-7)" |
| C-8 | `core/collection/hooks.ts`: calls `notifyCommandsChanged()` when the collection changes | `app/runtime.browser.spec.tsx` › "enables ←/→ in detail once a deep link's collection has loaded (C-8)" |
| C-9 | `core/url/history.ts`: the marker carries a per-page-load id. Only a matching marker leads to `history.back()`; anything else replaces the entry | `history.spec.ts` › "after a reload, leaving a detail entry pushed before it replaces instead of going back" |
| C-11 | `core/state/selection.ts`: range anchor `state.anchor ?? state.focus ?? id` | `selection.spec.ts` › "range without an anchor starts at the focused item" |
| C-12 | `core/ui/confirm.tsx`: a queued request inherits the first opener of its chain | `confirm.spec.ts` › "returns focus to the first opener of a queued chain" |
| C-13 | `core/data/api.ts`: bootstrap reports connectivity from `wp.state`, through a new `reportProbe()` | `http.spec.ts` › "counts bootstrap as a probe by its wp.state, not its 200 (C-13)" |
| C-14 | `invalidate.ts` `revSequence()`/`applyPolledRev()`: a poll answer overtaken by a newer rev is ignored | `invalidate.spec.ts` › "ignores a poll answer overtaken by a newer rev (C-14)" |
| C-15 | `app/boot/Boot.tsx`: the bootstrap goes into the store in a layout effect, and Boot renders nothing until then | `app/boot/Boot.browser.spec.tsx` › "puts the bootstrap into the core store before the shell first renders (C-15)" |
| C-16 | `shell/CommandButton.tsx`: `aria-disabled` + `data-disabled` instead of `disabled`. The button stays focusable, shows its reason tooltip on focus and never runs. `shell/Toolbar.tsx`: fixed "Folders"/"Inspector" labels with `aria-pressed` | `shell/CommandButton.browser.spec.tsx` (2 tests) |
| C-17 | `app/runtime.ts`: `undo.last` is available only while `canUndo()`. An unavailable Ctrl+Z isn't swallowed, so native undo in text fields still works | `app/runtime.browser.spec.tsx` › "is available only while an undoable toast is on screen" |
| C-18 | New `shell/useFolderDrawerLayer.ts`: Esc closes the compact drawer and returns focus to its opener | `shell/useFolderDrawerLayer.browser.spec.tsx` |
| C-19 | `app.spec.ts` › `root-relative URL guards`, with its scope stated in a comment. In index.html it flags any attribute value or srcset entry that starts with a single `/`. In scripts it flags any string or template literal that starts with `/` plus a path character | "finds none in the built index.html"; "finds none in the built scripts"; "flags root-relative attributes in a planted index.html"; "flags root-relative app URLs in a planted script" |

The tests for C-9, C-11, C-12 and C-18 were not checked against the old code. Those fixes are small, and the tests assert the new behaviour.

**Contract changes (all additive or clarifying):**
- **plugin-api.md:**
  - §1.2: numbers in request bodies are JSON integers, and id lists drop duplicates (the first one is kept), so a batch answers once per distinct id. An id-list error's `param` is now `ids`, not `ids[N]`.
  - §5.7: Trash summary visibility.
  - §5.21: sub-batches and `modified_gmt`.
  - §7.1: `pages` (null for a large PDF whose ends don't hold the count) and `sizesPending`.
  - §8.1: the `modified_gmt` column.
  - §9.2: the schema lock.
  - §9.3: the per-row consistency check.
- **server-api.md:**
  - §3.1: a core-REST write expires the rev poll, and a poll that raced a write can only raise the rev.
  - §7.16: a header the server can't pass on gives 502 `wp_unexpected_response`.
  - §9.2: the idle stop and the 10-minute cool-down.

**Behaviour changes to note:**
- `1.0` and `"1"` are now rejected everywhere a number is expected: ids, `set.post`, `scale`, crop values and `budgetMs`.
- The panel toggles' accessible names are now "Folders" and "Inspector". The prototype and `design/specs/folders.md` §2 still say "Hide folders".

### 5.2 C-10: the bundle budget (owner decision)

Plan §9 sets a budget of ≤ 150 kB gzip for the initial media-manager chunk. Measured with `node client/scripts/bundle-budget.mjs --json` on the host:

| Scenario | Initial chunk (kB gzip) | Change |
|---|---|---|
| After the review fixes | **149.99** (JS 111.29, CSS 38.70) | 0.01 kB headroom; the runner measured 150.24, over budget |
| Now, with the boot screens lazy (§5.4) | **148.59** | about 1.4 kB headroom; (a) and (b) below were measured before this and are about 1.4 kB lower now |
| (a) Plus M2's imports: `LibraryQueryProvider`, `useBootstrap`, `useRevPolling`, `MediaManagerThemeProvider`, `@fontsource/orbitron/600.css` | **157.65** | +7.66 over budget |
| — of which F2's `core/data` alone | 153.95 | +3.96 |
| — of which the theme plus Orbitron | — | +3.70 (JS +2.64, CSS +1.04; the 13 font files, 162 kB, aren't counted) |
| (b) On top of (a): per-component Mantine CSS instead of `@mantine/core/styles.css` (28 files measured) | **132.65** | **−25.00**, measured |
| (b) On top of (a): lazy Tabler icons | 156.53 | −1.12, upper-bound estimate (icons stubbed) |
| (b) Lazy inspector and detail | — | ≈ 0 today, estimate (both are still stubs; the saving will be whatever later tracks add) |

Only per-component Mantine CSS brings M2 back under budget. Until the owner decides, any byte added to the initial chunk fails `test/bundle-budget.spec.ts`. The review fixes had to fit as well: C-2 loads the session gate lazily, and the C-5 and C-16 code was trimmed.

### 5.3 How the fixes were made

Six helper agents ran, two per area, because the integrator started the batch twice. Each pair split its findings so that no file had two owners, and nothing was applied twice (checked in the diffs). The integrator reviewed the combined tree, ran the host checks and committed per area:
- plugin: `bbf8d30` (with the version bump and changelog);
- server: `1fb591e`;
- client: `0c68907`.

Integration fixes from the gate (§5.4): `88d017a` and `e185992`.

### 5.4 Gate (after the review fixes)

Two integration problems showed up in the first gate run after the fixes. Both are fixed:

- **An import cycle (server).** S-2 made `lib/wpUpload.ts` import `cache.ts`, which already depends on `wpUpload.ts` through `pluginClient.ts` and `errors.ts`. When `pluginClient.ts` loaded first (the live specs), `cache.ts` ran `setRevObserver()` before `pluginClient.ts` had initialised it, so `server-live` failed to load `routes.live.spec.ts`.
  - **Fix:** `wpUpload.ts` exposes `onCoreWrite()`, and `cache.ts` registers `expireRevPoll` with it (`88d017a`).
  - **Test:** a new `lib/library/moduleOrder.spec.ts` loads each library module as the entry of a fresh Node process. It fails on the old code.
- **The bundle budget in the runner (client).** The runner measured 150.24 kB against the host's 149.99 kB (Node 24 vs 26 gzip).
  - **Fix:** the WordPress-unreachable, app-password and plugin-blocked screens moved to `app/screens/bootScreens.tsx`, which `Boot` loads lazily (`e185992`). The initial chunk is now **148.59 kB** on the host, with about 1.4 kB of headroom.
  - **Test:** `Boot.browser.spec.tsx` › "loads the … screen lazily" (3 cases).

From a clean state: `dev/run down --volumes`, `dev/run up test`, `dev/run seed small`, `dev/run test all` → **exit 0**.

| Suite | Result |
|---|---|
| lint | pass |
| typecheck | pass (server, client, e2e, plugin) |
| unit | pass: server 795 tests (39 files), client 574 tests (39 files, both projects, including the bundle budget) |
| plugin-static | pass: build, `php -l` on 7.4 (shipped files), 8.1 and 8.4, PHPStan level 8 `[OK] No errors` |
| plugin-contract | pass: `plugin`, `oldest` (the current build) and `mu-plugin` runs, each 164 passed, 28 skipped. The skips are the tests that need `wp eval` (host only): the internals specs, the lifecycle and P-6 tests, and parts of maintenance |
| server-live | pass: 49 tests in 4 files |
| e2e-mock | pass: 2 |
| e2e-live | pass: 2 |

The helpers also ran the full contract suite from the host against a dev stack, where the `wp eval` tests run too: 191 passed, 1 skipped (the role-switch fallback), 0 failed.

## 6. M2 glue (F1 §8 and the `TEMPORARY (M1)` seams)

Left for the M2 agent, as the brief says:

1. F1's three `TEMPORARY (M1)` seams switch to F2's data layer: `core/collection/source.ts`,
   `app/boot/useBootstrap.ts`, the `QueryClient` in `app/providers.tsx`.
2. Swap in F3's `MediaManagerThemeProvider` and its colour-scheme key (`wpu-mm-color-scheme`).
3. Connectivity: core's `connectivity` mirrors F2's `connectivityStore` (or `can()` reads it);
   `can()` must also deny mutations under `wp-auth-failed`.
4. Session: `AuthGate` calls `sessionGate.restore()` after re-login, `sessionGate.abandon()` and
   `clearLibraryData()` on logout.
5. One collection decode: `useCollection()` builds on F2's `CollectionSnapshot`; drop `decodeRows` if
   the view can read the snapshot at 50k.
6. One `useItem`: core's delegates to F2's; features import from `core/collection`.
7. Query keys come from F2's `normaliseCollectionQuery()`; the URL may keep Trash-ignored filters.
8. Upload errors: `core/uploads` throws `LibraryError`.
9. Mount `useRevPolling()` once in the shell.
10. Layout tokens: the shell's `--mm-*` names become F3's `--toolbar-h`, `--rail-w`, `--folders-w`,
    `--inspector-panel-w`.
11. Browser-mode specs for `readFocusContext` and the shell with F3's harness; the C4 harness can go.
12. Orbitron: import `@fontsource/orbitron/600.css` in `theme/fonts.ts`; the Google Fonts link goes in M5.

## 7. Open for the owner

- **Needs owner decision:** `/info.attachmentPages` (S1 CR-S1-2). Applied: none; `links.view` null.
- **Needs owner decision:** the bundle budget (C-10, §5.2).
- `wp eval` from the runner (P1 CR-1's second half): 20 contract tests per run still need Docker on the
  host. A test-only eval route or named lifecycle actions in the dev mu-plugin would close that.
- P2's `Mutation\Rev` is now a thin forwarder to P1's `Rev`; folding it away is a cleanup for whoever
  owns the plugin next.
- The open questions in each handoff note stay open (not integration decisions).
