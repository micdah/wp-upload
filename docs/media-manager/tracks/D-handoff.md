# Track D (dev/test environment): M0 handoff

Branch `mm/d`, from `feature/media-manager` @ c1e5e0b. Scope: implementation plan §5 (dev and
test environments) and §6 (feature-branch CI). Everything lives in `dev/**` and
`.github/workflows/media-manager.yml`.

## 1. What works

All commands run from the repo root. The host needs Docker with the compose plugin, and nothing
else.

| Command | What it does | Verified |
|---|---|---|
| `dev/run up dev` | Starts `db` + `wordpress` for this worktree, installs WordPress, FileBird Lite 6.5.9 (zip checksum checked), the app user `wpu-app` (Editor) with an Application Password, takes the `base` snapshot, writes `dev/.env.wp`. Idempotent: it keeps the ports, the install and a still-valid app password | Yes, about 20 s once images are pulled |
| `dev/run seed small` | Restores `base`, runs the deterministic seed, snapshots **DB and uploads** as `small` | Yes, about 50 s. Two runs give identical row and file checksums |
| `dev/run reset [small]` | Restores DB and uploads from the snapshot (default `small`), re-activates the companion plugin if present, prints the variants | Yes, under 4 s |
| `dev/run variant trash=on\|off filebird=on\|off peruser=on\|off role=editor\|author` | Flips variants without restarts. Without arguments, prints them | Yes, each one, and reverting |
| `dev/run up test` | Dev CA, `db` + `wordpress` + TLS `proxy`, WordPress at `https://wp.wpu.test`, then builds the **production image** from the repo's `Dockerfile` and serves it under `/wp-upload/` | Yes, about 40 s with a warm build cache |
| `dev/run test lint\|typecheck\|unit` | Runs in `runner` (Playwright 1.65.1 image + Node 24), as the host user, `npm ci` into a named volume when the lockfile changes | Yes, all pass |
| `dev/run test all` | Runs every gate suite, even after failures, then prints passed / failed / not available. Fails if any suite failed **or isn't available yet** | Yes: lint, typecheck and unit pass; five suites are "not available yet" |
| `dev/run test <other suite>` | Prints `not available yet: <reason>` and exits with status 3 | Yes |
| `dev/run seed large` | `not available yet` (M1, spike X4), exit 3 | Yes |
| `dev/run logs [compose args]` | No arguments: saves compose logs and WordPress `debug.log` to `test-results/logs/` and shows the tail. With arguments: `docker compose logs <args>` | Yes |
| `dev/run down [--volumes]` | Stops both modes' stacks. `--volumes` also deletes their DB, uploads, snapshots, credentials, CA and `dev/.env.wp` | Yes |
| `dev/run info` | Prints this worktree's project names, port blocks and URLs, without starting anything | Yes |
| `dev/run wp <args>` | Any wp-cli command against the active stack (for example `dev/run wp plugin list`) | Yes |

`seed`, `reset`, `variant`, `logs` and `wp` act on the mode of the last `up`. Override with
`WPU_MODE=dev|test`. `dev/run test ...` always uses the `test` project, and the live suites
bring the stack up and seed it if needed.

### Verification results (this worktree, from a clean state)

- `curl -u wpu-app:<app password> $WP_URL/wp-json/wp/v2/users/me?context=edit` → `roles: ['editor']`.
- `/wp-json/wp/v2/media` → `X-WP-Total: 211` (200 images + 11 fixtures). It is the same over TLS in
  `test` mode, with `https://wp.wpu.test/...` source URLs.
- `dev/run wp plugin list` → `filebird 6.5.9 active`. `wp_fbv` holds the 15 folders (three
  levels deep), and 160 of the 211 items are assigned.
- Posts: 21 published posts, 2 drafts, 1 private, 1 pending, and 5 pages. Usage contexts in
  content: image block 15, gallery 9 (nested) + 1 (legacy `ids`), file 10, cover 10,
  media-text 10, classic `wp-image-N` 5, `[gallery]` 3, video 1, audio 1, featured images 23,
  plus the site logo and site icon. 30 attachments are attached (`post_parent`), and 20 are
  owned by the app user.
- Variants, through REST and wp-cli:
  - `role=author` → `users/me` roles `['author']`;
  - `trash=on` → `DELETE /wp/v2/media/10` without `force` trashes it (HTTP 200). With
    `trash=off` it returns `rest_trash_not_supported`;
  - `filebird=off` → the `filebird/v1` namespace disappears and `wp plugin list` shows it
    inactive;
  - `peruser=on` → `get_option('njt_fbv_folder_per_user')` is `1`;
  - all of them revert.
- Reset: trash an item via REST, retitle one, delete one with its files (`--force`), add a
  stray file, flip variants, then run `dev/run reset`. All rows, the deleted file and the
  uploads checksum come back (`9eb5cad1…`), the stray file is gone, and the variants are back
  to the defaults.
- Isolation:
  - A copy of `dev/` at a second checkout path (`/tmp/wpu-second`) derived project
    `wpu-wpu-second-3ae8f9ef44-dev` and preferred block 21260. With port 21261 occupied, `up`
    fell back to block 21280.
  - It ran in parallel with this worktree's stack (`wpu-agent-a177c366ab-77f0305832-dev`,
    port 22420), and its own fake `plugin/wp-upload-companion/` was mounted, activated and
    served `wp-upload/v1/info`.
  - `WPU_WORKTREE_PATH=... dev/run info` shows the derivation for any path.
- `test` mode, from the host through the proxy (`curl --cacert dev/.state/test/ca/public/ca.crt
  --resolve wpu.test:<port>:127.0.0.1`):
  - `/wp-upload/healthz` 200, `/wp-upload/` 200, `/wp-upload/api/status` 401;
  - login at `/wp-upload/session` 200, then `/api/status` returns `connected: true` against
    `https://wp.wpu.test`. This shows the app trusts the CA through `NODE_EXTRA_CA_CERTS`;
  - without `--cacert`, curl fails with exit 60: nothing outside the stack trusts the CA.
- WordPress loopback in `test` mode: `wp_remote_get('https://wp.wpu.test/wp-json/')` returns 200,
  and Site Health's loopback check reports "good".
- Runner, as uid 1000 with `HOME=/home/runner`, Node v24.22.3:
  - Node `fetch` to the app and to WordPress returns 200, and so does curl;
  - headless Chromium loads `https://wpu.test/wp-upload/` (title "WP Media Uploader");
  - with an empty NSS database it fails with `net_error -202` (`ERR_CERT_AUTHORITY_INVALID`).
- `php81` / `php84` one-off services run as the host user (8.1.34, 8.4.28).
- `shellcheck -x` (0.11.0, in a container) on `dev/run`, which follows every `dev/lib/*.sh`, plus
  `make-dev-ca.sh`, both entrypoints and `snapshot.sh`: clean. `actionlint` on the workflow:
  clean. `npx biome check dev .github` (in the runner): clean. `dev/run test lint` (`biome ci .`)
  passes with the workflow included.
- The change requests in §5 were validated in a scratch copy of the repo against the running dev
  stack:
  - `npm run dev` started the server on the worktree's port (22421) and Vite on 22422;
  - logging in through Vite and calling `/api/status` returned `connected: true`;
  - `npm run typecheck -w client` and Biome passed.

## 2. Image tags and digests

Tags were checked with `docker buildx imagetools inspect` on 2026-11-22. Patch-level tags are
used, so the digest and the tag tell the same story.

| Service | Image |
|---|---|
| `db` | `mariadb:11.4.13@sha256:a8992b5e5404d11e03c54a31d0c1bdea3fd116d283aa6d1a627551f29045309b` (same digest as `mariadb:11.4`) |
| `wordpress` | `wordpress:7.1.5-php8.3-apache@sha256:2e5145737f46b8fd53f333a05eb3a4f21321c90e20475b7827082dd5f75b62b0` (PHP 8.3.37). WordPress 7.1 exists, and 7.1.5 is the newest patch; there is no 7.1.6 or 7.2 yet. The moving `7.1-php8.3-apache` tag has the same build date but a different index digest, so the patch tag is pinned |
| `wpcli`, `ca` | `wordpress:cli-2.12.0-php8.3@sha256:14ad78160eba4c1ee30b33f9edeb44341c0de28a051fc472ee60136c775f0f0f` (WP-CLI 2.12.0, PHP 8.3.37; same digest as `cli` and `cli-php8.3`). It includes gd, imagick, the mariadb client and openssl |
| `proxy` | `nginx:1.30.7-alpine@sha256:caf4e1e032a20f9c3c5e28fc7f25ffd768ad8677b4975c54193075997b3a97e3` (the current stable line) |
| `php81` | `php:8.1.34-cli@sha256:76e563191d1ade120313a8736df24154d21da5155c0756f147c0b01bd19d9087` |
| `php84` | `php:8.4.28-cli@sha256:6b13a8678b38ca38e4e3950be57b664ed8c8706131a0586111f68792aede4c58` |
| `runner` base | `mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579` (latest `@playwright/test` is 1.65.1). The image ships Node 26, so the runner copies Node 24 in from `node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54` |
| `app` | Built from the repo's `Dockerfile` as `wpu-app:<project>` |
| FileBird Lite | `https://downloads.wordpress.org/plugin/filebird.6.5.9.zip`, sha256 `a4192f265a396ce28610f796d347cea0f50b3069c889d4269d1a97f374d07cc2`, cached in `dev/.cache/downloads/` |

**Where the pins live:**
- **Compose images:** `dev/compose.yml` and `dev/compose.test.yml`.
- **`dev/lib/common.sh`:** the Playwright, Node, FileBird and WordPress version pins
  (`EXPECTED_WORDPRESS_VERSION`; `up` warns when the installed core differs).
- **WordPress core:** it lives in a volume, so after bumping the image run
  `dev/run down --volumes` and `dev/run up`.

The workflow pins actions by commit SHA:
- `actions/checkout` v7.0.1;
- `actions/cache` v6.1.0;
- `actions/upload-artifact` v7.0.2;
- `docker/setup-buildx-action` v4.4.1;
- `crazy-max/ghaction-github-runtime` v4.0.0.

## 3. Project names and ports

- **Identity path:** the worktree root, or `WPU_WORKTREE_PATH` to override it (to test the
  derivation, or to keep an identity after moving a checkout). The hash is the first 10 hex
  characters of `sha256(path)`.
- **Project:** `wpu-<slug>-<hash>-<mode>`. The slug is the directory name in lowercase with
  non-alphanumeric characters as `-`, cut to 16 characters. Example:
  `wpu-agent-a177c366ab-77f0305832-dev`. **One project per mode**, so each mode has its own
  volumes (`db_data`, `wp_html`, `wp_uploads`, `snapshots`, `runner_node_modules`), and both
  modes of one worktree can run at once.
- **Ports:**
  - The range is 20000–27999: 400 blocks of 20.
  - The preferred block is `int(hash[0:8], 16) mod 400`.
  - `dev` uses offset +0 (WordPress), +1 (host server) and +2 (Vite). `test` uses +10 (the
    proxy, for debugging only).
  - `up` keeps the recorded block while the stack runs or while its port is free. Otherwise it
    walks to the next block where all of the mode's ports are free, and records the block at
    once.
  - Everything binds to `127.0.0.1` (override with `WPU_BIND_ADDRESS`).
- **The WordPress URL is set from the environment** (`WP_HOME`/`WP_SITEURL` in
  `dev/wordpress/wp-config-extra.php`), so a moved port block doesn't break snapshots. Seeded post
  content contains absolute image URLs, which would then point at the old port. That is
  cosmetic; usage detection keys on ids.
- **State:**
  - `dev/.state/<mode>/stack.env`: the project, block, site URL and app password; state of a
    different identity is ignored;
  - `dev/.state/active-mode`;
  - `dev/.state/test/ca/`;
  - `dev/.env.wp` (dev only). It is read by the host server and Vite once the change requests
    land. It holds `WP_URL`, `WP_USERNAME`, `WP_APP_PASSWORD`, `AUTH_USERNAME=dev`,
    `AUTH_PASSWORD=dev-password`, `PORT`, `WPU_VITE_PORT`, `WPU_API_TARGET`, and the wp-admin
    URL and login (`admin`/`admin`).

## 4. How the pieces are built

- **`dev/compose.yml`** holds `db`, `wordpress`, `wpcli` (and `ca`), `runner`, `php81` and
  `php84`. Overrides:
  - `compose.dev.yml`: the host port;
  - `compose.test.yml`: `proxy`, `app`, and the CA mounts and env;
  - `compose.plugin-source.yml`: dev mode, added only when `plugin/wp-upload-companion/` exists;
  - `compose.plugin-dist.yml`: test mode, added only when `plugin/dist/wp-upload-companion/`
    exists;
  - `compose.ci.yml`: only when `CI=true`; buildx `type=gha` cache for `runner` and `app`.
- **`dev/wordpress/`:**
  - `wp-config-extra.php`: site URL, `WP_ENVIRONMENT_TYPE=local`, debug log, no auto-updates,
    `MEDIA_TRASH`;
  - `entrypoint.sh`: hands mount-point directories to www-data;
  - `mu-plugins/wpu-dev.php`: the variants and the `wp wpu-dev variant` command;
  - `setup/`: site baseline and app user;
  - `seed/small.php`;
  - `snapshot.sh`.
- **Seed:**
  - `\Random\Randomizer(new Mt19937(20261122))`, so nothing else in WordPress can shift the
    sequence. Media dates run every ~3.3 days from 2024-01-03; posts run every 23 days from
    2024-02-01; `post_modified` is reset to `post_date`.
  - Images are made with GD, then sub-sizes are generated by WordPress (imagick) in the wp-cli
    container. The mix is JPEG / PNG with alpha / WebP / GIF, 12 aspect ratios, and long edges
    from 640 to 1920. It includes:
    - two images above the 2560 px threshold, which get `-scaled` originals;
    - one 120 px image;
    - repeated `img-0001` names;
    - Danish characters in titles;
    - about 60 % alt text, 30 % captions and 20 % descriptions.
  - Folders are created with `\FileBird\Model\Folder::newFolder()` and filled with
    `Folder::setFoldersForPosts()`, so FileBird's hooks fire (D17).
  - SVG uploads are allowed only during the seed (an `upload_mimes` filter).
- **Fixtures** (`dev/fixtures/`, 0.3–11 KB):
  - `sample.svg` is hand-written. `sample.pdf` is a hand-built one-page PDF.
  - `sample.mp4` (2 s 320×180 H.264) and `sample.mp3` (2 s sine) were generated once with
    ffmpeg in an Alpine container (`apk add ffmpeg`;
    `ffmpeg -f lavfi -i testsrc2=size=320x180:rate=10 -t 2 -pix_fmt yuv420p -c:v libx264 -crf 38 ...`
    and `-f lavfi -i sine=frequency=440:duration=2 -c:a libmp3lame -b:a 24k`).
- **Snapshots:**
  - They live in each stack's `snapshots` volume: `base` (taken by `up`), `small` (taken by
    `seed small`).
  - Each holds `db.sql` (`wp db export`) and `uploads.tar`.
  - Restore runs `wp db reset` first, so tables created after the snapshot don't survive, then
    empties and refills the uploads volume.
- **`test` mode:**
  - Hostnames inside the stack: `wpu.test` and `wp.wpu.test` (network aliases of `proxy`).
  - Proxy routes:
    - `/wp-upload/` → `app:3001`, prefix stripped;
    - `/wp-upload-mock/` → static files from `dev/.build/mock-dist/` (404 until a mock build
      exists);
    - `wp.wpu.test` → `wordpress:80` with `X-Forwarded-Proto: https`;
    - port 80 redirects to HTTPS.
  - Upstreams resolve per request, so the proxy starts without `app`. Body size is unlimited and
    timeouts are 600 s, for WordPress's slow image processing.
  - The CA is made by `dev/lib/make-dev-ca.sh` in the `ca` one-off (openssl from the wp-cli
    image), as the host user. Its layout: `private/ca.key` (mounted nowhere), `public/ca.crt` and
    `public/bundle.pem` (Mozilla roots plus the CA), and `proxy/server.{crt,key}` (SANs `wpu.test`,
    `wp.wpu.test`, `localhost`).
  - Trust:
    - `app`: `NODE_EXTRA_CA_CERTS`;
    - WordPress: an `http_request_args` filter sets `sslcertificates` to `bundle.pem`;
    - `runner`: its entrypoint adds the CA to Chromium's NSS database (`certutil`) and builds
      `$HOME/ca-bundle.pem` for `SSL_CERT_FILE` / `GIT_SSL_CAINFO`; Node gets
      `NODE_EXTRA_CA_CERTS`.
  - `app` gets `AUTH_USERNAME=dev`/`dev-password`, a fixed `SESSION_SECRET`, `TRUST_PROXY=1` and
    the app password. Its healthcheck uses `/nodejs/bin/node`, because the image is distroless.
- **`runner`:**
  - Runs with `--user $(id -u):$(id -g)`, a tmpfs `HOME` (mode 1777), and `TZ=UTC` and
    `LANG/LC_ALL=C.UTF-8`.
  - The repo is mounted at its **host path**, and the git common dir is mounted read-only, so
    git works in worktrees.
  - `node_modules` is a named volume, chowned to the host user. `npm_config_cache` is
    `dev/.cache/npm`, bind-mounted.
  - `npm ci` runs only when the lockfile hash changes. `HUSKY=0`.
  - `dev/run` fails early when `e2e/package.json` pins a different `@playwright/test` than the
    image.
- **Workflow** (`.github/workflows/media-manager.yml`):
  - Trigger: push and `pull_request` to `feature/media-manager`.
  - `permissions: contents: read`, and cancel-in-progress concurrency.
  - Checkout uses `fetch-depth: 0`. `actions/cache` keeps `dev/.cache/npm`.
    `setup-buildx-action` and `ghaction-github-runtime` serve the gha cache.
  - Jobs: `static`, `integration` (`WPU_MODE=test`; `up test`, `seed small`, the four live
    suites, `logs`, artifact upload, `down --volumes`) and `perf` (push only, with `[perf]` in
    the head commit message).
  - Every suite step runs even when an earlier suite failed (`!cancelled()`), and the live suites
    are skipped when `up`/`seed` failed.
  - The version-bump base is `github.event.before` on push and the PR base SHA on pull requests;
    `dev/run` maps an empty or all-zero base to `merge-base HEAD origin/master`.

## 5. Change requests for orchestrator-owned files

All of them were validated in a scratch copy (see §1).

**CR-1 `server/package.json`:** the host server reads `dev/.env.wp` in dev mode. Its values win
over `server/.env`, because dotenv never overrides variables that are already set. No change to
`server/src/config/env.ts` is needed.

```diff
-    "dev": "node --watch src/index.ts",
+    "dev": "node --env-file-if-exists=../dev/.env.wp --watch src/index.ts",
```

**CR-2 `client/vite.config.ts`:** the per-worktree Vite port and proxy target from
`dev/.env.wp`. It typechecks with the current client tsconfig, because Vite's types pull in
Node's.

```diff
+import { fileURLToPath } from 'node:url'
 import react from '@vitejs/plugin-react'
-import { defineConfig } from 'vite'
+import { defineConfig, loadEnv } from 'vite'
+
+// `dev/run up dev` writes dev/.env.wp with this worktree's ports. Vite reads `.env.[mode]`
+// files, so loading mode "wp" from dev/ picks it up; without the file the defaults apply.
+const devStackEnv = loadEnv(
+  'wp',
+  fileURLToPath(new URL('../dev', import.meta.url)),
+  'WPU_',
+)
+const apiTarget = devStackEnv.WPU_API_TARGET || 'http://localhost:3001'
+const vitePort = Number(devStackEnv.WPU_VITE_PORT) || undefined

 export default defineConfig({
   // Relative asset URLs so the built app works at `/` and under any sub-path
@@
   plugins: [react()],
   server: {
     host: true,
+    port: vitePort,
+    // A worktree's port is fixed in dev/.env.wp; never drift to another one.
+    strictPort: vitePort !== undefined,
     proxy: {
-      '/api': 'http://localhost:3001',
+      '/api': apiTarget,
       // Login/logout live at the app root, not under /api - see
       // server/src/lib/session.ts for why.
-      '/session': 'http://localhost:3001',
+      '/session': apiTarget,
     },
   },
 })
```

**CR-3 root `.gitignore`:** Playwright output. Today only `*.log` hides the files in
`test-results/`. `dev/.env.wp` and the other generated dev files are already covered by
`dev/.gitignore`.

```diff
+# dev/run test output (plan §5.2)
+test-results/
```

**CR-4 `.dockerignore`:** keep the dev stack's state (including the dev CA key), caches,
snapshots and test output out of the build context of the `app` image. The current Dockerfile
copies only `server/` and `client/`, so nothing reaches the image today, but the context still
carries them.

```diff
+dev
+test-results
```

(If a later Dockerfile stage needs something from `dev/`, narrow this to `dev/.state`,
`dev/.cache` and `dev/.build`.)

**CR-5 the `e2e/` workspace (M0, orchestrator):**
- Add `"e2e"` to the root `workspaces`.
- `e2e/package.json` must pin `"@playwright/test": "1.65.1"` **exactly**, plus
  `@axe-core/playwright`. `dev/run` refuses a different or ranged pin until
  `PLAYWRIGHT_VERSION`/`PLAYWRIGHT_IMAGE` in `dev/lib/common.sh` are bumped (tag and digest).
- Playwright's browsers come from the image (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`), so
  nothing downloads browsers.
- Give it a `typecheck` script: `dev/run test typecheck` runs
  `npm run typecheck --workspaces --if-present`.

**CR-6 the mock build location (for F2 and e2e-mock):** the `VITE_MOCK` build that `e2e-mock`
drives should be written to `dev/.build/mock-dist/`. The proxy serves that directory under
`/wp-upload-mock/`, and it is gitignored. For example:
`VITE_MOCK=1 npx vite build --outDir ../dev/.build/mock-dist --emptyOutDir` from `client/`. Copy
MSW's worker there only, never into `client/public`.

**Contracts that other tracks should follow** (these are not change requests):
- **The built plugin (P1):** `test` mode mounts `plugin/dist/wp-upload-companion/` (a directory
  that contains the single-file plugin) as a regular plugin. If P1's build output differs, tell
  track D, or adjust `dev/compose.plugin-dist.yml`.
- **Live server tests (S1):** `server/vitest.live.config.ts`, run from `server/`.
- **Contract tests (P1):** `plugin/vitest.config.ts`.
- **The plugin build (P1):** `plugin/scripts/build.mjs`.
- **The version check (orchestrator):** `plugin/scripts/check-version-bump.mjs --base <sha>`.
- **The runner's env in `test` mode:** `WPU_APP_URL`, `WPU_MOCK_URL`, `WPU_WP_URL`,
  `WPU_APP_USER`, `WPU_APP_PASSWORD`, `WPU_ADMIN_USER`, `WPU_ADMIN_PASSWORD`,
  `WPU_LOGIN_USER`, `WPU_LOGIN_PASSWORD` and `WPU_SUITE_RESULTS_DIR`.

## 6. Still missing, and why

| Item | Status | Why or next step |
|---|---|---|
| `plugin-static` | Not available (exit 3) | No `plugin/wp-upload-companion/` yet. `php -l` on PHP 8.1 and 8.4 is implemented and verified against a fake plugin. **PHPStan** needs a composer step (pin a `composer` image or a checksummed phar) once P1 adds `plugin/composer.lock`. The zip build waits for `plugin/scripts/build.mjs` |
| `plugin-contract` | Not available | Needs P1's `plugin/vitest.config.ts`, contract tests and dist. The plan's runs against the oldest supported build (git tag `plugin-v<min>`) and in `mu-plugins/` aren't wired yet: they need P1's dist file name |
| `server-live` | Not available | Needs S1's `server/vitest.live.config.ts` |
| `e2e-mock`, `e2e-live` | Not available | Needs the `e2e/` workspace (CR-5), the mock build (CR-6) and Playwright projects; D writes those after the workspace lands |
| `perf`, `seed large` | Not available | M1 (50k rows, 300 folders, 5k posts; spike X4) |
| `version-bump` | Not available | Needs `plugin/scripts/check-version-bump.mjs`. Base resolution is in place |
| The CI gha cache | Untested | `type=gha` needs a GitHub-hosted run. Locally, `compose config` with `CI=true` shows the cache options merged |
| The workflow on GitHub | Never run | No push allowed. actionlint passes |
| "A lazy chunk loads under `/wp-upload/` in test mode" (Checkpoint 4) | Infrastructure ready | The production image is served under `/wp-upload/` today; the check needs the scaffold and e2e |

## 7. Deviations from plan §5/§6

1. **MEDIA_TRASH** is defined in `dev/wordpress/wp-config-extra.php` (one small query of the
   variant option per request), not in the mu-plugin. WordPress 7.1 defines `MEDIA_TRASH` in
   `wp_initial_constants()`, before mu-plugins load, so a mu-plugin can't set it.
2. **"FileBird off"** filters `active_plugins` in the mu-plugin instead of deactivating the
   plugin. That is instant, fires no deactivation hooks, and never writes FileBird's own options
   (D17). A guard re-adds FileBird if another activation saves the filtered list. **Per-user
   mode** is answered through `pre_option_njt_fbv_folder_per_user`, so FileBird's option is never
   written.
3. **One app user with role switching**, as the track brief says, instead of §5.2's "Editor and
   Author users".
4. **Trust stores:**
   - WordPress trusts the CA through the WordPress HTTP API bundle (`sslcertificates`), not the
     OS store.
   - The runner isn't root, so instead of the system store it uses a per-run bundle
     (`SSL_CERT_FILE`) and `NODE_EXTRA_CA_CERTS`. Chromium uses NSS via `certutil`, as planned.
5. **Two compose projects per worktree** (`…-dev`, `…-test`) instead of one name. That gives
   each mode its own volumes without name templating, and both can run side by side.
6. **The npm cache is `dev/.cache/npm`**, not the root `.cache/npm`. The root `.gitignore` is
   off-limits, and `dev/.gitignore` covers it.
7. **Snapshots** live in a per-stack named volume, not on the host. `down --volumes` therefore
   removes them, and nothing root-owned lands in the repo.
8. **Extra subcommands:** `dev/run info` and `dev/run wp <args>`. The proxy also listens on port
   80 (an HTTPS redirect), because WordPress builds `http://` loopback URLs outside requests.
9. **`dev/run test all` fails while suites are "not available yet"**, so the gate can't pass
   with suites missing. The summary separates "failed" from "not available yet".
10. **CI** adds `crazy-max/ghaction-github-runtime`: compose's `type=gha` cache needs the Actions
    runtime token outside `build-push-action`. On pull requests, version-bump compares with the
    PR base SHA, because there's no `before`.
11. **Seed extras:** a video block and an audio block (not in the context list), plus a legacy
    `ids` gallery, for parser coverage.

## 8. Open questions

1. **Second user.** Should `up` also create a separate Author user? Contract tests that need
   both roles in one run (for example per-item `edit_post` on another user's media) would
   otherwise flip `role=` between steps.
2. **Plugin dist layout.** Is it `plugin/dist/wp-upload-companion/wp-upload-companion.php` plus
   the zip? The `mu-plugins` run needs the file name.
3. **PHPStan's composer.** A pinned `composer:2` image, or a checksummed `composer.phar` run
   with `php84`?
4. **Hosts and pinning.**
   - Is binding to `127.0.0.1` with `admin`/`admin` acceptable as the dev default?
     (`WPU_BIND_ADDRESS` can open it up, for example for phone testing.)
   - Is pinning WordPress to the 7.1.5 patch tag right, rather than the moving `7.1` tag?
5. **Port range.** Should the port range (20000–27999) avoid anything common on the owner's
   machine?
