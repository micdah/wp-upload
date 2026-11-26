# Media manager — implementation plan (phase 3)

This is the implementation plan for v1 of the media manager on `feature/media-manager`. It builds on the
[handoff](HANDOFF.md), the [research synthesis](research/00-synthesis.md) and the [design](design/README.md).
Its focus is contracts-first sequencing, and parallel sub-agent tracks with exclusive file ownership.

## 0. Decisions taken during planning and at Checkpoint 4 (2026-11-22)

D19–D30 were recorded at Checkpoint 4 (M0). These add to D1–D11 in the [synthesis](research/00-synthesis.md#decisions-recorded-2026-11-22):

| # | Decision |
|---|---|
| D1c | **Remove the old upload page.** This overrides D1b's "the upload page keeps working without the plugin". The media manager plus the companion plugin becomes the only UI. The old page keeps working on the branch until the media manager's own upload and onboarding screen land (M4), and is deleted in M5 |
| D12 | **Plugin packaging:** a regular WordPress plugin, installable from wp-admin, built as a single PHP file that also works when dropped into `mu-plugins`. The app's Docker image bundles the matching zip, and the onboarding screen offers it for download. CI builds it as an artifact. Plugin versioning and the update policy are in §2.6 |
| D13 | **Feature-branch CI:** a separate workflow, `.github/workflows/media-manager.yml` (§6). `ci.yml` stays untouched, and the branch never publishes images |
| D14 | **Integration model:** track agents may **commit locally on their own track branch** and never push. The owner reviews each branch diff, and the orchestrator then merges it into `feature/media-manager`. Pushing still needs the owner's explicit approval |
| D15 | **No FileBird Pro licence.** It can't be used in CI and may not be usable in several places. Pro features (folder colours and folder sort, D3) are built detection-gated and tested in mock mode only. Pro detection and colour storage are implemented from Lite's source and public signals, and stay unverified against a live Pro site |
| D16 | **Changing folder replaces the history entry**; it never pushes. Only entering detail mode pushes (interaction-spec §1) |
| D17 | **Never modify FileBird.** No schema changes (not even an extra index), no direct writes to its tables, no changes to its options. Folder mutations go only through FileBird's own PHP functions, so its hooks fire. Reads may query its tables read-only. Anything faster lives in the plugin's own tables |
| D18 | **No hosted environments; local Docker equals CI.** Two modes of one local Docker Compose project, driven by one script (`dev/run`): `dev` for hot reload, and `test`, where **all** automated tests run, including the production image under a sub-path. No test relies on a real WordPress site. CI calls the same commands, so local runs and CI are interchangeable (§5) |
| D19 | **In-place image edits overwrite the file and keep the same URL** (D7). The plugin keeps a backup for Undo and Restore original; posts show the edit at once, and the app cache-busts its own renditions with `?v=<modifiedAt>`. `urlChanged` stays in the contract only as an escape hatch (spike X2) |
| D20 | **Replacing a `-scaled` image that can't keep its URL: warn, then proceed.** The confirm shows that the URL changes and where the item is used; `urlChanged` reports it afterwards (spike X3) |
| D21 | **The Attach picker finds published posts only in v1** (core `/wp/v2/search`). A plugin `/posts` route that includes drafts can come later as an optional feature |
| D22 | **Usage index scope: core plus Visual Portfolio.** Core: featured image, image/gallery/file/cover/media-text/video/audio blocks, classic `wp-image-N`, `[gallery]`, site logo and icon. Visual Portfolio (pinned 3.11.0 in the dev stack): the `visual-portfolio/block` `images` attribute, the loop-gallery blocks' `imagesQuery.images`, and saved layouts (`vp_lists` posts, `vp_images` meta) reached through the `visual-portfolio/saved` block or the `[visual_portfolio id=N]` shortcode. It is an optional plugin feature, active only when Visual Portfolio is installed; spike X10 (P2) confirms the storage live. Page builders, ACF and WooCommerce are not detected, and the UI says the index may be incomplete |
| D23 | **Folder colours are Pro-only in both directions:** hidden on FileBird Lite even when colours are stored; written only through FileBird's own colour function when Pro is detected |
| D24 | **Bulk operations are client-chunked** (100 ids per request for batch, delete and restore; 5000 for folder assign; 1000 for regenerate) with progress in the UI. No server-side jobs for them; a reload stops the rest, and Undo covers what was done |
| D25 | **FileBird per-user mode:** the folder column shows the current user's own folders, read-only, with a notice; every folder mutation is refused (D10) |
| D26 | **Dev/test users:** the stack creates both an Editor and an Author app user (each with an app password) so tests can check per-item permissions on another user's media in one run. The `role=` variant remains for the `app` container's user |
| D27 | **Plugin minimums:** WordPress 7.0 and PHP 8.1. Below them the plugin registers no routes and the app shows the setup screen with an explanation |
| D28 | **Biome excludes `docs/media-manager/design/**`**: the prototype is reference material, not shipped code |
| D29 | **The contracts agent's 45 detailed decisions** (`tracks/contracts-handoff.md`, "Decisions taken") **are accepted as written.** Changes later go through the normal contract change-request process |
| D30 | **Dev stack defaults accepted:** bind to 127.0.0.1 with `admin`/`admin` (`WPU_BIND_ADDRESS` can open it up), WordPress pinned to the exact 7.1.5 image, ports from 20000–27999 in 20-port blocks per worktree, PHPStan's composer from a digest-pinned `composer:2` image, and the built plugin at `plugin/dist/wp-upload-companion/wp-upload-companion.php` plus its zip |
| D31 | **Bundle budget stays at 150 kB gzip** for the initial media-manager chunk (§9). M2 switches from Mantine's global stylesheet to per-component Mantine CSS (measured −25 kB), which makes room for the data layer, theme and fonts (M1 review) |
| D32 | **No "view attachment page" link in v1:** `links.view` stays null, because core reports an attachment-page link even when the site has attachment pages off. An `attachmentPages` flag in `/info` can come later as an optional plugin feature (M1 review) |
| D33 | **Bulk actions act on every selected item, including ones hidden by the current filters,** and the selection bar and confirms say so ("12 selected · 3 hidden by filters") |
| D34 | **Detail stepping stops at both ends** (no wrap-around), with a nudge and the announcement "Last item in this view" |
| D35 | **Undo reaches only the newest undoable toast while it is visible** (about 8 s), as specified; otherwise "Nothing to undo" |
| D36 | **One centre overlay at a time** (peek, detail editor, …) in v1 |
| D37 | **Animated GIFs: warn, then allow editing.** The editor says editing removes the animation and asks to confirm; Undo and Restore bring it back. *M2/M4 task (B1, A4)* |
| D38 | **Replace keeps old sub-size files whose dimensions no longer exist,** so posts that embedded them keep an image; they are deleted with the item, and the Replace confirm mentions it. *M2 task (P2 code), contract §5.15 wording* |
| D39 | **Visual Portfolio galleries switched away from "images" still count their stored images as used** (safer for delete warnings) |
| D40 | **A `[gallery]` shortcode without ids counts the post's attached images as used** (`shortcode-gallery`). *M2 task (P2 parser)* |
| D41 | **An Author's folder counts follow the collection's visibility rule,** so a count matches what the Author sees in that folder. *M2 task (P1 code), contract §5.16 wording* |
| D42 | **FileBird Pro detection (spike X9) ships in v1;** the `wpu_filebird_pro` filter can force it either way |
| D43 | **Downloads are fetched without WordPress credentials** in v1; sites that protect their uploads get a clear download error |
| D44 | **Visual Portfolio's "no image" placeholder attachment is reported as used by Visual Portfolio.** *M2 task (P2 parser)* |
| D45 | **No chunked collection loading in v1.** One payload (224 kB gzip at 50k, ~14 ms client cost); revisit if a site nears 55k items |
| D46 | **The `[perf]` CI job is report-only;** the 300 ms budget is enforced on local runs, with this machine as the reference. *M2 task (D)* |
| D47 | **The owner's 50k feel review uses real photos** (`?mock-images=picsum`) |
| D48 | **Technical items accepted:** (1) image-job read-back failures fail the job with `details.applied: true`, and the client refetches instead of retrying; (2) the plugin-state guard re-reads `/info` every 5 min and whenever the client re-runs bootstrap; (3) a large regenerate releases its concurrency slot between items (*M2 task, S2*); (4) `dev/run` derives the oldest supported plugin tag from the server's required API level (*M2 task, D*); (5) the usage index always parses content rather than trusting Visual Portfolio's own layout index; (6) the dev CA goes into Firefox/WebKit in the runner only when a test needs those browsers. Also settled during integration: registered size order for `sizes`, the plugin bundle layout, a cancelled upload job reads `not_found`, the restated payload budget, `features[]` lists everything a build implements, and the colour scheme follows the OS by default with a manual override (as the brief says) |

The plan ends with a `final-reviewer` step that addresses the findings worth acting on (M5).

**Spec amendments from D1c, D12 and D15.** Where the design docs disagree with these, this plan wins. The
orchestrator strikes the lines in the docs during M0:

- `design/interaction-spec.md` §7 ("the basic uploader as a fallback"), `design/specs/system.md` (the
  no-plugin state's link to the basic uploader, and "The onboarding screen points to the basic uploader")
  and `design/brief.md`: there is **no** fallback to the old
  page. Onboarding offers only the plugin install.
- `design/specs/system.md` onboarding steps: download the **plugin zip** and install it in wp-admin
  (Plugins → Add New → Upload). A note says the same single file can be placed in `mu-plugins` instead.
- `research/00-synthesis.md` ("The upload page stays mobile-friendly"; D1's "mu-plugin"): superseded by
  D1c and D12. The media manager's phone layout carries phone uploads.
- `design/specs/folders.md` §9–10 and `design/interaction-spec.md` §11–12 (FileBird Pro): Pro features
  are built against detection and mock data only, with no licence (D15). Colours are written only through
  FileBird's own colour function (D17). If X9 can't make detection reliable, the Pro features are hidden
  in v1.
- **Gaps the design docs leave open** are filled from the design system's components, not from new
  design work: the login screen, the session-expired dialog, the "WordPress unreachable" state, the logout
  control, and the plugin-compatibility screens (§2.6).

## 1. Goal, inputs, decisions

Build v1 of the media manager on `feature/media-manager`, as scoped in the synthesis and the design
documents:

- [`interaction-spec.md`](design/interaction-spec.md);
- [`specs/`](design/specs/);
- [`design-system.md`](design/design-system.md) §8;
- the prototype as the behavioural reference. It is **not** code to port, except a few pure algorithms
  listed below.

The binding decisions are D1–D11 plus D1c and D12–D48 (§0). The app becomes **one UI**: the
media manager. It needs the companion plugin, and without it the user sees the onboarding screen.

**Architecture in one paragraph:**

- The **companion plugin** (`wp-upload/v1`) does all SQL. That covers the ordered collection query,
  facets, the media and usage index tables, folders over FileBird's PHP model, batch metadata, trash, and
  in-place image operations.
- The **Express server** is a thin, stateless proxy under a new `/api/library/*` namespace. It handles:
  - auth and session;
  - normalising responses to app DTOs;
  - a short-TTL cache keyed by the library revision;
  - chunking;
  - long operations as in-memory jobs, sharing the upload concurrency budget;
  - error mapping;
  - bundling the plugin zip.
- The **client** is a lazily loaded React 19 + Mantine 9 chunk.
  - State that matters lives in **query parameters**; nothing uses path routing.
  - TanStack Query holds server state. Zustand holds UI state.
  - The client holds the **whole ordered collection** as compact `[id, w, h, kind]` rows and hydrates
    visible items in id chunks of 100 or fewer.

## 2. Contracts first (M0)

The orchestrator writes these before any track starts, and the owner approves them at **Checkpoint 4**.
After that, only the orchestrator changes them. Tracks raise change requests in their handoff notes.

1. **`docs/media-manager/contracts/plugin-api.md`**: the `wp-upload/v1` routes.
   - The baseline permission is `upload_files`. Per-item checks use `edit_post`/`delete_post`.
   - Batch routes return per-item `{id, ok, error?}` and never fail the whole request with 403.
   - Error codes are `wpu_*`.

   | Route | Purpose |
   |---|---|
   | `GET /info` | Its shape is stable across versions: `version`, `api` (`1.N`), `features[]`, `user.caps`, `filebird {active, version, pro, perUser} \| null`, `trash {enabled, days}`, `upload {maxBytes, mimes}`, `imageSizes`, `index` status, `rev` |
   | `GET /collection` | Params `folder`/`q`/`type`/`alt`/`size`/`orient`/`month`/`sort` (the URL params of interaction-spec §1). Returns `{total, rev, rows}`, rows with stride 4 (id, w, h, kind), with **ID as the tiebreaker**. This is the single source of order |
   | `GET /facets` | Same params. Type counts, missing alt, total bytes, months with counts, unused, editable |
   | `POST /media/batch` | `{items:[{id, set, appendDescription?}]}`, 100 or fewer. Returns per item `{ok, previous, item}`, so Undo is safe |
   | `POST /media/trash`, `POST /media/delete` | Per-item results |
   | `GET /trash`, `POST /trash/restore`, `POST /trash/empty` | `trashedAt` and `daysLeft`. Empty is time-budgeted |
   | `GET\|POST /usage` | One **unified `UsageRef`**, resolving the inspector.md vs system.md mismatch: `{postId, postType, postTypeLabel, title, status, editUrl, viewUrl, contexts[]}`. The contexts are featured, image-block, gallery-block, file-block, cover-block, media-text, content, shortcode-gallery, site-logo and site-icon. The response also carries index completeness |
   | `POST /media/{id}/edit` | `{ops[rotate\|flipH\|flipV\|crop], scale?, applyTo: all\|thumbnail\|nothumb, expectedModified}`. Returns 409 `wpu_stale` when `expectedModified` doesn't match |
   | `/edit/undo`, `/restore`, `/regenerate` | Image maintenance |
   | `/replace` | Multipart, same MIME, otherwise 415 |
   | `GET /folders` | Tree with `ord` and colour, plus counts `{direct, all, uncategorized}`, `pro` and `rev` |
   | `POST /folders`, `PATCH /folders/{id}`, `DELETE /folders/{id}` | Create and rename return the **final** name. `PATCH {name?, parent?, position?, color?}` has a cycle check (409), and colour is Pro only. DELETE returns `{deletedIds, movedFiles}` |
   | `POST /folders/assign` | Returns `{previous:[{id, folder}], skipped, counts}` |
   | `POST /maintenance/step` | `{budgetMs}`, a time-budgeted index backfill, driven by the server instead of WP-Cron |

   Also part of the contract:
   - a `wpu` REST field on `/wp/v2/media`: `{folder, perms{edit, delete}, edited, restorable, sizesPending, usageCount}`;
   - folder routes return 409 `wpu_filebird_inactive` without FileBird. In per-user mode (D10) only the
     folder **mutation** routes (`POST`, `PATCH`, `DELETE`, `assign`) return 409 `wpu_filebird_per_user`.
     `GET /folders` and `folder=` filtering keep working (specs/folders.md §9: browsing works, the column is
     read-only), and `/info` reports `perUser: true`;
   - attach and detach use `set.post` in `media/batch` (and `post` in the server's `PATCH items/:id`);
   - the plugin never answers with HTTP 401 (it uses 403 for missing capabilities);
   - an option **`wpu_rev`** that every attachment, meta, FileBird and trash hook bumps. It replaces ETags
     and ID sweeps.
2. **`docs/media-manager/contracts/server-api.md`**: the `/api/library/*` routes:
   - `bootstrap`: always 200, even when WordPress is down. It reports:
     - `wp.state`: `ok | unreachable | auth_failed` (the app password is rejected);
     - `plugin.state`: `ok | missing | forbidden | outdated | too-new | update-available` (§2.6).
       `forbidden` means `/info` returned 403: the WordPress user lacks `upload_files` and the app explains
       that it needs an Editor (D9);
   - `rev`, `collection`, `facets`;
   - `items?ids=&view=tile|full`, `PATCH items/:id`, `items/batch`, `items/delete {ids, mode}`;
   - `usage`, `folders` (CRUD plus assign);
   - `items/:id/{edit, edit/undo, restore, replace}` and `regenerate {ids}`, all returning 202 + `jobId`;
   - `jobs?ids=`, the `trash/*` routes, `posts?search=` (core `/wp/v2/search`);
   - `upload` (multipart, returns 202 + `jobId`), `upload/jobs?ids=` (status, including processing) and
     `upload/check?filename=` (duplicate check). They reuse the server's `uploadJobs` internals and put the
     file in its folder via the plugin, or via `?fbv=` if spike X6 succeeds. The client transport for these
     lives in `core/uploads` (F1). The old `lib/uploadClient.ts` is not used by the media manager and goes
     in M5;
   - `items/:id/download` (proxied with `Content-Disposition`, because `<a download>` is ignored
     cross-origin);
   - `plugin/download`.

   The **error mapping** (`toLibraryError()`, which wraps `normaliseWpError` in `server/src/lib/wpUpload.ts`):

   | From WordPress | To the browser |
   |---|---|
   | 401 | 502 `wp_auth_failed`. A 401 under `/api` keeps meaning "session lost" |
   | 403 | 403 `forbidden` |
   | `wpu_*`, 409, 413, 415 | Passed through |
   | 5xx | 502 |
   | Timeout | 504 |

   The rules apply top-down, so the 401 rule wins over pass-through: no `wpu_*` error can reach the
   browser as a 401.
3. **Shared types in `shared/`**: a plain root directory, not a workspace.
   - It holds `shared/library-api.ts` (types plus `as const` lists such as `SORT_KEYS` and `ERROR_CODES`;
     no enums, because of `erasableSyntaxOnly`), `shared/library-api.schema.ts` (zod schemas) and
     `shared/fixtures/*.ts`, typed with `satisfies`.
   - **Runtime rule:** any `shared/` file the server imports at runtime has **no dependencies** (types and
     `as const` lists only). The server image installs only the server's production dependencies, so zod
     schemas and fixtures are imported only by tests and mocks.
   - It needs `shared/package.json` with `{"type":"module","private":true}` so the server's `nodenext`
     typecheck treats it as ESM.
   - Importers use relative paths: `.ts` extensions on the server, none on the client.
   - The Dockerfile copies `shared/` into the client-builder and final stages (§2.5).
   - **Spike M0-1 proves it:** server typecheck, runtime, Docker, client build. Also check that imports
     between `shared/` files (which need `.ts` extensions under `nodenext`) build on the client, which may
     need `allowImportingTsExtensions`. Fallback:
     `server/src/contracts/`, imported by the client.
4. **Theme tokens:** `client/src/media-manager/theme/` maps `prototype/css/tokens.css` to the Mantine 9
   theme (design-system §8): `colors.dark`/`neon`, `primaryShade`, the `cssVariablesResolver` for
   `--surface-*` and the other semantic tokens, radius and spacing, and self-hosted Geist fonts.
   F3 builds it in M1, but the token *names* are fixed in M0 by copying them from `tokens.css`.
5. **Scaffold with pre-wired registries.** This is what makes parallel work conflict-free.
   - **Plugin:** `Plugin.php` registers **every controller as a stub** that returns 501
     `wpu_not_implemented`. It calls each class's `register()` method:
     - Each controller and index class registers its own hooks and routes there.
     - Each index (`MediaIndex` for P1, `UsageIndex` for P2) owns its own schema-version option.
     - The `wpu` REST field (P1) collects values from **providers**. P2 implements the `edited`,
       `restorable`, `sizesPending` and `usageCount` providers, which return stub values until P2 merges.
     - The `unused` facet reads P2's usage provider in the same way.
   - **Server:** `server/src/routes/library/index.ts` mounts every sub-router as a stub. `pluginClient.ts`
     and `errors.ts` get their final signatures.
   - **Client:** `client/src/media-manager/` gets the directory skeleton, with **stub entry files in every
     `features/*/index.ts`** that have fixed exports (`FolderColumn`, `InspectorPanel`, `DetailOverlay`,
     `register()`, …).
   - **All npm dependencies** are added in M0/M1 by the orchestrator. The lockfile is the main conflict
     hotspot.
   - **Orchestrator-owned shared files**, edited only by the orchestrator, in M0 and on change requests:
     - `server/src/app.ts` (mounts `routes/library/index.ts`), and `server/src/config/env.ts` (today
       `dotenv.config()` reads only `server/.env`; in `dev` mode it must also read `dev/.env.wp`);
     - `client/src/main.tsx`, `client/vite.config.ts` (proxy target and port from env, §5). F3's test
       setup lives in its own `client/vitest.config.ts`;
     - all `tsconfig*.json` files, `biome.json`, `.dockerignore` (adds `test-results/` and `.cache/`) and
       the root `docker-compose.yml` (its `FILEBIRD_API_KEY` goes in M5);
     - root, `server/`, `client/` and `e2e/` `package.json` files, the lockfile, and `.gitignore`
       (`dev/.env.wp`, the plugin `dist/`, Playwright output);
     - the plugin's entry file `plugin/wp-upload-companion/wp-upload-companion.php` (header `Version:`,
       `WPU_VERSION`, `WPU_API`), `plugin/CHANGELOG.md`, and `plugin/scripts/check-version-bump.mjs`;
     - the **`Dockerfile`**. Every new workspace's `package.json` must be copied into **both** `npm ci`
       stages, or `npm ci` fails out of sync with the lockfile and breaks `ci.yml`'s docker job. Also
       `shared/` in the client-builder and final stages, a plugin-build stage that produces the zip, and
       copying the zip into the final image;

   The gate command itself, `dev/run test all` (§5.2), is owned by track D. `test` mode builds the
   production image, which covers `ci.yml`'s docker job.
6. **Plugin versioning and compatibility check** (in the contract from day one):
   - **Two version numbers in the plugin:**
     - `Version:` in the plugin header, mirrored by the constant `WPU_VERSION` (semver), names the
       release;
     - `WPU_API` (`major.minor`) names the contract level.

     `/info` reports both, plus `features[]`. The **shape of `/info` is frozen for all versions**, so any
     plugin, even an incompatible one, can always be identified.
   - **The server declares what it needs:**
     - `PLUGIN_API_REQUIRED = {major, minMinor}`, used for blocking checks;
     - `PLUGIN_FEATURES_OPTIONAL`, used for non-blocking checks;
     - the version of the bundled zip. The server has no build step, so the plugin build writes a sidecar
       `plugin.json` (version, API level, features) next to the zip, and the server reads it at startup.
       Without a bundled zip (in `dev` mode before a build, and in `ci.yml`'s server tests), `bootstrap`
       reports `plugin.bundled: null`. The checks then use only `PLUGIN_API_REQUIRED`, and
       `plugin/download` returns 404.
   - **`bootstrap` reports `plugin.state`:**

     | State | Condition | What the user sees |
     |---|---|---|
     | `ok` | — | The app |
     | `missing` | No `wp-upload/v1` namespace | Onboarding |
     | `outdated` | Lower major, or same major with a minor lower than `minMinor` | Blocking "Update the plugin" screen with the zip download and the change list. The plugin build bundles a `changelog.json` digest of `plugin/CHANGELOG.md` with the zip |
     | `too-new` | Higher major | Blocking "update the app" message |
     | `forbidden` | `/info` returns 403 (the WordPress user lacks `upload_files`) | Blocking "This app needs a WordPress Editor account" screen (D9) |
     | `update-available` | Compatible, but older than the bundled zip or missing optional features | The app runs. Those features are gated off (`can()` reason "Needs plugin x.y"), and a dismissible notice offers the update |
   - **During development:** tracks **never** bump versions. The orchestrator bumps `WPU_VERSION`, plus
     `WPU_API` for contract changes, in the entry file when it merges plugin changes. That entry file is
     orchestrator-owned, so P1 and P2 can't conflict over it.
     - Contract tests assert `api >=` the level each test needs, never equality, so a track's new route
       passes before the orchestrator raises the level.
     - `check-version-bump.mjs` fails when **shipped** plugin source (`plugin/wp-upload-companion/**`)
       changed without a `WPU_VERSION` bump. Tests, scripts and the changelog don't count.
     - It is **not** part of `dev/run test all`, which tracks run on `mm/*` branches. It runs as
       `dev/run test version-bump` in the orchestrator's post-merge gate, and in `media-manager.yml`
       against `github.event.before`. That needs `fetch-depth: 0`. A first push (an all-zero `before`)
       compares with the merge base against `master`.

     A running dev site can never silently run stale plugin code.
   - **Install modes:** the build produces one single PHP file. A regular plugin install and a
     `mu-plugins` drop-in must both work:
     - Schema creation and upgrades never rely on `register_activation_hook`, which mu-plugins don't fire.
       They use a db-version option checked on `plugins_loaded`.
     - A deactivation hook marks the index stale. `/info` reports it, and the server-driven maintenance
       step catches up after re-activation.
     - CI runs the contract tests against the **built** single-file dist, installed as a regular plugin,
       plus one run with it installed in `mu-plugins/`.
   - **Update policy after release.** Plugin updates are manual for the user, so they should be rare:
     - Solve problems in the server or client whenever possible.
     - Plugin changes are **additive within a major**. Never rename or remove routes, params or fields.
     - New plugin-backed capabilities ship as optional `features[]`, so older plugins degrade gracefully
       instead of blocking.
     - Raise `minMinor` (a blocking update) only for security or data-correctness fixes.
     - Batch the remaining plugin changes into infrequent releases, each with a changelog in
       `plugin/CHANGELOG.md`.
     - Every app release must keep working with the oldest plugin in its supported `1.x` range. CI runs
       the contract tests against the oldest supported plugin build as well as the current one. That
       oldest build is made from the git tag `plugin-v<minimum>`. Until the first plugin release (tag
       `plugin-v1.0.0`) it is the current build.
7. **Track briefs:** `docs/media-manager/tracks/<id>.md`, one per track. Each has the goal, owned paths,
   forbidden paths, inputs and mocks, deliverables, tests, done criteria, and the handoff-note location
   (`tracks/<id>-handoff.md`, owned by the track). Every brief states that the track and any sub-agents
   it starts run at **high** effort (§7). Every brief states the owner's standing permission
   explicitly (D14): the agent may commit on its own `mm/<track>` branch, and must never push, open a PR,
   rebase, or commit anywhere else. This permission overrides the global no-commit rule for that branch
   only.

## 3. Library choices (confirm with spikes in M1)

| Need | Choice | Notes |
|---|---|---|
| Server state | TanStack Query v5 | Layout rows plus items by id chunks (`setQueryData` seeding). One `invalidate.ts` map. Optimistic membership edits |
| UI state | Zustand | One **core store** (selection+anchor, focus, overlay, zoom, panels, connectivity, bootstrap) plus feature-local stores. No central sliced type |
| URL state | Own `useUrlState` (about 120 lines, `useSyncExternalStore`) | The history rules from interaction-spec §1, plus D16 (a folder change replaces). Fix the prototype bug: leaving detail calls `history.back()` when we pushed the entry |
| Virtualisation | TanStack Virtual | Grid rows from exact justified offsets (port the `grid.js` algorithm as a pure module). The `rangeExtractor` pins the focused row. Also the filmstrip and folder tree |
| Folder tree | **Custom** flattened, virtualised ARIA tree | Mantine `Tree` lacks virtualisation and the drop-zone semantics |
| Drag and drop | Pragmatic drag-and-drop (+ hitbox, auto-scroll, external adapter for file drops) | Live in-page drag preview (`disableNativeDragPreview`) |
| Morph | `document.startViewTransition` + `flushSync` | Calls `centerApi.revealItem(id)` before it closes. Falls back to no transition |
| Toasts | `@mantine/notifications` behind our own `toast()`/`undoLast()` | Announcements go through one polite live region |
| Palette | Mantine `Modal` + `Combobox` | Not Spotlight: we need async groups, caps and our own keymap |
| Image editor | Own: port `features/editor-session.js` as pure, tested TS geometry | CSS-transform preview. The plugin does the real edit |
| Icons and fonts | `@tabler/icons-react` via `core/ui/icons.ts`; `@fontsource-variable/geist` + `geist-mono` | Imported only inside the media-manager chunk |
| Client tests | Vitest (node) for pure modules, **Vitest browser mode (Chromium)** + MSW for components | jsdom has no layout |
| E2E and a11y | Playwright in a new `e2e/` workspace, `@axe-core/playwright` | This makes Playwright a repo devDependency. The design scripts may keep using `NODE_PATH` |

## 4. Directory layout and ownership

```
plugin/                       CHANGELOG.md; composer.json + composer.lock (PHPStan and WordPress stubs only);
                              vitest.config.ts; scripts/{build,check-version-bump}.mjs; tests/contract/*.spec.ts
                              (Vitest over HTTP against the compose WordPress); dist/ (gitignored: single
                              file, zip, plugin.json)
plugin/wp-upload-companion/   the shipped source: entry .php, src/{Plugin, FileBird/Adapter,
                              Index/{MediaIndex,UsageIndex}, Query/CollectionQuery, Rest/*Controller}.php
shared/                       library-api.ts, schemas, fixtures/
server/src/routes/library/    one router file per area; lib/library/{pluginClient,cache,errors,jobs}.ts, lib/library/normalise/<area>.ts
client/src/media-manager/
  app/ theme/ shell/          Boot (bootstrap → Onboarding | Shell), providers, layout, panels, breakpoints
  core/{state,url,collection,data,commands,keymap,perms,ui,dnd,uploads}
  features/{grid,filters,peek,detail,folders,inspector,editor,upload,trash,system,command-ui,phone}
  mocks/                      stateful fake library (seeded from prototype/data/*.json + a 50k generator),
                              MSW handlers, scenarios (normal/pro/per-user/no-filebird/no-plugin/author/trash/
                              offline/loading/empty); dev-only, behind VITE_MOCK
dev/                          run (entry script), compose.yml, runner/Dockerfile, proxy config, seed scripts,
                              dev-only mu-plugin (§5)
e2e/                          Playwright: mock/, live/ (production image under /wp-upload/), axe
.github/workflows/media-manager.yml
```

**Foundation APIs** (F1 defines them in M1 and freezes them at the M2 gate):

- `CommandMap`: declared up front for every cross-feature action and extended by TS module augmentation.
  Its API is `implementCommand`, `runCommand` and `useCommand → {run, enabled, reason, shortcut}`. An
  unimplemented command renders as disabled ("Not available yet").
- **Keymap:** `registerBindings(feature, bindings[])` binds keys to commands. At registration it asserts
  the **US + DK layout rule** and checks for conflicts. `useKeyLayer` handles Esc layering. One dispatcher
  ignores IME input, AltGr/Alt, text fields (except Esc and Mod+Enter), modals, menus, listboxes and
  `[data-mm-local-keys]`.
- **UI helpers:** `toast()`, `undoLast()`, `announce()`, and `confirm({body: ReactNode, typeToConfirm?})`.
- **Permissions:** `can(action, item?) → {ok} | {ok:false, code, reason}` plus `partition()` for mixed
  Author selections. They are fed by bootstrap caps, `wpu.perms`, connectivity, FileBird mode, Pro, and
  the plugin's `features[]`, which gives the "Needs plugin x.y" reason.
- **Collection:** `useCollection()`, `useItem()`, `useTargets()`. `centerApi.revealItem` and `tileElement`
  are registered by the grid.
- **Other registries:** `useMediaDraggable(ref, id)` in `core/dnd`, palette sources registered per
  feature, and the tile upload state `{phase, progress, error, previewUrl}` rendered natively (interaction
  spec §13.1).

**Until M5, the two UIs sit side by side** (D1c):

- **The orchestrator does the whole split in M0, in one change,** so the old page never runs without its
  provider:
  - `main.tsx` no longer mounts a provider or imports any CSS;
  - a minimal `?view=` switch goes into `App.tsx`, which keeps the auth state machine;
  - the old page's `MantineProvider`, theme, `cyberpunk.css` and `@mantine/dropzone/styles.css` move into
    a lazily loaded old-view module. Its global `body` and scrollbar styles then never load in the
    library.

  F1 takes over `App.tsx` in M1.
- `?view=library` loads the lazy media-manager chunk through a full navigation, with its own
  `MantineProvider` and colour-scheme key. `useUrlState` must keep the `view` param until M5.
- Without the param, the old page loads.
- **Login and session UI in the new theme** belong to F1 (`app/`, `shell/`): the login screen, the
  session-expired dialog (reusing `apiFetch`'s 401 listener), the "WordPress unreachable" state from
  `bootstrap.wp.state`, and a logout control in the toolbar. Logout lives in `Uploader` today and must not
  depend on it.
- At M5 the library becomes the only view.

**Change control:**

- `shared/`, the contracts and the orchestrator-owned files (§2.5) belong to the orchestrator from M0.
- `core/` (F1, plus F2's `core/data/`), `app/` and `shell/` pass to the orchestrator at the **M2 gate**, when the core API
  freezes. Tracks raise change requests in their handoff notes.
- **Per-track files in shared directories**, allowed so that wave A and B tracks don't need change
  requests for routine additions:
  - `client/src/media-manager/mocks/handlers/<feature>.ts`;
  - `client/src/media-manager/core/data/<feature>.ts` (that feature's queries and mutations);
  - `e2e/{mock,live}/<track>.spec.ts`;
  - `server/src/lib/library/normalise/<area>.ts`.

  The orchestrator pre-registers the handler and normaliser files as stubs in M0. S1 owns
  `normalise/{items,folders}.ts`, and S2 adds its own area files.

## 5. Dev and test environments (D11, D18)

**Principle (D18).** There are **no hosted environments**: no shared dev site, no staging server, and no
test ever needs a real WordPress site. Every environment is one Docker Compose project that runs on the
developer's machine, and **CI runs the same project with the same commands**. **All tests are automated
and all of them run in `test` mode.** So:

- a test that passes locally passes in CI;
- a CI failure reproduces locally with the command CI printed;
- nobody needs anything installed beyond Docker, plus Node 24 and npm for the fast inner loop.

### 5.1 One compose project, two modes

Everything lives in `dev/compose.yml`, which track D owns. Compose profiles select the services:

| Service | Image (all pinned by digest) | Modes | Role |
|---|---|---|---|
| `db` | `mariadb:11.4` | all | WordPress database |
| `wordpress` | `wordpress:7.1-php8.3-apache` | all | WordPress with FileBird Lite and the companion plugin. Plugin source is mounted in `dev` mode; the **built single-file dist** is installed in `test` mode |
| `wpcli` | `wordpress:cli` (same PHP version) | all, one-off | Install, seed, variant toggles, snapshot and restore |
| `runner` | `dev/runner/Dockerfile`: the official Playwright image matching the repo's pinned `@playwright/test`, plus Node 24 | `test` | Runs **every** test command: lint, typechecks, Vitest (node and browser), contract tests, Playwright. It mounts the repo and keeps `node_modules` in a named volume, so host `node_modules` and platform binaries never leak in |
| `app` | Built from the repo's own `Dockerfile`, the production image | `test` | The real app container, with the plugin zip bundled, pointed at `wordpress`. All live e2e tests drive it |
| `proxy` | `nginx` (pinned) | `test` | Serves `app` under `/wp-upload/` with the prefix stripped, serves the **mock build** (`VITE_MOCK`) under `/wp-upload-mock/`, and puts a TLS-terminating front on `wordpress`. A dev CA generated by `dev/run up` signs it, and it is trusted **only inside the stack** (§5.3) |
| `php81`, `php84` | `php:8.1-cli`, `php:8.4-cli` (pinned) | `test`, one-off | `plugin-static`: `php -l` on both versions, and PHPStan (from `plugin/composer.lock`) on 8.4 |

**The two modes:**

- **`dev`** is the daily inner loop. Only `db` and `wordpress` (plus `wpcli`) run in Docker. The server
  and Vite run on the host with hot reload (`npm run dev`), reading the generated `dev/.env.wp`. It is
  fast, but it is not the parity mode, and nothing gates on it.
- **`test`** runs every test, locally and in CI:
  - WordPress runs the built plugin.
  - The **production image** runs behind the `/wp-upload/` prefix-stripping proxy, against WordPress
    over TLS.
  - Every test command runs inside `runner`, and each suite starts from a restored DB snapshot.

  The mode covers, all automated:
  - unit and contract tests;
  - the live e2e suites, which always go through the production image under the sub-path, so the
    "deployable under any path" rule is tested on every run;
  - the live-verification items from the synthesis, as automated checks: `?fbv=` on upload, a large
    `include=` through a reverse proxy, the WordPress 7.1 client-side processing routes behind a
    TLS-terminating proxy, and per-user mode.

### 5.2 One entry point: `dev/run`

`dev/run` is a readable Bash script (named functions, one subcommand per function, a *why* comment per
section). It is the only interface, for people, track agents and CI alike:

| Command | Does |
|---|---|
| `dev/run up [dev\|test]` | Builds and starts the mode's services, waits for health, installs WordPress, FileBird and the plugin, creates the Editor and Author users with app passwords, writes `dev/.env.wp` |
| `dev/run seed small\|large` | Generates the seed in the container with a fixed random seed and fixed dates. It then takes a snapshot of **both the DB and the uploads volume**, one snapshot per profile |
| `dev/run reset [small\|large]` | Restores the DB and the uploads volume from that profile's snapshot (default `small`). Every suite calls it first, so file-changing suites (edit, replace, regenerate, delete, upload) never leak into the next one |
| `dev/run variant trash=on filebird=off peruser=on role=author` | Flips variants through the dev-only mu-plugin, without restarts. `role=author` switches the **one app user** between the Editor and Author roles, so `app` keeps its credentials |
| `dev/run test <suite>` | Runs a suite inside `runner` (`plugin-static` inside the PHP services). Suites: `lint`, `typecheck`, `unit`, `plugin-static`, `plugin-contract`, `server-live`, `e2e-mock`, `e2e-live`, `perf`, `version-bump` (orchestrator only, see §2.6), and `all` (everything except `perf` and `version-bump`) |
| `dev/run logs`, `dev/run down [--volumes]` | Diagnostics and clean-up |

- Results, Playwright traces, WordPress `debug.log` and compose logs always go to `test-results/` on
  the host, which is gitignored. They land in the same place locally and in CI.
- `dev/run test all` is **the** pre-merge gate for tracks and the orchestrator. It replaces any separate
  "local CI" script.
- Host shortcuts such as `npm test` stay available for speed. A result only counts when it comes from
  `dev/run`.
- Live server tests are named `*.live.spec.ts` and run from their own `vitest.live.config.ts`. The
  default server config excludes them, so `npm run test -w server` and `ci.yml` keep running without a
  WordPress.
- `e2e-mock` drives a separate `VITE_MOCK` build, which the proxy serves under a sub-path. MSW's worker
  file is copied into that build only, never into `client/public`, so it never reaches the production
  dist.

### 5.3 What keeps local and CI identical

- **Pinned everything:**
  - images by digest;
  - FileBird by version, with its zip's checksum verified;
  - npm via the lockfile (`npm ci` inside `runner`);
  - the Playwright version in both `package.json` and the runner image, checked against each other by a
    test.
- **Deterministic data:** seeds use a fixed random seed and fixed dates. Every suite starts from
  `dev/run reset`. `TZ=UTC` and a fixed locale are set in `runner`, `app` and `wordpress`.
- **Isolation:** `dev/run` derives `COMPOSE_PROJECT_NAME` from a lowercase, sanitised hash of the
  worktree path, which Compose requires. It also derives a port block from it, checks those ports are
  free, and falls back to the next block if not. Each mode has its own volumes, because `dev` serves
  WordPress over plain HTTP on a host port while `test` serves it over TLS through the proxy, and the
  site URL is stored in the database.
  Parallel worktrees, and parallel CI jobs, never share a stack:
  - Variant toggles and resets are global to a stack.
  - Each worktree mounts its own plugin source.
  - Fixed names and ports would otherwise collide.

  Mock-only work needs no stack.
- **TLS inside the stack:** `dev/run up` generates a dev CA. It is trusted:
  - by `app`, via `NODE_EXTRA_CA_CERTS` (env and config only, the image is unchanged);
  - by `wordpress`, for its loopback requests;
  - in `runner`, by Node (the system store) and by Chromium (its NSS database, via `certutil`).

  Nothing outside the stack trusts it.
- **File ownership:** `dev/run` starts `runner` with `--user "$(id -u):$(id -g)"` and a writable `HOME`,
  so outputs in the bind-mounted repo (`client/dist`, `plugin/dist`, `test-results/`) stay owned by the
  host user.
- **No CI-only logic.** The workflow only checks out the code, restores caches, and calls `dev/run`. If
  CI ever needs a step that local runs don't have, it goes into `dev/run`. The single allowed difference:
  when `CI=true`, `dev/run` adds the GitHub Actions buildx cache options (`cache_from`/`cache_to`) to
  image builds. That only affects speed.
- **Dev site details:**
  - `WP_ENVIRONMENT_TYPE=local`, needed for app passwords over plain HTTP in `dev` mode;
  - the Editor user (D9) for most suites, the Author user for read-only scenarios;
  - the dev-only mu-plugin (never shipped) sets `MEDIA_TRASH` from an option and toggles FileBird on/off
    and per-user mode;
  - suites that toggle a variant run serially inside their own stack.

### 5.4 Seed profiles

- **`small`:**
  - about 200 images in varied aspects, generated with PHP and GD in the container;
  - committed tiny mp4, mp3, pdf and svg fixtures;
  - 15 folders, and 30 posts that use media in every usage context.

  Every functional suite uses it.
- **`large`:** 50k synthetic attachment rows pointing at a few dozen real files, 300 folders (about 70 %
  assigned) and 5k posts. Only the `perf` suite uses it.

**Without Docker** (for example a lightweight remote container), only mock-mode client work and host unit
tests are possible. Nothing gates on them. If a track's environment has no Docker, the orchestrator runs
`dev/run test all` on that `mm/<track>` branch before the owner's review. WordPress Playground is not part of the test path, because
SQLite would break parity.

## 6. Feature-branch CI (D13)

`.github/workflows/media-manager.yml` runs on `push` to `feature/media-manager` and on `pull_request` with
`branches: [feature/media-manager]`. It has `permissions: contents: read`, cancel-in-progress concurrency,
and never publishes. **Every job is "checkout (`fetch-depth: 0`) → restore caches → `dev/run up <mode>`
(except `static`) → `dev/run test <suite>` → upload `test-results/`".**

| Job | Mode and suites |
|---|---|
| `static` | No stack: `dev/run test lint`, `typecheck`, `unit` (in `runner`), `plugin-static` (`php -l` on PHP 8.1 and 8.4, PHPStan with WordPress stubs, and the single-file plugin and zip build) and `version-bump` (against `github.event.before`). Uploads the plugin zip as an artifact |
| `integration` | `test` mode: `plugin-contract` (also against the oldest supported plugin build and in `mu-plugins`), `server-live` (including the live-verification checks), `e2e-mock`, `e2e-live` (the production image under `/wp-upload/`, axe in both themes) |
| `perf` | Opt-in, on `push` only, with `[perf]` in the head commit message (`pull_request` events have no head commit): `seed large`, then `perf` |

- **Caches:** they only affect speed, never behaviour.
  - The `runner` and `app` images use the buildx GitHub Actions cache, set up with `setup-buildx-action`
    and enabled by `dev/run` when `CI=true` (§5.3).
  - The npm cache is a bind-mounted host directory (`.cache/npm`), restored with `actions/cache`. Named
    volumes don't survive between GitHub-hosted jobs.
- **Target:** 15 minutes or less.
- **`ci.yml` must stay green:** keep `/healthz`, the `/api/status` 401 contract and the login flow
  intact.
  - `ci.yml` only runs on PRs and `workflow_dispatch`, and under D14 there are no PRs into the feature
    branch.
  - So at each gate the orchestrator asks the owner to approve
    `gh workflow run ci.yml --ref feature/media-manager`. This works because `ci.yml` exists on `master`.
  - Its docker job is already covered locally, because `test` mode builds the production image.
- Schedule triggers would need the workflow file on `master`, so they are out of scope.
- **Gate procedure (D14):**
  1. Tracks are merged locally, and `dev/run test all` passes on `feature/media-manager`.
  2. The orchestrator asks the owner to approve pushing `feature/media-manager`.
  3. After the push, the gate waits for `media-manager.yml` and the dispatched `ci.yml` to pass.

  Without approval to push, the gate is the local run alone. Because the commands are identical, that is
  a full stand-in, apart from runner hardware.

## 7. Milestones, tracks and parallelisation

Every track runs in its own worktree and session, on a branch `mm/<track>` created from
`feature/media-manager`.

**Effort level (owner rule): high, always.**
- The orchestrator session, every track session and every sub-agent run at **high** effort, never lower.
- When the orchestrator starts work, it sets the effort explicitly:
  - `effort: "high"` on the Agent tool and on `create_session`;
  - `claude --effort high` for a terminal session.
- Agent definitions pinned to an effort, such as `final-reviewer`, keep their own pin, which is already
  high.
- Each track brief repeats this rule, so any sub-agent a track starts also runs at high effort.

Each track then works like this:

- via `git worktree add` and a new session, or with the Agent tool's worktree isolation started from a
  checkout of `feature/media-manager`;
- it owns its paths exclusively, may commit locally, and never pushes;
- it pulls in integration with `git merge feature/media-manager`, never rebase;
- it ends with a handoff note and a green `dev/run test all` (run by the orchestrator if the track's
  environment has no Docker, §5.4).

The orchestrator then:

- has the owner review the branch diff;
- merges it in the order given;
- reruns the full check suite;
- announces the merge so other tracks can merge it in.

**Cadence:** an integration pass whenever a track finishes, and at least every 2–3 working sessions while
a wave runs.

### M0: contracts and scaffold (orchestrator, plus D in parallel)

- **Work:** the contract docs, `shared/` and fixtures, the scaffold stubs (§2.5), the dependency install,
  the `main.tsx`/`App.tsx`/old-view split (§4), striking the amended spec lines (§0), the track briefs,
  and spike M0-1 (shared types).
- **Track D starts at once:** it owns `dev/**`.
  - **Day-1 deliverable:** `dev/run up dev` with the app password and `dev/run seed small`.
  - Then `test` mode (`runner`, the production image and the proxy) with `dev/run test`, the CI workflow,
    and the `e2e/` skeleton (all owned by D). Then the `large` seed.
- **Gate (Checkpoint 4):** the owner approves the contracts. The scaffold builds. A lazy chunk loads under
  `/wp-upload/` in `test` mode.

### M1: foundation (6 parallel tracks)

| Track | Owns | First deliverable | Also |
|---|---|---|---|
| **D** env/CI | `dev/**`, `media-manager.yml`, `e2e/` config | (continues from M0) | Spike X4 (50k perf) |
| **P1** plugin read | `src/Plugin.php`, `FileBird/Adapter`, `MediaIndex`, `CollectionQuery`, Info/Collection/Folders/Maintenance controllers, the `wpu` field, `rev`, the build script, their contract tests | `/info`, `/collection`, `wpu`, `GET /folders` | Then facets and folder mutations. Spike X9 (Pro detection) |
| **P2** plugin mutations | Media/Trash/Usage/Images controllers, `UsageIndex`, their contract tests | `media/batch` | **Spikes X2** (`wp_save_image`/`wp_restore_image` shim) **and X3** (replacing a `-scaled` file) first, then trash, usage, images |
| **S1** server read | `routes/library/{index,bootstrap,rev,collection,facets,items,folders}.ts`, `lib/library/{pluginClient,cache,errors}.ts`, `lib/library/normalise/{items,folders}.ts`, compression | bootstrap, collection, items, `PATCH items/:id` against fixtures | LRU keyed by `rev`, single-flight, ETag/304 |
| **F1** client core | `app/`, `shell/`, `core/{state,url,collection,commands,keymap,perms,ui,dnd,uploads}`, `App.tsx` (taken over after the M0 split), login and session UI in the new theme | Store, URL, commands, keymap, shell with stubs, upload transport in `core/uploads` | Spikes C2 (morph with the virtual grid) and C4 (Esc layering vs Mantine) |
| **F2** data + mocks | `core/data/`, `mocks/`, contract tests of the fake vs the zod schemas | Query keys, http over `apiFetch`, stateful fake, MSW, scenarios, 50k generator | Spike C5 (50k payload and parse) |
| **F3** theme + quality | `theme/`, fonts, client Vitest config (node + browser), bundle-budget script, `app.spec.ts` URL-guard extensions | The theme from the tokens, both schemes | Spikes C1 (justified layout + virtualiser at 50k) and C3 (virtual tree + Pragmatic DnD) |

- S2 (server mutations) starts as soon as S1's `pluginClient` lands: it owns `routes/library/{batch,
  delete,trash,usage,images,jobs,upload,posts,download,pluginDownload}.ts`, `lib/library/jobs.ts`, the
  `fileInto` hook in `uploadJobs.ts`, and its own `lib/library/normalise/<area>.ts` files. The orchestrator
  makes the Dockerfile changes.
- **Merge order:** D → P1 → S1 → F3 → F2 → F1 → P2/S2 (whenever they're ready).
- **Gate:** the foundation unit tests and all harnesses pass (gate procedure, §6), and the spike notes are
  accepted (each is one page in `tracks/spikes/`).

### M2: vertical slice (one client agent, continuing F1)

- **Scope:** boot checks the plugin and shows Onboarding (a placeholder) or the Shell. Then:
  - a justified, virtualised grid driven by `?folder=&q=&sort=`, with click and arrow selection;
  - Enter or double-click opens detail with the morph, push/Back, and ←/→;
  - the inspector for a single item, with Title and Alt autosave (Unsaved → Saving → Saved, error with
    Retry) and an optimistic patch with rollback.
- **Backend:** P1/S1 harden the slice endpoints live, while P2/S2 continue.
- **Where the code goes:** into `features/grid|detail|inspector`. Wave A inherits it.
- **Gate:**
  - the slice e2e passes in **mock and live** mode, under a sub-path, in both themes;
  - the owner reviews the feel at 50k in mock;
  - the **core API is frozen**.

### M3: wave A, breadth (4 client tracks, plus P2/S2 finishing)

| Track | Owns | Deliverables |
|---|---|---|
| **A1** grid, filters, peek | `features/{grid,filters,peek}` | Justified/square grid, density, tiles (badges, non-image cards, upload state), full pointer and keyboard selection, selection bar, search, chips, the "+ Filter" menu, months, sort, the facets summary, skeleton and empty states, peek |
| **A2** detail | `features/detail` | Stage per media type (video, audio, PDF, archive), sub-size upgrade and preload, virtual filmstrip, zoom/pan, More menu, return ring, swipe (phone) |
| **A3** folders | `features/folders` | Column (resize, collapse, `inert`), virtual tree, count modes, search, create/rename/delete, context menu, DnD (media → folder, reparent/reorder) with live preview and Undo, Move to… (`M`), Pro colours and sort, per-user read-only notice |
| **A4** inspector | `features/inspector` (hosts the `EditPanel` stub) | Rail with badges, Info for 0, 1 and N items, a draft store keyed `id:field`, batch with Mixed/Append and Undo, Save & next and the alt pass, Usage panel and post picker, Author read-only state |

- B4 (system states) and B5 (sheet and palette) depend only on core. Pull them into wave A if there is
  capacity.
- **Merge order:** P2 → S2 → A1 → A2 → A4 → A3. A3's drag and drop touches tile behaviour last.
- **Gate:**
  - per-track component tests and e2e flows pass in mock mode;
  - the live e2e passes for browse, folders and metadata;
  - axe is clean in both themes;
  - the 50k performance budgets are met (§9).

### M4: wave B (6 tracks)

| Track | Owns | Deliverables |
|---|---|---|
| **B1** editor | `features/editor` | Ported geometry, crop canvas, the Edit panel, save as a job with progress and Undo, Restore, Regenerate (single and batch), Replace, discard guard |
| **B2** upload | `features/upload` | Drop overlay (Pragmatic external adapter), picker and `U`, queue (3 parallel), processing polling ("Still processing…" after 8 s), tray, rejections from bootstrap limits. Uses the `core/uploads` transport against `api/library/upload*` |
| **B3** delete, trash, download | `features/trash` | Remove-from-folder and Delete commands, a rich confirm (thumbnails, where-used, type-to-confirm at 25 or more items), Trash view at `folder=trash`, proxied download |
| **B4** system | `features/system` | Real Onboarding (download plugin zip, three steps, Check again; no link to the old page per D1c); the plugin-compatibility screens from §2.6 (blocking `outdated` with zip and change list, blocking `too-new`, `forbidden`, a dismissible `update-available` notice); offline banner with back-off; author banner; loading hairline |
| **B5** sheet and palette | `features/command-ui` | `?` sheet built from the command and keymap registry, `Mod+K` palette with sources and fuzzy ranking |
| **B6** responsive | `shell/` (handed over by the orchestrator), `features/phone` | Breakpoints at 1200, 900 and 600 px: drawers, inspector sheet, phone bottom sheet, phone toolbar |

**Gate:** feature-complete v1 in mock mode and live, and the full scenario matrix passes. Pro runs in mock
mode only (D15).

### M5: hardening and rollout (orchestrator, plus up to 2 helpers)

- The full live e2e matrix, and every live-verification item from synthesis §"Needs live verification".
- A plugin security review: prepared SQL, per-item caps, MIME and extension checks on replace, time
  budgets, no front-end work.
- An a11y pass and the performance budgets at 50k.
- **Remove the old upload page (D1c):** delete everything the media manager can't reach, verified with a
  dead-code check (unused exports and files, plus the dependency list). That includes at least:
  - the client: the old-view module, `Uploader`, `FileQueue*`, `FolderPicker`, `Dropzone`, `NyanUnicorn`,
    `ServerLoadStats`, `SummaryBar`, `ConnectionStatus`, `FolderIcon`, `AppHeader`, `useUploadQueue`,
    `lib/uploadClient.ts`, `lib/folderClient.ts`, `lib/uploadStats.ts`, `cyberpunk.css`, the old theme, and
    `@mantine/dropzone`;
  - the server: the legacy `/api/media` and `/api/folders` routes, `/api/server-load` with
    `config/serverLoad.ts` and `systeminformation`, `FILEBIRD_API_KEY` with the FileBird public-API client,
    and `uploadJobs.ts`'s import of `assignToFolder`.

  Keep the upload-job internals the library uses, plus `/healthz`, `/session` and `/api/status` (`ci.yml`
  checks these).
- **Docs:**
  - README: plugin install, env vars, dev stack;
  - repo `CLAUDE.md`: new layout and commands;
  - HANDOFF: status.
- **Final review step (auto-address):** run the `final-reviewer` sub-agent over the whole
  `feature/media-manager` diff against `master`. Pass it this plan and the specs. Address the findings
  worth acting on, and report the rest with reasons. Fixes stay uncommitted.

## 8. Testing strategy

| Layer | Tool | Covers |
|---|---|---|
| Plugin | Vitest contract tests over HTTP against dev WordPress; `php -l` and PHPStan | Every route across the variants (FileBird on/off, per-user, `MEDIA_TRASH` on/off, Editor vs Author). The response structure is compared with `shared/fixtures`, which stops mock/live drift |
| Server | Vitest + supertest, as in today's `vi.spyOn(wpAxios)` and `vi.mock` patterns, plus a live suite against dev WordPress | Normalisation, error mapping, caching by `rev`, jobs, chunking |
| Client, pure | Vitest (node) | Justified layout and ↑/↓ neighbours, selection, URL codec and history policy, keymap (layout safety over **all** bindings, a US/DK event matrix, AltGr rejection, suspension), `can()`, undo registry, editor geometry, fuzzy ranking, tree flatten/search/cycle/suffix, autosave state machine |
| Client, component | Vitest browser mode (Chromium) + MSW | Each track tests its own directory |
| E2E | Playwright, in `runner` | `e2e-mock` (fake library) and `e2e-live` (the production image behind the `/wp-upload/` prefix-stripping proxy, against the compose WordPress). Axe on every screen in both themes. The same commands locally and in CI (§5) |
| Bundle and URL guards | `app.spec.ts` extensions | Also flag `/wp-json`, `"/assets/` and CSS `url(/`. Assert no MSW in dist. The media-manager code must not be in the entry chunk |

## 9. Performance budget (verified in M3 and M5)

| Measure | Budget |
|---|---|
| Plugin `/collection`, `/facets` and Uncategorized | p95 ≤ 300 ms at 50k |
| Collection payload | ≤ 250 kB gzip at 50k for the default sort; ≤ 300 kB for any sort (spike C5) |
| Justified layout of 50k items | ≤ 50 ms |
| Long tasks while scrolling | none over 50 ms |
| Initial media-manager chunk | ≤ 150 kB gzip; editor, palette, sheet, trash and onboarding are nested lazy chunks |
| First tiles on the dev stack | ≤ 1.5 s |

## 10. Spikes (timeboxed; each ends in a one-page decision note)

| # | Spike | Track | Result that changes the plan |
|---|---|---|---|
| M0-1 | `shared/` types: typecheck, runtime, Docker | orchestrator | Fallback `server/src/contracts/` |
| X2 | `wp_save_image`/`wp_restore_image` shim in REST | P2 | Too fragile: our own `WP_Image_Editor` pipeline with backups (P2 roughly doubles) |
| X3 | Replace a file that was uploaded as `-scaled` | P2 | The URL can't be kept: restrict replace or warn in the UI (a spec change) |
| X4 | Collection, facets and Uncategorized at 50k/100k | D + P1 | Too slow: denormalise the folder into the plugin's own `wpu_media_index` (kept current from FileBird's `fbv_after_set_folder`/`fbv_after_assign_folder` hooks and the maintenance step), so Uncategorized and folder filters never scan FileBird's relation table. FileBird itself is never altered (D17). Payload too big: send the collection in chunks |
| X5 | `include=` hydration of 100 items with `_fields` | S1 | Over 500 ms: a plugin `tiles` endpoint (only the server normaliser changes) |
| X6 | `POST /wp/v2/media?fbv=` with an app password | S2 | If it works, the folder is assigned in the upload call itself |
| X7 | Usage-parsing accuracy and backfill throughput | P2 | Tunes the maintenance step budget and the "index incomplete" wording |
| X9 | FileBird Pro detection and colour storage, from Lite's source and public signals (no licence, D15) | P1 | If detection can't be made reliable without Pro, Pro features stay hidden in v1 rather than risk wrong behaviour |
| X10 | Visual Portfolio usage detection (D22): install 3.11.0 in the dev stack, confirm where the block, loop-gallery and saved-layout galleries store attachment ids, and seed one of each | P2 (+ D for the seed) | If the storage differs from the source reading, adjust the parser; if it isn't reliably parseable, ship it marked as best effort |
| C1–C5 | Virtual justified grid at 50k; morph with the virtual grid; virtual tree + DnD; Esc layering vs Mantine; 50k payload parse | F3/F1/F2 | Library swaps, or a chunked collection |

## 11. Risks

- **Collection consistency:** the order, the id-chunk hydration and optimistic membership edits.
  Mitigated by the single ordered `/collection` with an ID tiebreaker, `rev`, and the central invalidation
  map.
- **Virtualisation against focus, ARIA, morph and DnD:** the focused or dragged element can unmount.
  Mitigated by the pinned focus row, `revealItem`, and spikes C1–C3.
- **FileBird coupling:** we call its PHP model, which changes often in security releases. We never alter
  FileBird (D17).
  - The Adapter feature-detects classes and methods and falls back to read-only table SQL for reads.
  - Writes only ever go through FileBird's own functions.
  - Contract tests are pinned to 6.5.9.
  - `/info` reports the FileBird version.
  - A compatibility row in the README.
- **Plugin installed as a regular plugin (D12):** it can be deactivated, and hooks are missed while it is
  off. `/info` reports the index state, and the server-driven maintenance step repairs it.
- **Plugin updates are manual for users:** the versioning and update policy in §2.6 keeps them rare and
  non-breaking.
- **Long WordPress operations** (thumbnail generation can take minutes): every edit, regenerate and
  replace runs as a job. No short timeouts on those calls. List calls get per-call timeouts.
- **Autosave races and key layering with Mantine internals:** tested explicitly (§8).
- **Parallel drift:** stubs, the M2 API freeze, change control and the integration cadence.
- **Security:** any Editor or Author can call the plugin routes. Review in M5.
- **Pro features are unverified live (D15):** a Pro site could store colours or sort settings
  differently from what Lite's source suggests. Colours (`PATCH color`) are written only through
  FileBird's own colour function (Lite's `update-folder-color` controller stores `fbv_folder_colors`; X9
  confirms the PHP entry point), and sort is offered only when detection is confident. A Pro user who reports a problem is the first live check.
- **Removing the old page (D1c)** loses the plugin-free and phone-first upload path. The phone layout
  (B6) and the upload track (B2) must cover phone uploads well.

## 12. Open questions

None at the moment. The three questions raised during planning are settled as D15–D17 (§0). New
questions go to the owner at Checkpoint 4.

## 13. Verification summary per milestone

| Milestone | Verified by |
|---|---|
| M0 | Contracts approved; scaffold builds; `shared/` spike; lazy chunk under `/wp-upload/` in `test` mode |
| M1 | Each track's unit and contract tests; gate procedure (§6); spike notes |
| M2 | Slice e2e in mock and live mode, under the sub-path, in both themes; owner feel review at 50k |
| M3 | Component tests, mock and live e2e for browse, folders and metadata, axe, performance budgets |
| M4 | The full scenario matrix in mock mode, live e2e for upload, edit, trash and delete |
| M5 | Live verification items, security review, removal of the old page with `ci.yml` and the feature CI green, docs, **final-reviewer (auto-address)** |
