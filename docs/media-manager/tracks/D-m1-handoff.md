# Track D (dev/test environment): M1 handoff

Branch `mm/d-m1`, from `feature/media-manager` @ e09ac4f. Scope: the M1 brief
([D.md](D.md)): the Author user (D26), Visual Portfolio (D22, spike X10), the e2e workspace config,
the plugin suites, and the `large` seed with the `perf` suite (spike X4). Everything lives in
`dev/**`, `.github/workflows/media-manager.yml`, `e2e/playwright.config.ts`, `e2e/tsconfig.json`,
`e2e/support/**`, plus the per-track specs `e2e/{mock,live}/d.spec.ts` (plan §4).

Docker was available; every result below comes from this worktree's own stack.

## 1. What works

All commands run from the repo root.

| Command | What it does now | Verified |
|---|---|---|
| `dev/run up dev\|test` | Also installs **Visual Portfolio 3.11.0** (zip sha256-checked, active) and creates the **Author user** `wpu-author` with its own app password, next to the Editor app user `wpu-app` | Yes, from `down --volumes` (§1.1) |
| `dev/run variant vp=on\|off` | Hides Visual Portfolio like `filebird=off` does (an `active_plugins` filter; its posts, meta and options stay). Default `vp=on` | Yes: `vp=off` removes the `visual-portfolio/v1` namespace and `wp plugin list` shows it inactive; `vp=on` brings it back |
| `dev/run seed small` | As in M0, plus Author-owned media and posts, the Visual Portfolio galleries (§5.1), and Visual Portfolio's own first-run placeholder image | Yes: two runs give identical row and upload checksums; dev and test get the same post ids |
| `dev/run seed large` | 50 000 attachments over 36 real files, 300 FileBird folders (70 % assigned through FileBird), 5 000 posts; snapshot `large`. About 75–100 s | Yes (§1.1) |
| `dev/run reset large` | Restores the `large` snapshot | Yes, about 10 s |
| `dev/run test e2e-mock` | Builds the mock build into `dev/.build/mock-dist/` (F2's `client/vite.mock.config.ts` once it exists, the plain client until then), then runs the Playwright `mock` project | Yes: 2 passed |
| `dev/run test e2e-live` | Restores `small`, rebuilds the production image (cached), runs the `live` project with `--workers=1` | Yes: 2 passed |
| `dev/run test plugin-static` | Builds the plugin, `php -l` on 8.1 and 8.4 (sources and the built file), composer + PHPStan; reports what's missing as "not available yet" | Lint passes here; build and PHPStan verified with stand-ins (§1.2) |
| `dev/run test plugin-contract` | Builds the plugin, then runs the contract tests three times: regular plugin, oldest supported build, `mu-plugins/` | "Not available yet" here; all three runs verified with stand-ins (§1.2) |
| `dev/run test perf` | Restores `large` (seeding it first if needed), installs the current build, times the plugin routes against the budget, plus a core REST and FileBird baseline | Yes, baseline (§6) |
| `dev/run test <suite> -- <args>` | Arguments after `--` go to Playwright or Vitest, e.g. `dev/run test e2e-live -- --trace on --grep library` | Yes |

### 1.1 Verification from a clean state

Starting from `dev/run down --volumes` (both modes):

- `dev/run up test`: about 40 s. `dev/run seed small` twice: about 1.5 min each, and identical
  checksums of `wp_posts` (253 rows), `wp_postmeta` (872), `wp_fbv` (15), `wp_fbv_attachment_folder`
  (160), `wp_users` (3), `wp_term_relationships` and the whole uploads tree.
- `dev/run up dev` and `seed small`: the same post ids, types and slugs as in test mode.
- Both users authenticate with their app passwords over TLS: `users/me?context=edit` gives
  `['editor']` for `wpu-app` and `['author']` for `wpu-author`; after `variant role=author` both
  report `['author']`, and `role=editor` switches only `wpu-app` back.
- `dev/run test all` on that stack: **passed** lint, typecheck, unit, e2e-mock, e2e-live; **not
  available yet** plugin-static (no `build.mjs`/`composer.lock`), plugin-contract (no
  `vitest.config.ts`), server-live (S1). Exit status 1, as M0 intends while suites are missing.
- `dev/run seed large` twice: 77 s and 72 s, identical checksums (same tables plus uploads).
  `dev/run reset large`: 9 s. `dev/run test perf`: 47 s. `dev/run reset`: 6 s.
- The X10 rendering check (§5) ran on the seeded stack.

### 1.2 The plugin suites with stand-ins

P1 hasn't landed `build.mjs`, `vitest.config.ts` or `composer.lock` yet, so both suites were run in a
scratch copy of this branch (its own git repo and stack, deleted afterwards) with stand-ins:

- a `build.mjs` that writes a small single-file plugin to
  `plugin/dist/wp-upload-companion/wp-upload-companion.php`. Its `/info` reports `install`
  (`plugin` or `mu-plugin`, from `__FILE__` vs `WPMU_PLUGIN_DIR`) and which build it is;
- a contract spec that checks `/info` against `WPU_PLUGIN_INSTALL` and that the Author user
  authenticates with role `author`;
- a `composer.json`/`composer.lock` with `phpstan/phpstan` 2.3.7, `szepeviktor/phpstan-wordpress`
  2.0.4 and `php-stubs/wordpress-stubs` 7.1.2, and a `phpstan.neon.dist` at level 1;
- a git tag `plugin-v0.9.0` whose stand-in build reports `oldest`.

Results:

- `plugin-static`: build ran, `php -l` clean on 8.1.34 and 8.4.28 (including the built file),
  composer installed the lock into the `plugin_vendor` volume, PHPStan `[OK] No errors`. The host's
  `plugin/vendor/` stayed an empty directory, and `git status` was clean.
- `plugin-contract`: the `plugin` run saw `install: plugin`, build `current`; the `oldest` run built
  `plugin-v0.9.0` with that tag's own `build.mjs` and saw build `oldest`; the `mu-plugin` run saw
  `install: mu-plugin`, build `current`, with the regular plugin removed. All three passed, and the
  stack ended on the regular install.
- `perf` with a stand-in plugin that serves `collection`, `facets` and `maintenance`: the maintenance
  loop ran until `more: false` (in the seed and in the suite), and the plugin rows were timed and
  checked against the budget (§6.2).

### 1.3 Lint

- `shellcheck -x` 0.11.0 on `dev/run` (which follows every `dev/lib/*.sh`), `make-dev-ca.sh`, both
  entrypoints and `snapshot.sh`: clean.
- `actionlint` 1.7.12 on `media-manager.yml`: clean. (On the whole repo it reports one SC2034
  warning in `ci.yml`, which isn't mine and predates M1.)
- `php -l` (8.4) on every PHP file under `dev/wordpress/`: clean.
- `npx tsc -p e2e/tsconfig.json --noEmit` and Biome (`dev/run test lint`): clean.

## 2. The Author user (D26)

- `up` creates `wpu-author` (role `author`, display name "wp-upload author") with an app password
  named "wp-upload dev stack", next to `wpu-app` (Editor). `dev/wordpress/setup/users.php` replaces
  `app-user.php` and handles both in one wp-cli call.
- The Author always stays an Author (a stray role change is undone). `dev/run variant role=...`
  still switches only the app user, which the `app` container logs in as.
- Both passwords are kept while WordPress still accepts them, and checked after **every** snapshot
  restore: a snapshot holds the password hashes of when it was taken. If a password had to be
  replaced, dev/run records it, rewrites `dev/.env.wp` (dev) or recreates the `app` container (test).
- **New env** (additions, nothing renamed):
  - `dev/.env.wp` and `dev/.state/<mode>/stack.env`: `WPU_AUTHOR_USER`, `WPU_AUTHOR_APP_PASSWORD`;
  - the runner in `test` mode: `WPU_AUTHOR_USER`, `WPU_AUTHOR_APP_PASSWORD`.
- **Seed:** the Author owns 8 media items (every 25th item from the 13th that the admin owned, chosen
  by position, without the random generator) and two posts, "Author post" (published) and "Author
  draft", each using one of them as image block and featured image.

## 3. The e2e workspace

- `e2e/playwright.config.ts`:
  - projects `mock` (`baseURL` = `WPU_MOCK_URL`, specs in `e2e/mock/`) and `live` (`WPU_APP_URL`,
    `e2e/live/`), both Desktop Chrome;
  - `trace: 'off'` (pass `-- --trace on`), screenshots on failure, `retries: 0`, `forbidOnly` in CI;
  - results in `WPU_SUITE_RESULTS_DIR`: `artifacts/`, `junit.xml`, `html-report/`.
- `e2e/support/`:
  - `fixtures.ts`: the shared `test`. Any console error or uncaught page error fails a test; a spec
    allows one with `test.use({ allowedConsoleErrors: [/…/] })`. `scriptUrls` lists the JS a page
    loaded. `openQuietly(page, url)` waits for network idle;
  - `axe.ts`: `makeAxeBuilder(page, options)` and `expectNoAxeViolations(page, testInfo,
    { colorScheme })` (WCAG 2.0–2.2 A/AA tags; the results are attached as JSON);
  - `env.ts`: `stackEnv()` reads the runner env and fails clearly outside `dev/run`;
  - `session.ts`: `logIn(page)` posts `session` relative to the base URL;
  - `smoke.ts`: the shared smoke tests.
- `e2e/{mock,live}/d.spec.ts`: one smoke spec per project: the page loads under the sub-path with no
  console errors and no same-origin request outside the sub-path, and `?view=library` loads JS that
  the default view doesn't (the lazy library chunk). The live one logs in first.
- **Axe** works: run against the current scaffold (`?view=library`), it fails in both schemes on one
  `color-contrast` violation (`p[data-size="sm"]`, the dimmed "Scaffold only" text). So the smoke
  specs don't run axe yet; F3's theme should clear it.
- Chromium only: the runner trusts the dev CA in Chromium's NSS database, not in Firefox's or
  WebKit's (open question 4).

## 4. The plugin suites (D30)

**`plugin-static`** runs, in order, everything that can run, then reports what is missing:

1. `node plugin/scripts/build.mjs` in the runner; it must produce
   `plugin/dist/wp-upload-companion/wp-upload-companion.php`.
2. `php -l` on every `*.php` under `plugin/` (except `plugin/vendor/` and `node_modules/`) on PHP
   8.1 and 8.4. That includes the built file.
3. When `plugin/composer.lock` and `plugin/phpstan.neon`, `phpstan.neon.dist` or `phpstan.dist.neon`
   exist: `composer install` from `composer:2.11.2@sha256:50ea4d33…` (the same digest as
   `composer:2` on 2026-11-23) into a named volume mounted at `plugin/vendor`, then
   `php -d memory_limit=1G vendor/bin/phpstan analyse --configuration=<file>` on PHP 8.4, from
   `plugin/`. The composer cache is `dev/.cache/composer` (cached in CI by `plugin/composer.lock`).

**`plugin-contract`:**

1. Builds the plugin (so the CI integration job needs no `plugin-static`).
2. Brings the test stack up and makes sure `small` exists.
3. Resolves the oldest supported build: `WPU_PLUGIN_OLDEST_REF` (any git ref, for testing), else
   `PLUGIN_OLDEST_SUPPORTED_TAG` in `dev/lib/common.sh` (empty now), else the lowest `plugin-v*` tag.
   With none, it is the current build. A ref is exported with `git archive <ref> plugin` into
   `dev/.build/plugin-oldest/` and built with **its own** `build.mjs`.
4. Runs `cd plugin && npx vitest run --config vitest.config.ts` three times, each after restoring
   `small`, with `WPU_PLUGIN_INSTALL` and results in `test-results/plugin-contract/<install>/`:
   - `plugin`: the current build as a regular plugin;
   - `oldest`: the companion's state is removed first (as its uninstall hook would: tables
     `{prefix}wpu_*`, options `wpu_*` except `wpu_dev_*`, transients, `_wpu_*` post meta, and a
     silent deactivation; `dev/wordpress/setup/companion-uninstall.php`), then the oldest build is
     installed and activated;
   - `mu-plugin`: state removed the same way, then only the single file is copied to
     `wp-content/mu-plugins/wp-upload-companion.php`. Nothing activates it, so schema creation
     without an activation hook is exercised.
5. Restores `small` again (back on the regular install), saves logs, and fails if any run failed.

**How the build gets into WordPress (changed from M0):** test mode no longer bind-mounts
`plugin/dist/`. `dev/run` copies the build into the WordPress volume on `up`, after every restore,
and per contract run. A rebuild that replaces `plugin/dist/` left the M0 bind mount pointing at a
deleted directory; a copy is always current, and lets the suite swap builds without recreating
containers. `dev/compose.plugin-dist.yml` is gone. Dev mode still mounts `plugin/wp-upload-companion/`.

## 5. Spike X10: where Visual Portfolio 3.11.0 keeps attachment ids (dev half)

Read from the 3.11.0 source and confirmed live: each seeded post was fetched over HTTP from the
stack, and every seeded image's file name appears in the rendered page (all 4 per gallery, 8 for the
two embedding posts). So Visual Portfolio itself reads these places.

### 5.1 What the `small` seed creates (titles are stable; ids from a fresh stack)

| Title | Type | What | Images |
|---|---|---|---|
| Visual Portfolio: gallery block | post | legacy `visual-portfolio/block` | seed images 41–44 |
| Visual Portfolio: gallery loop | post | `visual-portfolio/loop` (built by the plugin's own `Visual_Portfolio_Loop_Gallery::create()` from the `gallery-grid-classic` pattern) | 61–64 |
| Saved layout: legacy images | `vp_lists` | legacy layout, `vp_images` meta | 81–84 |
| Saved layout: gallery loop | `vp_lists` | block-based layout, a loop in its content | 101–104 |
| Visual Portfolio: saved layouts (block) | post | both layouts through `visual-portfolio/saved` | — |
| Visual Portfolio: saved layouts (shortcode) | post | both layouts through `[visual_portfolio id=…]` | — |

"Seed images n" are the n-th generated images (titles end in `0nn`). `dev/run seed small` prints
the exact ids. On a fresh stack: gallery block post 250 (images 49–52), gallery loop post 251
(70–73), legacy layout 252 (91–94), loop layout 253 (112–115), the saved-block post 254, the
shortcode post 255, and Visual Portfolio's placeholder image 256.

### 5.2 The storage, exactly

1. **Legacy block** `<!-- wp:visual-portfolio/block {...} /-->` (self-closing, rendered on the
   server): attribute `images`, a list of objects
   `{"id": 49, "imgUrl": "…", "imgThumbnailUrl": "…"[, "title", "description", "url", …]}`.
   Shown only while `content_source` is `"images"`; other sources (`post-based`, `portfolio`, …)
   can leave a stale `images` array that isn't displayed.
2. **Gallery Loop** `<!-- wp:visual-portfolio/loop {...} -->…<!-- /wp:visual-portfolio/loop -->`:
   attribute `imagesQuery.images`, the same `{id, imgUrl, imgThumbnailUrl, title?, description?}`
   objects, used while `queryType` is `"images"`. The inner blocks (`item-template`, `item-image`,
   …) hold no ids. A loop can sync with a saved layout through `savedLayout.id`; it then takes the
   layout's template, **not** its images.
3. **Saved layouts** are `vp_lists` posts, in two kinds (`Visual_Portfolio_Saved_Layouts::is_block_layout()`
   tells them apart: content containing `visual-portfolio/loop`):
   - **legacy** (meta-based): settings in `vp_*` post meta; the images in `vp_images`, a
     PHP-serialized array of the same image objects (`a:4:{i:0;a:3:{s:2:"id";i:91;…`), shown while
     `vp_content_source` is `images`. The plugin's REST route `update_layout` stores `vp_images` as
     given;
   - **block-based** (the 3.x default for new layouts): no `vp_images`; the post content holds a
     Gallery Loop with `imagesQuery.images`, as in 2.
4. **Embedding a layout:**
   - the block `<!-- wp:visual-portfolio/saved {"id":"252"} /-->`; `id` is a **string**. The old
     name `nk/visual-portfolio` is still registered as an alias with the same `id` attribute;
   - the shortcode `[visual_portfolio id="252"]` (quoted or not; also `class`, `vc_css`).
     `Visual_Portfolio_Get::get()` renders a block-based layout through
     `Visual_Portfolio_Saved_Layouts::render()`, a legacy one from its meta;
   - the plugin also has `[visual_portfolio_filter id=…]` and `[visual_portfolio_sort id=…]`, which
     show no images.
5. **Visual Portfolio's own index:** on save it records, per post, the layouts it embeds in the
   non-unique meta `_vpf_saved_layout_inserted` (one row per layout id; the seeded block and
   shortcode posts both get `252` and `253`) and the layouts its loops sync with in
   `_vpf_saved_layout_synced`. Content saved before that index existed is backfilled by WP-Cron
   (`vpf_saved_layout_usage_backfill`), which the stack disables (§7). P2 could use it as a
   shortcut, but it misses page-builder meta and depends on that backfill.

### 5.3 Other things P2 should know

- **The "Portfolio" archive page:** on first run the plugin creates a page "Portfolio" (slug
  `portfolio`) with a legacy block, `content_source: "post-based"`. It shows posts, not images, so the
  parser must not count it.
- **The placeholder image:** on the first front-end or wp-admin request the plugin copies
  `placeholder.png` into `uploads/visual-portfolio/` and inserts it as an **attachment**, stored in
  the option `vp_general['no_image']`. Every site with Visual Portfolio has it; it is the plugin's
  "no image" fallback, so arguably a usage. The seeds trigger it at a fixed point (§7), so `small`
  has **212** media items now (M0: 211).
- **Image entries without `id`** (external `imgUrl` only) can occur; the contract already says to
  ignore them.
- Visual Portfolio 3.11.0 needs **PHP 8.3** (`Requires PHP: 8.3`). The stack runs 8.3, so it works
  here; on 8.1/8.2 sites it won't load at all, so the feature simply stays inactive there.
- Visual Portfolio Pro carries its own copy of this core (the free plugin's main file says so and
  steps aside when Pro is active), and adds sources such as taxonomies and social feeds. The image
  storage above should be the same there, but that is unverified (no Pro copy).

## 6. Spike X4: the `large` seed and `perf` (dev half)

### 6.1 The `large` seed (`dev/wordpress/seed/large.php`)

- Its own generator (`Mt19937(20261123)`), fixed dates, explicit row ids.
- **36 real files:** 32 GD images (8 aspect ratios, long edges 800/1200/1600, JPEG/PNG/WebP), plus
  the mp4, mp3, pdf and svg fixtures, inserted as normal attachments with sub-sizes.
- **49 964 synthetic attachments** inserted with multi-row SQL, each copying one real file's
  `_wp_attached_file` and `_wp_attachment_metadata`. Mix: 27 390 JPEG, 8 365 WebP, 8 319 PNG,
  2 010 mp4, 1 950 PDF, 1 455 mp3, 511 SVG. Dates spread from 2018-12 to 2026-06 (91 months). About
  60 % of images have alt text, 20 % captions, 10 % descriptions; 15 % are attached to a post;
  owners: 93 % admin, 5 % the app user, 2 % the Author.
- **300 FileBird folders** (20 top-level, up to four levels, repeated names under different
  parents) through `Folder::newFolder()`; **35 068 assignments (70.1 %)** through
  `Folder::setFoldersForPosts()`, so FileBird's hooks fire (D17). Folder sizes are skewed: 2 019
  items in the biggest, 44 in the smallest. 14 932 seeded items are Uncategorized (14 933 with
  Visual Portfolio's placeholder image, which the seed also triggers, §7).
- **5 000 posts and pages** (10 % pages) with SQL: image blocks (1–3), galleries (10 %), classic
  `wp-image-N` (5 %), featured images (2 987), 92 % published, 5 % drafts, 3 % private.
- When the companion plugin is active, the seed then calls its `POST /maintenance/step`
  (`budgetMs` 20 000) through `rest_do_request()` until `more` is false, so the snapshot holds a
  complete index. P1's scaffold answers 501 today; the seed warns and continues.
- The synthetic rows share files: **never run a file-changing suite on `large`.**
- Runs in about 75–100 s; `reset large` takes about 10 s. The wp-cli call gets
  `memory_limit=1G`.

### 6.2 `dev/run test perf` (`dev/perf/measure.mjs`, `dev/wordpress/perf/filebird-queries.php`)

- Builds the plugin (if `build.mjs` exists), restores `large`, installs the build.
- **In-process FileBird baseline** (wp-cli, no HTTP): FileBird filters media lists only through its
  `fbv` WP_Query variable, and core REST `/wp/v2/media` never sets it (`?fbv=0` there is ignored;
  checked: `X-WP-Total` stays 50 000). So its Uncategorized and folder queries are timed in-process.
- **Over HTTP** (the runner, through the TLS proxy, with the app user's app password): 2 warm-ups,
  then 20 sequential timed runs per request. With the plugin (`/info` lists `collection`): its
  maintenance runs until done, then `/collection`, `/collection?folder=0`, `/facets`,
  `/facets?folder=0` (all four budgeted: p95 ≤ 300 ms), plus one folder and a search (reported
  only). Always: core `/wp/v2/media?per_page=100`, a core search, and FileBird's
  `/filebird/v1/get-folders` (tree plus its per-folder counts).
- The suite **fails** when a budgeted p95 is over 300 ms or the `/collection` payload is over
  250 kB gzip; the baseline never fails it. Reports: `test-results/perf/perf.md`, `perf.json`,
  `filebird-in-process.json`. `WPU_PERF_RUNS` changes the run count.

**Baseline numbers** (this machine, the `large` seed on a clean test stack, no companion plugin
yet):

| Request | p50 ms | p95 ms | max ms | Notes |
|---|---|---|---|---|
| core `GET /wp/v2/media?per_page=100` | 192.4 | 202.0 | 214.4 | `X-WP-Total` 50 001, 26 kB gzip |
| core `GET /wp/v2/media?per_page=100&search=harbour` | 977.0 | 1215.2 | 1215.2 | 2 447 matches |
| FileBird `GET /filebird/v1/get-folders` (tree + counts) | 81.7 | 88.1 | 88.4 | 300 folders |
| in-process: WP_Query media list (all, 100, with count) | 20.0 | 20.9 | 21.2 | |
| in-process: FileBird Uncategorized (`fbv=0`, 100) | 44.4 | 49.4 | 54.7 | 14 933 items |
| in-process: FileBird one folder (`fbv=1`, 100) | 3.8 | 4.1 | 4.2 | 2 019 items |
| in-process: FileBird `Tree::getCount(-1)` | 13.8 | 14.3 | 18.4 | |
| in-process: FileBird `Folder::countAttachments()` | 44.1 | 49.6 | 51.5 | all 300 folders |

(50 001 attachments: the seed's 50 000 plus Visual Portfolio's placeholder.)

Against plan §9: the plugin routes can't be measured until P1's `collection` and `facets` exist.
What the baseline says:

- a page of 100 through core REST costs about 190–210 ms p50, almost all of it REST's per-item
  preparation (the same WP_Query returning ids takes about 20 ms);
- FileBird's own Uncategorized query (`NOT IN` over a `GROUP BY … HAVING FIND_IN_SET` subquery)
  takes about 45–50 ms p50 and 50–70 ms p95 for a page of 100 at 50k (three runs); its per-folder
  counts about 45–50 ms; the one-folder query about 4 ms;
- a core search with `LIKE` over 50k rows takes about 1 s (p50 0.98–1.1 s);
- a stand-in plugin route that selects all 50 000 ids in order and returns `[id, w, h, kind]` rows
  took about 75 ms p50 / 86 ms p95, with a 123 kB gzip payload. That is only a lower bound for P1's
  real query (no visibility rules, no index join), but it leaves room in the 300 ms and 250 kB
  budgets.

P1 owns the X4 note (`spikes/X4.md`); these are its dev-side inputs.

## 7. Determinism fixes found on the way

- **WP-Cron is disabled** (`DISABLE_WP_CRON`, in `wp-config-extra.php`). Requests spawned cron in the
  background: `do_pings`/`do_enclose` sent HEAD requests for every URL in new posts (including
  broken ones parsed out of Visual Portfolio's JSON attributes), which can add `enclosure` meta at a
  random moment, and scheduled jobs such as update checks could run at any time. The companion
  plugin doesn't use WP-Cron (contract §5.21). A test that needs it runs
  `dev/run wp cron event run --due-now`.
- **Visual Portfolio's lazy first run** (archive page, migrations, placeholder attachment) happened
  on whichever front-end request came first, dated "now", and changed the media count mid-test. The
  seeds now run it at their end and give the archive page, its revision and the placeholder fixed
  dates (`wpu_dev_finish_visual_portfolio_setup()` in the dev mu-plugin).
- **The block theme's fallback navigation** (`wp_navigation` post) was created by the installer's
  pretty-permalink loopback in test mode only, so dev and test had different post ids. `site.php`
  now creates it in both modes with a fixed date. Verified: the test and dev `small` seeds have the
  same ids.
- **The dev mu-plugin** is loaded through a loader file that `dev/wordpress/entrypoint.sh` writes
  (`require '/opt/wpu/mu-plugins/wpu-dev.php'`), not a single-file bind mount: after an editor or
  `sed -i` replaced the file, the running container kept serving the old one.
- **"Is the stack running"** ignores one-off containers (`com.docker.compose.oneoff=False`): a
  runner still exiting made a stopped stack look running, so a suite skipped `up` and failed.

## 8. Interface changes (breaking, per the coordination rule)

None of the M0 command names, env var names or output paths changed. These behave differently:

1. **Test mode installs the plugin by copying** (§4). After rebuilding the plugin by hand, run
   `dev/run reset` (or any suite) to install the new build; suites do it themselves.
2. **`plugin-contract` runs Vitest from `plugin/`** (`cd plugin && npx vitest run --config
   vitest.config.ts`), like `server-live` runs from `server/`. M0 ran it from the repo root, where
   the config's `include` paths resolved against the root. P1: write `include` relative to `plugin/`.
3. **Seed ids moved:** the base now holds Visual Portfolio's "Portfolio" page and revision and the
   navigation post, and `small` adds the Author posts, the Visual Portfolio posts and layouts, and
   the placeholder image (212 media items). Stacks created before this branch keep their old `base`
   snapshot: run `dev/run down --volumes` and `dev/run up <mode>` to get the new ids. Tests should
   find seeded items by title or slug rather than by id.
4. **WP-Cron is off** (§7).

## 9. Change requests

**CR-1 `e2e/package.json`** (orchestrator): the `typecheck` script the brief asked for, so
`dev/run test typecheck` (`npm run typecheck --workspaces --if-present`) covers the e2e workspace,
and `@types/node`, which `e2e/tsconfig.json` uses and which only resolves today because the server
workspace hoists it.

```diff
   "scripts": {
-    "test": "playwright test"
+    "test": "playwright test",
+    "typecheck": "tsc -p tsconfig.json"
   },
   "devDependencies": {
     "@axe-core/playwright": "^4.14.0",
-    "@playwright/test": "1.65.1"
+    "@playwright/test": "1.65.1",
+    "@types/node": "^24.0.0"
   }
```

(Plus the matching `package-lock.json` update from `npm install`.) Validated: `npx tsc -p
e2e/tsconfig.json --noEmit` passes in the runner.

**CR-2 root `.gitignore`** (orchestrator): `dev/run` keeps PHPStan's vendor directory in a named
volume and leaves `plugin/vendor/` an empty directory on the host, but anyone running composer on
the host would get an untracked `plugin/vendor/`.

```diff
 plugin/dist/
+plugin/vendor/
```

**Requests to P1** (not file changes; for P1's own files):

- `plugin/phpstan.neon.dist` (or `phpstan.neon`) next to `composer.json`; PHPStan runs from
  `plugin/` and finds it there.
- `plugin/vitest.config.ts`: `include` relative to `plugin/` (§8.2). Tests can read
  `WPU_PLUGIN_INSTALL` (`plugin`, `oldest`, `mu-plugin`). The `oldest` and `mu-plugin` runs start
  with no plugin tables or options, so the index is `building` until maintenance runs; a global setup
  that calls `POST /maintenance/step` until `more` is false (as the large seed does) keeps tests
  independent of that.
- `build.mjs` should resolve paths from its own location (`import.meta.dirname`): the oldest-build
  run executes a tag's `build.mjs` from `dev/.build/plugin-oldest/plugin/scripts/`.

## 10. Still missing, and why

| Item | Status |
|---|---|
| `plugin-static` build and PHPStan, `plugin-contract` | Wired and verified with stand-ins; "not available yet" until P1 adds `build.mjs`, `vitest.config.ts`, `composer.json`/`.lock` and the PHPStan config |
| `perf` against the plugin | Baseline only until P1's `collection`/`facets` (and `maintenance`) exist; the budget check is verified with a stand-in |
| `server-live` | Unchanged: needs S1's `server/vitest.live.config.ts` |
| Axe in the smoke specs | The scaffold has a contrast violation (§3); add it once F3's theme lands |
| Firefox and WebKit projects | Not added (open question 4) |
| The workflow on GitHub | Never run (no push allowed); actionlint passes |

## 11. Open questions

1. **The oldest supported plugin build.** `PLUGIN_OLDEST_SUPPORTED_TAG` (empty: the lowest
   `plugin-v*` tag) has to be raised by hand when the server raises `minMinor`. Should dev/run
   derive it from the server's `PLUGIN_API_REQUIRED` once S1 adds it (for example the oldest tag
   whose `WPU_API` meets it)?
2. **The Visual Portfolio placeholder** is an attachment the plugin owns and uses as its "no image"
   fallback. Should the usage index report it as used by Visual Portfolio (P2)?
3. **Visual Portfolio's own layout index** (`_vpf_saved_layout_inserted`/`_synced`): use it as a
   shortcut, or always parse content (P2, X10)?
4. **Other browsers.** F1's spike C2 wants Firefox and WebKit. That needs the dev CA in their trust
   stores inside the runner (Firefox: a policy file or profile `cert9.db`; WebKit: the system store,
   which needs root at image build). Worth adding to the runner image now, or only if C2 needs it?
5. **`perf` on CI hardware.** GitHub-hosted runners are slower than this machine; should the 300 ms
   budget apply as-is in the `[perf]` CI job, or only to local runs on a reference machine?
