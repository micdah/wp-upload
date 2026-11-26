# Track A1 (M3): grid, filters and peek — handoff

Branch `mm/a1`, from `feature/media-manager` @ fc9999d. Scope: [A1.md](A1.md), under
[M3-wave-A.md](M3-wave-A.md) and [README.md](README.md). Docker was available; every gate result below
comes from this worktree's own stack. One helper ran: an independent high-effort review (`final-reviewer`)
of the branch diff; its findings and what was done about them are in §6.

## 1. What works

From the repo root:

```sh
npm ci
npm run check                                  # Biome: clean
npm run typecheck -w client -w e2e             # clean
npm run test -w client                         # all pass except the bundle budget (§3, CR-A1-4)
node client/scripts/bundle-budget.mjs          # 153.6 kB of 150 (§3)
dev/run test plugin-static
dev/run up test && dev/run seed small
dev/run test e2e-mock e2e-live                 # 37 and 18 passed
dev/run test e2e-mock -- mock/a1-perf.spec.ts --workers=1   # the 50k budget, enforced (§4)
```

The owner's feel review at 50k works as in the M2-slice handoff §2:
`npm run dev:mock -w client`, then `?view=library&mock-scenario=large&mock-images=picsum`.

### 1.1 Tiles (`features/grid`)

- **Badges** bottom right (`badges.ts`, pure and unit-tested): Alt missing (warn, with the accessible
  icon) on images and SVGs whose alt is empty after trimming; video and audio duration (`m:ss`,
  `h:mm:ss` from an hour); PDF page count (`PDF · 12 p`). An upload error (`Failed`, danger) or
  processing (`Processing`, also for `sizesPending`) comes first.
- **Non-images** are neutral cards with a type icon; PDFs and videos with a cover show it. **SVG**
  sits contained on a checkerboard, **PNG** fills the tile over one.
- **Upload state** natively from `core/uploads`' tile upload store: queued (dimmed, empty ring),
  uploading (dimmed, accent ring with `42 %`), processing (less dimmed, spinning arc, Processing badge),
  error (danger ring, Failed badge, Retry). The local `previewUrl` shows until the upload's state goes
  away. Retry runs `upload.retry {key}` (declared here, B2 implements it; until then it is disabled with
  "Not available yet").
- **"Just changed" flash** (`flash.ts`): the return ring's accent flash, once, when a tile's upload
  finishes (state goes away without an error), when its item's `modifiedAt` changes while it is on
  screen (a save, a batch edit, an edit elsewhere that a rev poll brings), or on `flashTiles(ids)`
  (exported from `features/grid`; CR-A1-3 asks for a core entry point). Each flash restarts.
- **Hover** shows the check circle and the file name. **The check circle toggles** its tile (like
  Ctrl/Cmd+click), with a 34 px target; two quick clicks on it toggle twice and never open detail.
  Shift+click on it is a range; on touch (no hover) it toggles only while it shows (the tile is
  selected, or 2 or more are). It works on uploading tiles too.
  The glyph is CSS, one component less per tile.
- **Accessibility:** a tile's name stays its file name (what its hover overlay shows). Badge text, the
  progress and Retry are CSS content from `data-text`, because visible DOM text the name doesn't
  contain fails WCAG 2.5.3 (axe's `label-content-name-mismatch` failed the e2e on the first try). The
  same facts are the tile's description (`aria-describedby`: "Missing alt text, Duration 1:34").

### 1.2 Selection

- Pointer and keyboard selection as built in M2 (click, Ctrl/Cmd+click, Shift ranges, double-click and
  double-tap, arrows with ↑/↓ to the nearest centre, Home/End, Shift+arrows, X, Ctrl/Cmd+A, Esc),
  plus the check circle.
- **The selection bar** at 2 or more selected: "✕ N selected · Move to folder · Edit details ·
  Download · Delete", with "· N hidden by filters" under D33. It is a toolbar item that covers the
  shell's toolbar (its positioned ancestor) and hides what is underneath with `visibility`, which also
  takes those controls out of the tab order; no shell change was needed. Without FileBird there is no
  Move to folder. The actions run `folders.move-to` (A3), `inspector.edit-details` (declared here,
  A4), `items.download` and `items.delete` (B3); until they exist they render disabled, with the reason
  in the tooltip. ✕ clears and gives the grid its focus back. Its content is a lazy chunk.
- Selected tiles scale into the ring with the check (M2).

### 1.3 Filters and sort (`features/filters`)

- **Search** in the toolbar: writes `q` 150 ms after the last keystroke (replace), Enter at once; Esc
  clears, a second Esc leaves the field (the keymap). It follows `q` when it changes elsewhere (Clear
  filters, Back), never while a keystroke is pending.
- **The filter bar:** All / Images / Video / Audio / Documents with the folder's counts (facets
  `folder` scope), a type with 0 items hidden unless it is the active one; Missing alt with its count;
  the active size, orientation and month as removable chips; "+ Filter" (Size, Orientation, Uploaded:
  every month with media, newest first, with counts); the summary `N items · total size` (the
  collection's own total, the size from facets `view` once they belong to this query). While a
  folder's counts load the chips are skeletons: never stale counts, never spinners. The chips scroll
  sideways when the centre is narrow; "+ Filter" and the summary stay in view. In the Trash, which
  ignores filters, search and sort, none of them render (B3 owns that view).
- **Sort** menu in the toolbar with the current order as its text.
- Everything is URL state written with replace (D16) and keeps the selection. Menus: Mantine `Menu`,
  each heading grouping its items in a labelled `group`; the current item is `aria-current` (Mantine
  forces `role="menuitem"`, where `aria-checked` isn't allowed); the first item takes focus on open.

### 1.4 Density and layout

A segmented Justified / Square toggle and a thumbnail-size slider (native controls; the slider is
`data-mm-local-keys`, so its arrows never move the grid's focus), next to `L` and `+`/`-` from M2. The
scroll anchor now also follows focus, so a density or layout change right after a click keeps the
focused tile where it was (spike C1; tested to within 2 px).

### 1.5 States

Skeleton rows shaped like the justified grid (M2); "No media matches" with Clear filters; "This
folder is empty" and "Your media library is empty" with Upload (`upload.pick`, B2) on dashed drop-zone
art; no spinners. The empty states are a lazy chunk, fetched when idle.

### 1.6 Quick peek (`features/peek`)

`Space` opens core's `peek` overlay on the focused tile: the item fitted into 86 % × 80 % of the
centre (never upscaled; `fit.ts`), on a scrim with a blur, with a caption pill (name truncated in the
middle, `W × H · size`, key hints); non-pictures get a card. Focus stays on the grid's tile, so the
arrows keep moving it and the peek follows. Space or Esc closes (a key layer, so Esc closes the peek
before it clears the selection); Enter opens detail, which closes it (core sync); a click on the scrim
closes it, a click on the picture doesn't, and focus stays on the tile. It closes when a filter hides
its item, and doesn't open on a hidden one. The URL and the selection don't change. Only one centre
overlay at a time (D36): Space does nothing over the editor. The content is a lazy chunk.

## 2. Tests and gate

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm run typecheck -w client -w e2e` | clean |
| `npm run test -w client` | 63 files, 774 tests: all pass except `bundle-budget.spec.ts` (§3) |
| `dev/run test plugin-static` | pass |
| `dev/run up test`, `seed small` | ok (re-run after `plugin-static` built the plugin) |
| `dev/run test e2e-mock` | 37 passed (the last run on the final commit, and twice before it) |
| `dev/run test e2e-live` | 18 passed (three runs, the last on the final code) |
| `dev/run test e2e-mock -- mock/a1-perf.spec.ts --workers=1` | passed twice on a quiet machine; failed twice at the end, at load average 6–20 from other worktrees' suites (§4) |

New tests:

- Unit (Node): `grid/badges.spec.ts`, `filters/model.spec.ts`, `peek/fit.spec.ts`.
- Browser (Chromium, `renderLibrary` over the fake, `failOnReactWarnings`):
  `grid/tiles.browser.spec.tsx` (badges, cards, checkerboard, check circle, every upload phase, preview,
  flash), `grid/toolbar.browser.spec.tsx` (selection bar and D33, select all, ✕ and focus, layout and
  density, focus anchoring, empty states, skeleton), `filters/filters.browser.spec.tsx` (counts,
  hidden types, chips, menu, removable chips, skeletons, search debounce and Esc, sort by mouse and
  keyboard, replace and selection kept), `peek/peek.browser.spec.tsx`, `grid/perf.browser.spec.tsx`
  (50k, §4).
- E2E, mock and live, both colour schemes, axe on every new screen (filter bar, open menu, no
  matches, selection bar, peek, square layout), no request outside the sub-path:
  `e2e/mock/a1.spec.ts` and `e2e/live/a1.spec.ts` (flows in `e2e/mock/a1-flows.ts`), plus
  `e2e/mock/a1-perf.spec.ts` (50k).

Noise seen once and not reproduced when re-run alone: spike C1's harness (`test/spikes/c1`) reported a
57 ms long task during a resize in a fully parallel client run; the slice e2e's touch test read a
"Loading" tile name once and its title "Saving…" step timed out once, both in a full parallel run while
other worktrees' stacks were busy. All passed on the re-runs above. Under heavy load, Vitest's
browser project also failed to import some spec files once (`Failed to fetch dynamically imported
module` after "Vite unexpectedly reloaded a test", and once an iframe that "did not become ready within
60000ms"); the re-run was clean.

## 3. Bundle budget (D31): over by 3.4 kB

The initial media-manager chunk is **153.57 kB** gzip against 150 kB (`bundle-budget.spec.ts` fails).
At fc9999d it was 145.95 kB, so the M2 slice left 4.05 kB; A1's deliverables cost about 7.4 kB even
with the peek, the selection bar's content and the empty states as lazy chunks (they took 0.9 kB off).

Measured by removing one part at a time:

| Part | Initial chunk without it |
|---|---|
| everything A1 adds | 145.95 kB |
| the filters feature (bar, search, sort) | 150.49 kB (−2.9) |
| A1's tile changes (badges, upload state, flash, check circle) | 152.08 kB (−1.3) |
| the peek's entry (command, layer, prefetch) | 153.04 kB (−0.3) |

Making the filter bar lazy made it worse (154.54 kB): the bar shares Mantine's `Menu`, `Tooltip` and
`Input` with the initial chunk, so Rollup split them into separate shared chunks, each compressed on
its own. The code itself has been trimmed (shared menu parts, fewer icons, one duration format):
those took off 0.2 kB. The rest is the features. See CR-A1-4; A2, A3 and A4 will hit the same wall.

## 4. Performance at 50k (plan §9)

**Layout** (budget 50 ms), `grid/perf.browser.spec.tsx`, the real `large` mock collection at 593 px
(folders and inspector open in Vitest's 1280 px frame), five runs per density in both layouts: median
0.9–2.1 ms, worst single run 5.0 ms (12.9 ms in a run while other suites competed for the CPU). Within
budget by 10×.

**Scrolling** (budget: no long task over 50 ms):

- **Production mock build**, `e2e/mock/a1-perf.spec.ts` at 1440 × 900: 120 mouse-wheel steps of 700 px,
  then 40 scrollbar-like jumps across the 50k grid, tiles hydrating as they come into view.
  - Alone (`--workers=1`) on a quiet machine: **0 long tasks over 50 ms** in two runs (one at its
    first pass; one at its third, the passes measuring 2, 3 and 0, max 83 ms). Twice more at the very
    end, while other worktrees' suites pushed the load average from 6 to 20 on this 16-core machine,
    it failed: best passes with 1 (63 ms) and 12 (164 ms) long tasks. Please re-run it on a quiet
    machine before the merge; nothing on the scroll path changed between the passing and the failing
    runs except the review fixes in §6 (none of them per scroll).
  - In the full parallel suite it only checks for a frozen UI (250 ms); measured there: 0 to 14 long
    tasks per pass, max 142 ms.
  - Switches at 50k: density `+` one long task of 56–80 ms (every visible tile re-renders at its new
    size); `L` 0; select all 0; Esc 0; the Images chip 64–125 ms (the mock answers the new 50k
    collection on the main thread).
  - With the mock's SVG placeholder pictures: 0–15 long tasks (max 121 ms) depending on load. MSW makes
    those SVGs on the main thread and Chromium rasterises SVG images there too; real renditions are
    JPEGs decoded off the main thread, so the budgeted run keeps them off the page.
- **Vitest (development React, MSW in the same iframe)**, pictures off, 200 one-screen steps plus 60
  jumps: frame p50 16.9–17.0 ms, p95 45–48 ms, max 74–75 ms; 3–6 long tasks (max 63–65 ms). Switches:
  density 57–67 ms to the next frame, layout 51–53 ms, select all no long task. It asserts only "no
  frozen UI" (400 ms); the budget is the production run's.

**Found and fixed on the way:** the grid's scroll handler read `clientHeight` on every scroll event,
forcing a layout right after each virtualiser render. In the Vitest harness that was the biggest cost
after the pictures: frame p50 went from 59–64 ms to 17 ms once the height came from the resize observer
and the check glyph became CSS (commit ce3be56). The slow p50 was there in M2 too (57 ms on fc9999d).

## 5. Change requests

**CR-A1-1, `core/commands/registry.ts` (declare two commands A1's buttons run).** A1 declares them by
module augmentation in `features/grid/commands.ts`; A4 and B2 implement them. Move them into core:

```diff
@@ export interface CoreCommandMap {
   // Edit
   'inspector.edit-image': undefined
   'inspector.focus-alt': undefined
+  /** The selection bar's Edit details: Info tab, first field focused. */
+  'inspector.edit-details': undefined
@@
   // Files
   'upload.pick': undefined
+  /** Retry on a failed upload's tile; keyed like the tile upload state. */
+  'upload.retry': { key: number | string }
@@ const DECLARED
   'inspector.focus-alt': { label: 'Jump to alt text', group: 'Edit' },
+  'inspector.edit-details': { label: 'Edit details', group: 'Edit' },
@@
   'upload.pick': { label: 'Upload files', group: 'Files' },
+  'upload.retry': { label: 'Retry upload', group: 'Files' },
```

Then delete `features/grid/commands.ts` and its call in `features/grid/index.tsx`
(`describeGridCommands()`).

**CR-A1-2, `core/ui/icons.ts` (icons).** core is frozen, so A1 re-exports these from
`features/grid/icons.ts` and `features/filters/icons.ts`. Move them into the curated set and point the
imports there:

```diff
 export {
+  IconAccessible as AltIcon,
   IconAlertTriangle as AlertIcon,
   IconArchive as ArchiveIcon,
+  IconArrowsSort as SortIcon,
@@
   IconCheck as CheckIcon,
+  IconChevronDown as ChevronDownIcon,
   IconChevronLeft as PreviousIcon,
   IconChevronRight as NextIcon,
+  IconCloudUpload as UploadArtIcon,
@@
   IconFolder as FolderIcon,
+  IconFolderOpen as FolderOpenIcon,
@@
   IconKeyboard as KeyboardIcon,
+  IconLayoutBoard as JustifiedIcon,
+  IconLayoutGrid as SquareIcon,
@@
   IconPlug as PluginIcon,
+  IconPlus as AddIcon,
@@
   IconSun as SunIcon,
+  IconTrash as DeleteIcon,
   IconUpload as UploadIcon,
```

**CR-A1-3, `core/collection/centerApi.ts` (flash tiles from anywhere).** A3 (moved items), A4 (a
batch edit applied), B1 and B2 will want the "just changed" flash without importing `features/grid`:

```diff
   /** The detail stage's main image/media element, for the morph. */
   stageElement(): HTMLElement | null
+  /** Flashes these items' tiles once ("just changed"); off-screen ones are skipped. */
+  flashItems(ids: readonly number[]): void
@@ export const centerApi: CenterApi = {
   nudgeStage(direction) {
     find('nudgeStage')?.(direction)
   },
+  flashItems(ids) {
+    find('flashItems')?.(ids)
+  },
 }
```

A1 then registers `flashItems: flashTiles` in `GridView`'s `registerCenter` call (A1's file; a
one-line follow-up once the CR lands).

**CR-A1-4, the bundle budget (D31; owner decision).** §3 has the numbers. Options:

1. Raise the initial-chunk budget for waves A and B (for example to 165 kB), recording it as an
   amendment of D31.
2. Orchestrator-owned splitting that A1 can't do: make the login form and the boot screens lazy
   (`app/auth/LoginForm.tsx` is imported statically by `AuthGate.tsx` and `app/screens/screens.tsx`,
   so it ships to logged-in users with `PasswordInput` and `Alert`), and give Mantine one shared chunk
   in `client/vite.config.ts` (`manualChunks`), so feature chunks that use `Menu`/`Tooltip`/`Input`
   no longer split them into many small, separately compressed chunks. With that, the filter bar and
   the toolbar controls could become lazy too.
3. Both.

## 6. Independent review

A `final-reviewer` (high effort) read the branch diff against the brief, the specs, the contracts and the
rules. It found no critical issues, 2 important and 8 minor ones, and some test gaps. Fixed in 67dc468
(the touch-action one in the same commit, from the working tree):

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 (important) | The upload overlay covered the check circle, so a click meant to add an uploading tile replaced the selection | `.upload` takes no pointer events; only Retry does | `tiles.browser.spec.tsx`: the circle toggles on a processing and on a failed tile |
| 2 (important) | Focus fell to `<body>` when the selection bar went away with focus inside it (Esc on a bar button, an action that empties the selection) | The bar tracks focus inside it and gives it back to the focused tile when it unmounts | `toolbar.browser.spec.tsx`: Esc from the Download button |
| 3 | A failed tile's danger ring hid the keyboard focus ring | Both rings on `:focus-visible` | — (CSS) |
| 4 | Retry on a tile isn't reachable by keyboard | Kept: the upload tray's Retry (B2) is the keyboard path; open question 7 | — |
| 5 | The peek could show an item the filters hide (focus survives filters) | `peek.toggle` is unavailable for a hidden item, and an open peek closes once the new rows hide it | `peek.browser.spec.tsx` |
| 6 | A click on the peek's scrim left focus on `<body>` | The scrim's mousedown doesn't take focus | covered by the scrim test |
| 7 | On touch the invisible check circle toggled; Shift+click on it toggled | On touch the circle toggles only while it shows (tile selected, or 2+ selected); Shift+click is always a range | `tiles.browser.spec.tsx` (Shift+click on the circle) |
| 8 | A tile blanked when the local upload preview gave way to the real thumbnail | The preview is `TilePicture`'s first picture, so its preload-then-swap covers it | the preview test |
| 9 | Search and sort stayed active in the Trash, which ignores both | They render nothing there | — |
| 10 | Menu items lacked `touch-action: manipulation` | Added (and on the search box) | — |
| gaps | No test of D36, of the layout switch's anchoring | Added: Space does nothing over the editor overlay; `L` keeps the focused tile in place | `peek.browser.spec.tsx`, `toolbar.browser.spec.tsx` |

Not added: a test that a pending keystroke isn't overwritten by a URL change (the code skips following
`q` while its timer runs).

## 7. Deviations

- **`e2e/mock/a1-flows.ts`** isn't one of the listed per-track patterns (`e2e/{mock,live}/<track>*.spec.ts`).
  It holds the flows both projects run, as `e2e/support/slice.ts` does for the slice; a spec file can't
  be imported by another without registering its tests twice. It is A1's alone.
- **Months in "+ Filter":** every month with media, in a scrolling menu (the prototype shows the newest 8).
- **The Missing alt chip** stays visible at 0, as in the prototype (good news is still news); the
  type chips hide at 0 as the spec says.
- **Clicking the active type chip** turns it off (as All does), besides the prototype's All chip.
- **Menu items** are `menuitem` with `aria-current` on the current one, not `menuitemradio` with
  `aria-checked`: Mantine sets the role itself.
- **The perf budget is enforced** when `a1-perf.spec.ts` runs alone with one worker; inside the
  parallel suite it fails only on a frozen UI (250 ms). Parallel workers only ever add long tasks.

## 8. Open questions

1. **Bundle budget** (CR-A1-4): raise it, split differently, or both?
2. **Focus without selecting.** interaction-spec §1 says focus moves without selecting "only when you
   hold a modifier", but the keymap's layout rule allows Ctrl/Cmd only with letters and Enter, so
   Ctrl/Cmd+arrows can't be bound (`grid.move-focus` already has `mode: 'focus-only'`). Drop it from
   the spec, or allow Ctrl/Cmd+arrows in the layout rule?
3. **Pending upload tiles.** system.md §1 puts a tile at the top of the grid as soon as a file is picked,
   before WordPress has an item. The tile upload store has the state for string keys, but not the
   box (width, height, kind) or the order, so the grid can't place such a tile. B2 needs a way to add
   pending rows to the collection (a small `core/uploads` or `core/collection` addition), or the tile
   appears only once the item exists. Which?
4. **The flash on the user's own saves.** A tile flashes whenever its item's `modifiedAt` changes on
   screen, including an alt text saved in the inspector next to it. It reads as confirmation; say if
   it should be limited to changes made elsewhere and explicit `flashTiles` calls.
5. **Delete in a folder** (system.md §2): the selection bar's Delete runs `items.delete`; the small menu
   with both choices is B3's.
6. **Dragging tiles** (A3): `useMediaDraggable` isn't attached to tiles yet; A3 merges after A1 and can
   attach it in `Tile.tsx`, or ask A1.
7. **Retry by keyboard.** A failed tile's Retry is `tabIndex=-1` inside the grid's roving tab stop; the
   upload tray's Retry (B2) is meant to be the keyboard path. Enough, or should Enter on a failed tile
   retry?
8. **The 50k perf flow** should be re-run on a quiet machine before the merge (§4).

## 9. Branch and commits

`mm/a1` (not pushed):

- `ba7e3a4` feat(grid): badges, upload state, flash, selection bar, view controls and empty states (A1)
- `3bd25f9` feat(filters): filter bar, search and sort in the URL (A1)
- `83dae43` feat(peek): quick peek on Space (A1)
- `ce3be56` perf(grid): no layout read per scroll event, CSS check glyph, 50k perf spec (A1)
- `1615a4e` test(e2e): A1 flows in mock and live, and the 50k perf flow
- `c632f8c` fix(grid): tile text as CSS content, so tiles keep their file-name label (axe)
- `55020ad` fix(filters): menus pass axe; perf budget enforced when the flow runs alone
- `67dc468` fix: review findings for the grid, filters and peek (A1)
- (this note)

The stack was stopped with `dev/run down` (volumes kept).
