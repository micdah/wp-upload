# Track F3 (M1): theme and client quality infrastructure — handoff

Branch `mm/f3`, from `feature/media-manager` @ e09ac4f. Scope: the brief [F3.md](F3.md).

## 1. What works

All commands run from the repo root unless noted.

| Deliverable | Where | Verified by |
|---|---|---|
| Theme from the tokens, both schemes | `client/src/media-manager/theme/` | `npx vitest run` in `client/` (unit + browser), 63 theme tests |
| Client Vitest projects (`unit` Node, `browser` Chromium), MSW in both | `client/vitest.config.ts`, `client/src/media-manager/test/` | `npm run test -w client`: 132 tests pass, including the spikes |
| Bundle budget (plan §9) | `client/scripts/bundle-budget.mjs`, run by `test/bundle-budget.spec.ts` | `node scripts/bundle-budget.mjs` in `client/`; negative checks done by hand (media-manager module in the entry, MSW in the chunk) |
| URL guards on the built client | `server/src/app.spec.ts` | `npm run build && npm run test -w server`: 354 pass; each new guard fails on a planted file |
| Spikes C1 and C3 (code, tests, measurements) | `client/src/media-manager/test/spikes/{c1,c3}/`, notes in `spikes/C1.md`, `spikes/C3.md` | `npx vitest run src/media-manager/test/spikes --reporter=verbose` in `client/` |
| `dev/run test typecheck` and `dev/run test unit` | runner | Both pass. `unit` runs the server's 354 tests and the client's 132 (both Vitest projects, Chromium from the runner image, the bundle budget and the spikes) |

Also checked: `npm run check` (Biome), `npm run typecheck -w client`, `npm run typecheck -w server`.

The `browser` project sets `optimizeDeps.force`. With a warm Vite cache, a test that imports a
dependency the cache hasn't seen made Vite re-optimise and reload mid-run, and that test file failed. The
runner keeps `node_modules` in a volume, so CI would hit this too.

### Theme API (`client/src/media-manager/theme`, import from `../theme`)

- `MediaManagerThemeProvider({ children, forceColorScheme?, defaultColorScheme = 'auto', colorSchemeManager? })`.
  It wraps `MantineProvider` with `mediaManagerTheme`, `mediaManagerCssVariablesResolver`, and
  `localStorageColorSchemeManager({ key: 'wpu-mm-color-scheme' })` (`COLOR_SCHEME_STORAGE_KEY`). It also
  imports `@mantine/core/styles.css`, the Geist fonts and `theme.css`. Toggle the scheme with Mantine's
  `useMantineColorScheme()`.
- **Token names** are exactly those of `prototype/css/tokens.css` plus base.css's layout block:
  - semantic, per scheme: `--surface-{app,panel,raised,overlay,stage,tile,filmstrip,hover,active,input}`,
    `--scrim`, `--text-{1,2,3,on-accent,accent,on-select}`, `--line-{1,2,input}`,
    `--accent{,-hover,-subtle,-line}`, `--focus-ring`, `--select-ring`, `--select-tint`,
    `--filmstrip-dim`, `--ok`, `--warn`, `--warn-fill`, `--text-on-warn`, `--danger`, `--danger-fill`,
    `--danger-fill-hover`, `--text-on-danger`, `--info`, `--warn-subtle`, `--danger-subtle`,
    `--shadow-{1,2,3}`, `--glow-accent`;
  - shared: `--gray-*`, `--cyan-*`, `--font-{ui,display,mono,brand}`, `--fs-{11,12,13,14,16,20,24}`,
    `--fw-*`, `--display-{transform,tracking}`, `--radius-{xs,sm,md,lg,pill,tile,tile-selected}`,
    `--tile-selected-scale`, `--dur-{1,2,3,morph}`, `--ease-{out,in,standard}`, `--z-*`, `--grid-gap`,
    `--space-1…8`, `--toolbar-h`, `--filterbar-h`, `--folders-w`, `--rail-w`, `--inspector-panel-w`,
    `--filmstrip-h`.
  - `cssVar('surface-panel')` returns `'var(--surface-panel)'`, and a typo is a type error. Types:
    `SemanticToken`, `TokenName`.
- **Mantine mapping** (design-system §8): `colors.dark` (gray-400 … gray-1000), `colors.gray` (light),
  `colors.neon` (cyan-50…900), `primaryColor: 'neon'`, `primaryShade {light: 7, dark: 4}`,
  `autoContrast`, `radius` xs/sm/md/lg/xl = 4/6/10/14/pill, `defaultRadius: 'sm'`, `spacing` xs…xl =
  4/8/12/16/24, `fontSizes` xs…xl = 11/12/13/14/16, breakpoints xs/sm/md = 600/900/1200 px.
  - A `variantColorResolver` gives `filled` primary buttons `--accent`/`--text-on-accent`,
    `color='red'` filled buttons `--danger-fill`/`--text-on-danger`, and the `light` variants the subtle
    fills. Mantine's own auto contrast would miss 4.5:1 on light cyan and dark red.
  - The resolver also points Mantine's body, text, dimmed, default, border, error and primary variables
    at the tokens. `theme.css` sets the focus ring (`--focus-ring`), input edges (`--line-input`), the
    overlay surfaces of menus, popovers and modals, inverted tooltips, and reduced motion.
- **Tests:** `tokens.spec.ts` parses the prototype's `tokens.css` and `base.css` and fails on any name
  or value drift (the font stacks only differ by naming the self-hosted faces first).
  `theme.browser.spec.tsx` renders both schemes in Chromium. It checks the four neutral surfaces'
  chroma and **all 20 token-report.mjs pairs**, each against its minimum and against the ratio
  documented in design-system §2 (so a regression fails). It also checks the rendered colours of
  Mantine buttons and inputs, the body, and that Geist is self-hosted.

### Test harness (`client/src/media-manager/test/`)

- **Naming:** `*.spec.ts` runs in the `unit` project (Node); `*.browser.spec.ts(x)` runs in the
  `browser` project (headless Chromium, 1280×800). `npm run test -w client` runs both; one project at a
  time with `npx vitest run --project unit|browser` in `client/`. In the runner, the browsers come from
  the Playwright image.
- **MSW:** `import { mockNetwork } from '…/test/msw'`, then
  `mockNetwork.use(http.get('*/api/library/bootstrap', …))`. It is the same facade in both projects
  (msw/node or msw/browser's service worker, which msw/vite serves in worker-only mode, so nothing goes
  in `client/public`). Handlers reset after each test. **An `api/…` or `session` request that no handler
  answers fails the test.** There are no default handlers: F2's collector can be passed per test.
  In Node use absolute URLs; in the browser relative ones resolve against the test page.
- `renderWithProviders(ui, { colorScheme = 'dark', queryClient?, wrapper? })` renders with the theme
  (pinned scheme) and a fresh TanStack Query client (no retries). It returns the RTL result plus
  `queryClient`. RTL cleanup and `localStorage.clear()` run after each test.
- `keyboard.ts` (US + DK):
  - `strokesFor(key)`: what each layout reports when typing `key`, including both AltGr reporting
    styles (Ctrl+Alt on Windows, `AltGraph` elsewhere);
  - `strokeOn(layout, key)` and `modStroke('k', 'mac'|'other')`;
  - `isTypableOnAllLayouts`, `isShortcutSafeKey` (the policy), `shortcutKeyMatrix()` and
    `altGrCharacters()` for F1's keymap matrix;
  - `pressKey(stroke, target)` and `toKeyboardEvent` (browser; wrap `pressKey` in `act()`);
  - `userEventKeyboardMap('dk')` for `userEvent.setup({ keyboardMap })`.
- Examples: `test/keyboard.spec.ts` (unit) and `test/harness.browser.spec.tsx` (browser).

### Guards

- `client/scripts/bundle-budget.mjs` builds in memory with the real `vite.config.ts` and fails when:
  - the initial media-manager chunk (MediaManagerApp's chunk, its static imports and their CSS, minus
    the entry's) is over 150 kB gzip;
  - a `src/media-manager/` module is in the entry's static closure;
  - the entry grows by more than 5 kB over the M0 baseline (69 101 B gzip);
  - MSW or `media-manager/mocks` code is in the build.

  Today: entry 69.10 kB, media manager 49.98 kB. With the theme wired in (tried locally, not
  committed): 53.6 kB plus 11 font files (147 kB, fetched per unicode-range and not counted).
- `app.spec.ts` now also flags `/wp-json` anywhere in index.html or scripts, `"/assets/` in scripts,
  CSS `url(/`, MSW (`mockServiceWorker`, `[MSW]`, `msw*` file names), and fewer than two JS chunks.

## 2. Missing, and why

- **The theme isn't wired into the app.** That is F1's job: in `app/MediaManagerApp.tsx`, replace
  `MantineProvider` (and its `@mantine/core/styles.css` import) with `MediaManagerThemeProvider`.
- Orbitron (the wordmark) is not self-hosted; see CR-2.
- The spikes ran in headless Chromium only, with synthetic data, plain tiles and synthetic drag events.
  Other engines, real pointer and touch input, and images are left to C2 and the A1 and A3 e2e tests
  (see the notes).

## 3. Deviations

- The font tokens name the self-hosted faces first (`'Geist Variable', Geist, …`,
  `'Geist Mono Variable', 'Geist Mono', …`). `--font-brand` stays `Orbitron, var(--font-ui)`.
- `--space-*` and the layout dimensions come from the prototype's `base.css` (design-system §4 lists
  them, `tokens.css` doesn't define them).
- Mantine's z-indices are unchanged. The app's `--z-*` layers are for our own elements.
- The bundle-budget gate runs as a unit test instead of a separate script step, so no `package.json` or
  `dev/run` change is needed.

## 4. Change requests

**CR-1 `client/tsconfig.json`** (orchestrator): typecheck the Vitest config. Verified clean locally.

```diff
-  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]
+  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts", "vitest.config.ts"]
```

**CR-2 dependency** (orchestrator): self-host the wordmark font before M5, when `index.html`'s Google
Fonts link goes. Add `"@fontsource/orbitron": "^5"` to `client/package.json` dependencies. F3 (or F1)
then adds `import '@fontsource/orbitron/600.css'` to `theme/fonts.ts`.

**CR-3 optional, `client/package.json` scripts** (convenience only):

```diff
+    "test:unit": "vitest run --project unit",
+    "test:browser": "vitest run --project browser",
+    "budget": "node scripts/bundle-budget.mjs",
```

**CR-4 repo `CLAUDE.md` (M5 docs):** add `npm run test -w client` to the command list (it builds in
memory, so it doesn't need `client/dist`).

## 5. Spike results

**C1, justified grid + TanStack Virtual at 50k** ([note](spikes/C1.md)): **keep the choice.**

- Layout of 50k items takes 1.1–4.4 ms on the host and up to 7 ms in the runner, against a 50 ms
  budget. 100k takes 2.5–3.6 ms in Node.
- Scrolling 400 steps through the 1.98M px grid (one-viewport steps, then jumps like scrollbar drags)
  renders every step in one frame, with **0 long tasks**. Only 24 tiles are mounted.
- Focus pinning (a `rangeExtractor` keeps the focused row) and resize anchoring (focused or first
  visible item within 1 px) both work.
- A1 gotchas:
  - call `virtualizer.measure()` after a re-layout;
  - dispatch a `scroll` event after restoring `scrollTop`, because Chromium fires none there;
  - re-focus the re-created tile after a re-layout;
  - set `scrollbar-gutter: stable` on the scroller.
- A1 should lift `justifiedLayout.ts` and its spec as they are.

**C3, virtual tree + Pragmatic DnD** ([note](spikes/C3.md)): **keep the choice.** Mantine `Tree` isn't
needed.

- These all work:
  - the ARIA tree and its keyboard handling;
  - the hitbox: top quarter before, middle nest, bottom quarter after, and an open folder's bottom
    edge means inside;
  - the cycle block, with its reason shown;
  - the live in-page preview with the native one disabled;
  - the drop as the API's `{parent, position}`;
  - auto-expand at 700 ms, auto-scroll (760 px/s) and media drops;
  - a drag whose source row is virtualised away.
- Cost:
  - rendering 300 or 5k folders, all expanded, takes 10–13 ms, with 28 rows mounted;
  - dragging through 200 rows of 5k gives **0 long tasks**.
- A3 should lift:
  - `folderTree.ts` and its spec;
  - `VirtualFolderTree.tsx` as the starting point;
  - `dragDriver.ts` (synthetic `DragEvent`s) for tests.

## 6. Open questions

- Should the default colour scheme be `auto` (follow the OS, as the prototype does) or `dark`? The
  provider defaults to `auto`.
- `@mantine/core/styles.css` (36.8 kB gzip) is the largest part of the initial chunk. Per-component
  CSS imports could save around 20 kB if the budget gets tight in M3.
