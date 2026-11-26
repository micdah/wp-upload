# Media manager — handoff to implementation planning

This document lets a new session pick up the media-manager initiative without the history of the
research and design sessions. Read it first, then the documents it points to.

## 1. What this is and where it stands

wp-upload is a self-hosted app for uploading media to WordPress. It is server-side Express, plus a React
client. The **media-manager initiative** turns it into a full, modern alternative to the WordPress Media
Library:

- a big justified grid;
- an optional, resizable FileBird folder column;
- a Lightroom-style **detail mode** (big preview, filmstrip, toggleable side panels);
- a selection-aware inspector with in-place image editing;
- drop-anywhere upload, trash and undo, keyboard-first use.

| Phase | Status | Output |
|---|---|---|
| 1. Research | Done | [`research/`](research/README.md). Start at [`00-synthesis.md`](research/00-synthesis.md): capability matrix, decisions D1–D11, v1 scope, conventions |
| 2. Design | Done, approved at Checkpoint 3 | [`design/`](design/README.md): design system, clickable prototype, interaction spec, area specs, screen walkthrough |
| 3. Implementation planning | Done — see §6 | [`implementation-plan.md`](implementation-plan.md): contracts first, parallel tracks, milestones M0–M5 |
| 4. Implementation | **Next** — start at M0 in the plan | — |

## 2. Branch and repository rules

- **Branch:** all media-manager work lives on **`feature/media-manager`**. **Never merge into `master`.**
  Parallel sessions or worktrees branch **off `feature/media-manager`** and merge back into it.
- **CI:** decided (D13): the feature branch gets its own workflow, `.github/workflows/media-manager.yml`,
  described in [implementation-plan.md](implementation-plan.md) §6. `ci.yml` stays untouched.
- **Master stays healthy:** keep master's existing upload app working throughout. Generic improvements
  that benefit the current app (as with the earlier fixes #46–#48) can go to `master` as separate,
  normal PRs, then `feature/media-manager` is updated from master.
- **Public repo:** never put hostnames, mount paths or other deployment specifics in code, docs, commits
  or PRs. Use placeholders such as `example.com` and `/wp-upload/`.

## 3. The owner's working preferences

These are standing rules; the user's global and repo `CLAUDE.md` files are authoritative.

- **Commits:** never commit, amend or rebase unless explicitly told. Leave changes uncommitted for
  review. **Exception (D14):** an implementation track agent may commit on its own `mm/<track>` branch
  (never push, never rebase). Its track brief states this permission explicitly.
- **Pushing:** never push or open a PR without explicit approval.
- **Commit format:** conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, …) for commits and
  PR titles.
- **Final review question:** when creating a plan, ask whether it should end with a final review step.
  Offer exactly three options: auto-address findings, report findings only, or no review. Use the
  `final-reviewer` sub-agent for it.
- **Shell scripts:** readable, with named functions, descriptive variables, multi-line `if`, and why
  comments.
- **Keyboard shortcuts:** must work natively on **US and Danish** keyboards. Match on `event.key`; use only
  letters, digits, `, . - + ?`, named keys and `Ctrl/Cmd` + letter; never `[ ] { } \ | @ $ ~` or F-keys.
- **Parallel work:** the owner likes parallel sub-agents for speed, with clear briefs and exclusive file
  ownership per agent.
- **Effort:** every session and sub-agent on this initiative runs at **high** effort. Set it explicitly
  when starting one (`effort: "high"` on the Agent tool or `create_session`, `claude --effort high`).

## 4. Decisions that shape implementation

From [`research/00-synthesis.md`](research/00-synthesis.md) ("Decisions" and "Design-phase scope"):

| # | Decision |
|---|---|
| D1/D1b | A **companion WordPress plugin** (REST namespace `wp-upload/v1`) is **always required** for the media manager. ~~The existing upload-only page must keep working without it~~ — superseded by D1c |
| D2 | FileBird's internal `filebird/v1` routes are **not** used; the plugin wraps FileBird's PHP functions or tables |
| D3 | FileBird Pro features (folder colours, folder sort) only when **Pro is detected** |
| D4 | A **thin, stateless Node proxy**; filtering, sorting and indexing happen in the plugin's SQL |
| D5 | React 19.3 + Mantine 9 + Vite 8: **done on master (#48)** |
| D6 | Visual direction: **"Neutral + neon, tweaked"**, see [`design/design-system.md`](design/design-system.md) |
| D7 | Image edits happen **in place** via the plugin (same ID and URL), with restore original, regenerate and replace file |
| D8 | Delete: detect `MEDIA_TRASH` and use trash with undo, otherwise a permanent-delete confirm showing where items are used |
| D9 | The WP user is Editor or higher; detect capabilities and disable what isn't allowed |
| D10 | FileBird per-user folder mode is unsupported and shows a warning |
| D11 | A dev and test environment with WordPress + FileBird (Lite) + the companion plugin. Docker Compose was the decision. WordPress Playground (`@wp-playground/cli`) has also proven to work for live checks without Docker. *Superseded by D18: Playground is not part of the test path; all tests run in the local Docker `test` mode* |
| D1c | **The old upload page is removed** (overrides D1b's fallback): the media manager plus the plugin is the only UI. It is deleted in M5 of the plan |
| D12 | The plugin is a **regular WordPress plugin** (single file, also works in `mu-plugins`), bundled as a zip in the app image and offered by onboarding. It is versioned (`WPU_VERSION` + `WPU_API`); updates should be rare and additive (plan §2.6) |
| D13 | The feature branch gets **its own CI workflow** (`media-manager.yml`); `ci.yml` stays untouched |
| D14 | Track agents **commit locally on their own track branch**, never push; the owner reviews, the orchestrator merges |
| D15–D17 | No FileBird Pro licence (Pro features are detection-gated and mock-tested); a folder change replaces the history entry; never modify FileBird (no schema, index or direct writes). See plan §0 |
| D18 | **No hosted environments.** Two modes of one local Docker Compose project driven by `dev/run`: `dev` (hot reload) and `test` (all automated tests, including the production image under a sub-path). No test needs a real WordPress site; CI calls the same commands, so local runs and CI are interchangeable (plan §5) |
| D19–D30 | Checkpoint 4 decisions: in-place edits keep the same URL; `-scaled` replace warns then proceeds; Attach finds published posts only; usage covers core plus Visual Portfolio; folder colours Pro-only; bulk operations client-chunked; per-user mode shows own folders read-only; separate Editor and Author test users; plugin minimums WordPress 7.0 / PHP 8.1; Biome excludes the design prototype; the contracts' 45 detailed decisions accepted; dev-stack defaults accepted. See plan §0 |
| D31–D32 | M1 review: the 150 kB initial-chunk budget stays, M2 uses per-component Mantine CSS; no "view attachment page" link in v1. See plan §0 |
| D33–D48 | M1 open questions: bulk actions include hidden selected items; detail stops at the ends; toast-only undo; one overlay at a time; animated GIF edit warns; replace keeps old sizes; Visual Portfolio counting rules; Author folder counts follow visibility; Pro detection ships; downloads without credentials; no chunking in v1; CI perf report-only; plus technical items. Items marked *M2 task* go into the M2 briefs. See plan §0 |
| D49–D51 | M2 review: offline Retry stays refused; the inspector starts collapsed below 1200 px; replace keeps every old size set and `[gallery id=N]` stays tracked. See plan §0 |

**v1 scope:**

- **Core parity:** browse, filter, search, sort; FileBird folders; metadata editing; attach/detach;
  delete and trash; in-place crop, rotate and flip; upload.
- **Extras:**
  - batch editing, a missing-alt filter and badge, and the "Save & next" alt-text pass;
  - "where used" and EXIF;
  - replace file, regenerate thumbnails, restore original, scale;
  - sort and filter by size, dimensions, file name and type; alt and EXIF search; month list.
- **Not in v1:** ZIP downloads, the "Mine" filter, per-folder custom order.

**Conventions:**

- Justified grid by default, square as a toggle.
- `Space` = quick peek, `Enter` = detail mode; detail mode walks the whole collection.
- Dark and light themes from the start.
- Responsive and desktop-first.

## 5. Where to find everything

**The current app** (`master`, and `feature/media-manager` is up to date with it):

- **Server:** Express 4 on Node 24 (TypeScript run directly), proxying to WP REST and the FileBird public
  API.
  - Login page with a signed session cookie.
  - Uploads are streamed multipart via server-side upload jobs.
  - The app must work under **any sub-path**: relative URLs only, `base: './'`.
- **Client:** Vite 8, React 19.3, Mantine 9.8.
- **Tests:** server only (Vitest + supertest); the client has none. CI is on PRs to master.
- See the repo `CLAUDE.md` for commands and rules.

**Research:** [`research/`](research/README.md). The API capabilities and gaps for WP REST
([`01`](research/01-wordpress-rest-api.md)) and FileBird ([`02`](research/02-filebird-api.md)) matter
most for planning.

**Design** ([`design/`](design/README.md)):

- **Design system:** [`design-system.md`](design/design-system.md), the tokens in
  `design/prototype/css/tokens.css`, and the **Mantine 9 mapping in §8**.
- **Behaviour:** [`interaction-spec.md`](design/interaction-spec.md).
  - **§12** is the consolidated table of **companion-plugin API needs**.
  - **§13** lists the implementation notes.
  - The full keymap and the scenarios are in it too.
- **Area specs:** [`specs/folders.md`](design/specs/folders.md),
  [`specs/inspector.md`](design/specs/inspector.md) and [`specs/system.md`](design/specs/system.md).
  Each has edge cases, API needs and "Requests to core".
- **Screens:** [`screens.md`](design/screens.md) (screenshots of every screen and state).
- **Prototype:** `design/prototype/` is vanilla JS, made for design only. It is the **visual and
  behavioural reference, not code to port**. Run it with `node docs/media-manager/design/scripts/serve.mjs`
  (add `--host 0.0.0.0` to reach it from another device).

**Tooling notes:**

- Playwright is **not** a repo dependency yet. It is installed outside the repo, so pass `NODE_PATH` to the
  design scripts. (Implementation plan §3: it becomes a devDependency of the new `e2e/` workspace.) System Chromium is installed on the dev machine.
- `design/scripts/screenshots.mjs` runs the prototype's interaction checks and screenshots;
  `token-report.mjs` checks contrast and neutrality.

**Still unverified against a real site** (research/00-synthesis.md, "Needs live verification"):

- `POST /wp/v2/media?fbv=` auto-assigning a folder;
- FileBird's per-user mode with app-password callers;
- large `include=` queries through proxies;
- the WP 7.1 client-side processing routes behind TLS-terminating proxies;
- performance of the Uncategorized and count queries at 50k+ attachments.

## 6. The task: implementation plan (phase 3)

Produce a reviewed **implementation plan** for the v1 media manager on `feature/media-manager`, saved in
the repo (e.g. `docs/media-manager/implementation-plan.md`). Owner checkpoints happen as before.

**Workstreams to cover:**

1. **Dev and test environment** (D11): WordPress + FileBird Lite + the companion plugin, reproducible
   locally and possibly in CI. Seed data, including a larger library for performance.
2. **Companion plugin** (PHP; a regular plugin per D12): REST namespace, detection and capabilities, listing extensions
   (`fbv`, size/dimension/missing-alt filters and sorts, month list, dimension index), folder CRUD over
   FileBird, batch metadata, in-place edit / restore / regenerate / replace, where-used index, trash
   list and restore, upload limits and processing status. Include its own tests, versioning, a
   compatibility check with the app, and distribution.
3. **Server proxy (Express):** new `/api` routes over WP REST and the plugin, capability and plugin
   detection, caching, mutation fan-out, errors. Keep the existing upload path and the login.
4. **Client foundation:** routing and URL state (query params; the app must work under a sub-path),
   data fetching and caching (e.g. TanStack Query), the Mantine theme from the design tokens, app shell
   and panels, keymap infrastructure (the US + DK rule), lazy-loaded chunk.
5. **Client features**, following the area specs:
   - grid (virtualised justified/square), selection, filters and sort, peek;
   - detail mode with the View Transition morph, filmstrip, zoom, media types;
   - folders column, drag and drop, Move to…;
   - inspector, autosave, batch, Save & next, Usage;
   - image editor;
   - upload and tray;
   - delete and trash;
   - system states;
   - shortcut sheet and palette;
   - responsive layouts.
6. **Quality:** client test strategy (none exists today), end-to-end tests against the dev WordPress,
   accessibility checks, a performance budget, and CI for the feature branch.
7. **Rollout:** how the media manager sits next to the existing upload page; plugin-missing onboarding;
   docs.

**The plan must address:**

- **Sequencing and dependencies:** contracts first, i.e. the plugin REST contract, the server API
  contract and the theme tokens, so tracks can proceed in parallel against mocks.
- **Parallelisation with sub-agents:** which tracks can run concurrently, each in its own worktree or
  session branched off `feature/media-manager`, with exclusive file ownership, merge order and an
  integration cadence.
- **Milestones:** a vertical slice early (e.g. browse grid → detail → edit alt text end to end), then
  breadth.
- **Risks and open decisions,** for example:
  - CI for the feature branch;
  - plugin distribution;
  - library choices (virtualisation, drag and drop, editor canvas);
  - live-verification items;
  - FileBird coupling.
- **Verification approach per milestone.**
