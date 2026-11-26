# M3 (wave A) integration

Wave A ([M3-wave-A.md](M3-wave-A.md)) built the four central areas in parallel:
[A1](A1-handoff.md) grid, filters and peek; [A2](A2-handoff.md) detail mode; [A3](A3-handoff.md) folders;
[A4](A4-handoff.md) inspector. Each track's handoff has the detail. This note records the integration on
`mm/m3-int` (from `feature/media-manager` @ fc9999d).

## 1. Merges

| Order | Branch | Conflicts |
|---|---|---|
| 1 | `mm/a1` | none |
| 2 | `mm/a2` | none |
| 3 | `mm/a4` | none |
| 4 | `mm/a3` (after its review fixes, e34840a) | none |

The tracks kept to their own files, so the merges were clean. The integration problems were the expected
ones: duplicate feature-local icons, feature-side command declarations, the bundle budget, and flaky tests.

## 2. Change requests

| CR | What | Status |
|---|---|---|
| A1 CR-1 | `inspector.edit-details` and `upload.retry` declared in core's `CommandMap` (labels in `DECLARED`); `features/grid/commands.ts` deleted | done |
| A1 CR-2, A2 CR-1, A4 CR-2 | every feature-local icon moved into `core/ui/icons.ts`; `features/{grid,filters,detail,inspector}/icons.ts` deleted, imports point at core | done. Two name clashes resolved: `ExternalLinkIcon` (A4's name; A2's `ExternalIcon` renamed) and `PlayIcon` = `IconPlayerPlayFilled` (A2's; the inspector's preview overlay was the outline glyph) |
| A1 CR-3 | `centerApi.flashItems(ids)`; the grid registers `flashTiles` | done |
| A1 CR-4 | bundle budget | done without raising it (§3) |
| A2 (deviation) | `detail.play-toggle` declared in core, its Space binding moved into `DEFAULT_BINDINGS` (40 bindings now; `keymap.spec.ts` updated, Space in detail now conflicts like any core key) | done |
| A2 CR-2, A4 CR-1 | `optimizeDeps.include: ['react-dom/client']` in the browser project | done; no reload in any full run since (§6) |
| A2 CR-3 | the slice touch test waits for each tile to hydrate before reading its name | done |
| A2 CR-4 | merge small shared chunks | measured, not kept (§3) |
| A2 CR-5 | `morph.ts`: `transition.ready?.catch(() => {})` for skipped transitions | done, with a unit test that fails without it (an unhandled `AbortError`) |
| A2 CR-6 | docs: Space play/pause in detail (interaction-spec §5 and §8, system.md §6); deep links outside the view (interaction-spec §5) | done |
| A3 CR-0 | bundle headroom (also A3 review finding 3) | 144.94 kB with A3 (§3) |
| A3 CR-1 | grid tiles call core's `useMediaDraggable` (enabled while FileBird is active, collection order for multi-item drags), `user-select: text` against the UA sheet's `none` on `draggable="true"`, dimmed while carried through a new `useIsMediaDragged(id)` in `core/dnd` (all carried tiles, not only the source); `features/folders/tileDragSources.ts`, its call in `Column.tsx` and its CSS deleted. The `data-mm-drag-source` attribute stays, so A3's drag specs run unchanged | done |
| A3 CR-2 | filmstrip cells draggable the same way (and dimmed, selectable as far as CSS goes) | done, with a browser test |
| A3 CR-3 | `MediaDragPreview`: up to three stacked thumbnails (cached items through `pictureFor`, an icon otherwise), "Move N items", "Drop on a folder" over nothing, the accent colour for a valid target and `--danger` for a refusal; own CSS module, no Mantine `Paper`/`Portal` | done, with a browser test |
| A3 CR-4 | folder icons into `core/ui/icons.ts` (`ChevronRightIcon`, `ChevronUpIcon`, `ColorNoneIcon`, `FolderPlusIcon`, `ColorIcon`; the rest already there as `ChevronDownIcon`, `MoreIcon`, `FolderOpenIcon`, `MoveIcon`, `DeleteIcon`); `features/folders/icons.ts` deleted | done |
| A3 CR-5 | the `?` sheet doesn't exist yet (B5). Folder bindings (N, R, M, ContextMenu) carry `folders: true`, and `sheetBindings({ filebird })` leaves them out without FileBird; B5's sheet should list `sheetBindings()` | done in core (unit test); B5 uses it |
| A3 CR-6 | `items.delete` ownership | for B3: take the command over from `features/folders/index.tsx` and run `folders.remove-from-folder` for the in-folder, non-Shift case |
| A3 CR-7 | `panels.toggle-folders` without FileBird toasts "Folders need the FileBird plugin on your WordPress site." instead of being unavailable | done, with a browser test |
| A3 CR-8 | the `CONTROL_SELECTOR` comment in `dispatch.ts` | done |
| A3 CR-9 | `test/spikes/c3/` deleted; spikes/C3.md says where the code went | done |
| A3 CR-10 | `toast.tsx`: Mantine's close button named "Dismiss"; A3's axe exclusion removed from `e2e/support/folders.ts` | done (browser test; the folder e2e runs axe on toasts again) |
| A3 CR-11 | `react-dom/client` in `optimizeDeps.include` | done (same as A2 CR-2) |
| A4 CR-3 | docs: `E` and `A` reserved for the inspector (interaction-spec §8, inspector.md §8) | done |
| A4 CR-4 | B1 hooks the Edit tab through `registerEditPanel` / `setEditUnsaved` | for B1, no change here |

**Gap found while merging, then closed at the coordinator's request:** A1 declared `inspector.edit-details`
for A4 to implement, but A4 (in parallel) didn't. It is now implemented in `features/inspector/index.tsx`:

- **Run:** opens the inspector on Info (expanding it if collapsed; the compact sheet below 900 px, through
  core's `selectInspectorTab`) and focuses the first field: the batch panel's Title for several targets, the
  item's own Title for one. The batch panel's fields take a focus request without an item id
  (`FocusRequest.id: null`), as the single-item fields take `A`'s and Save & next's.
- **Availability:** `can('edit-meta')` (online, the plugin's batch feature), then the targets' cached
  `perms.edit`: unavailable with the first refusal's reason when every target is known and none may be
  edited (an Author's selection of others' media); unknown items count as editable (the server refuses per
  item). "Select media first" with nothing targeted.
- **Tests** (`features/inspector/editDetails.browser.spec.tsx`, the whole app): three tiles selected, the
  selection bar's Edit details opens the collapsed inspector on the batch panel ("Editing 3 items") with
  focus in Title and the selection untouched; one target focuses the item's Title; unavailable with nothing
  targeted, for an Author's selection of others' media (available again once one of their own joins), and
  offline.
- **Cost:** the initial chunk went from 144.94 to 146.14 kB (the command lives in the initial inspector
  entry; the rest is re-chunking).

## 3. Bundle budget (D31): 157.19 → 142.50 kB, and 144.94 kB with A3; budget kept at 150

| State | Initial media-manager chunk (gzip) |
|---|---|
| fc9999d (M2) | 145.95 kB |
| A1 alone (its handoff) | 153.57 kB |
| A1 + A2 + A4 merged, CRs applied | **157.19 kB** |
| + lazy login form, session dialogs and confirm dialog | **142.16 kB** |
| + the race fix (§4) and the rest | **142.50 kB** |
| + A3 merged with its CRs | **144.94 kB** (5.06 kB headroom) |

**What it took.** Mantine's `Modal` was in the initial chunk twice: the confirm dialog (`core/ui/confirm.tsx`)
and the session dialogs in `AuthGate`. `ModalRoot` imports `ScrollArea` (for an identity check), and the Modal
brings a focus trap and `react-remove-scroll`; the login form brings `PasswordInput` and `Alert`. Now:

- `core/ui/ConfirmDialog.tsx` is a lazy chunk; `confirm()` and `<ConfirmHost/>` stay in core and render it
  under `Suspense`;
- `app/auth/LoginScreen.tsx` and `app/auth/SessionDialogs.tsx` are lazy; the session dialogs are prefetched
  when idle once logged in, so the session-expired dialog doesn't need the network when it shows; they mount
  from the first time one opens, so Mantine can animate them closed;
- the boot screens were lazy already.

New browser tests cover the lazy login screen, the session-expired dialog after a 401, and the confirm
dialog.

**What didn't help.** Rolldown `codeSplitting.groups` (one Mantine group, one core group): without
`entriesAware` they hoisted Mantine and core into the *entry* chunk (253 kB entry; `bundle-budget.mjs`
caught it, the measurement stays honest); with `entriesAware` the initial chunk was 145.39 kB, worse than
the default 142.16. Merging every initial chunk into one would save at most 3.4 kB (126 → 122.5 kB of JS,
measured by concatenation) and would need a hand-maintained module list. `vite.config.ts` is unchanged.

## 4. The data race behind "edits alt text with autosave"

**Symptom** (A2, A4): in full e2e-mock runs the M2 slice test sometimes announced "Title saved" but showed the
old title, with the alt text empty again.

**What the traces showed.** The failure didn't reproduce in this integration: 3 full e2e-mock runs, one more
inside `dev/run test all`, and 24 targeted repeats of that test (with `--trace on` /
`retain-on-failure`, alone and alongside the slice and A4 specs) all passed it. The one failure the stress runs caught was a different flake with the same shape (§5,
first row): a click on a tile while its picture was being swapped in never reached the tile. So there is no
trace of the slice failure itself. The data-layer race A4 suspected is real, though, and the fake backend
reproduces it deterministically:

**Cause.** `optimistic()` cancelled the item reads in flight when a write started, and nothing else
guarded against reads. A read that *starts while the write is on its way* (an invalidation, a chunk
scrolling in, the rev poll's refetch, a new observer of an invalidated query), or one whose cancel came
too late, can be answered by the server from its state before the write (WordPress serves requests in
parallel). If that answer arrives after the write's response, the chunk or item `queryFn` seeds it into
every per-id entry and the saved values are overwritten until the next refetch. The batch path had no
guard at all: `bulkBatch` applies its snapshots on arrival, and any overlapping read could undo them.

**Fix** (`core/data/itemWrites.ts`): every write of item fields records itself per item on a logical clock
per `QueryClient`: `optimistic()` with the new `writes` option (`saveItemMeta`, `attachItem`), and each
`items/batch` chunk in `bulkBatch` (so A4's batch edits, Undo and batch attach too). It is recorded before the
cancel and ends as soon as the response or error arrives, before the result is applied (and before a
rollback, whose refetch must win). The item and chunk `queryFn`s note the clock when they send; on arrival
an item a write overlapped (still in flight, or ended after the read was sent) isn't seeded, and the read
holds the cached copy instead. Reads sent after the write ended apply normally, so changes made elsewhere
still arrive.

**Test** (`core/data/itemWrites.spec.ts`, over the fake backend): a fetch wrapper lets the fake answer a GET at
once (so it reads the state of that moment) but delivers it only on release, and holds the PATCH or batch
until released. A refetch started during the write, answered before it and delivered after it, used to put
the old title back in the full item, the tile and the chunk; now the saved value stays. Before the fix both
the single-item and the batch case failed; a third case checks that a read sent after the write still
brings a change made elsewhere.

Folder moves write `folder` the same way: after A3 merged, `bulkAssign` records every id as written from the
start (the caller moved them optimistically) and ends each chunk's ids when that chunk's response arrives,
before `applyRev` refetches them, so a skipped item still comes back with that refetch. A fourth case in the
spec covers it (it fails without the guard).

## 5. Flakes found and fixed

| Flake | Cause | Fix |
|---|---|---|
| A4 mock e2e "batch editing": "Editing 2 items" never showed (caught with a trace) | the first click landed on a "Loading" tile; its placeholder was swapped for the picture between press and release, and Chromium drops such a click | `.media` and `.card` take no pointer events, so the tile is always the target (`Grid.module.css`); browser test: the hit target at a tile's centre is the tile (fails without the CSS) |
| slice "opens detail with Enter… Back" (A2) | unhandled `AbortError` from a skipped view transition | A2 CR-5 (§2) |
| slice touch test (A2, A3) | names read before hydration | A2 CR-3 (§2) |
| grid "keeps the scroll position when the same query refetches for a new rev" (failed 2 of 2 full client runs here) | the focus refetch joined a rev poll already in flight that left before the edit | the test polls until a poll sees the new rev |
| usage "lists its places…" | `findByTestId` returned the count while it still said "Loading…" | waits for the text |
| detail specs in `dev/run test all` | the lazy overlay's first transform in Vitest took over a second under load | the specs wait up to 5 s for the Detail region |

**Three Ctrl+clicks selected two tiles (checked at the coordinator's request): a test artifact, not an app
bug.** It happened in the Edit details spec, right after the test collapsed the inspector.
- **What happened:** collapsing the inspector widens the grid, and the justified layout moves tiles between
  rows. Rows are keyed by index and tiles by id within their row, so a tile that changes rows is a new
  element. The test had taken the tile elements before that re-layout. testing-library's `user-event`
  dispatches its events to the element it is given, so the third "click" went to a detached node, and no
  event reached the document at all. An event log showed this: pointerdown, mousedown, mouseup and click for
  the first two tiles, nothing for the third, and `isConnected` false on the third tile.
- **Real clicks work:** `features/grid/ctrlclick.browser.spec.tsx` drives Chromium's own mouse (Vitest's
  browser `userEvent`, through Playwright). Three quick clicks with Control, and with Meta, select three
  tiles, both normally and right after the inspector collapse. Each click reports `detail` 1, so no click
  counts as a double-click. The selection bar at 2 selected covers the toolbar without moving the grid. A3's
  drag sources didn't swallow any click.
- **WebKit:** not run. This machine has only Chromium for Playwright.
- **Known limitation, not fixed:** a tile that changes rows is remounted. A press whose tile is remounted
  before the release is lost, as with the "Loading" swap. That can only happen while the grid re-lays out
  under the pointer, such as during the inspector's or folder column's open/close transition. Avoiding it
  would mean keeping tiles out of the row elements (for example `aria-owns`), which is a bigger change to A1's
  grid.

## 6. Gate (A1 + A2 + A4)

| Step | Result |
|---|---|
| `npm run check`, `npm run typecheck -w client -w e2e` | clean |
| `npm run test -w client`, twice in a row | 83 files, 1001 tests, pass both times (after the fixes in §5); no "reloaded a test" |
| `dev/run test unit`, twice (runner) | server 806, client 1001, pass both times |
| bundle budget | 142.50 kB of 150 |
| `dev/run test plugin-static`, `up test`, `seed small` | pass |
| `dev/run test e2e-mock`, three times | 63 passed each time |
| `dev/run test all` | typecheck, plugin-static, plugin-contract, server-live, e2e-mock (63), e2e-live (40, 2 skipped: the archive flow, the live seed has no archive) pass. lint failed on an untracked scratch script of mine (deleted) and unit on two detail specs (§5); both re-run clean in the runner |
| 50k perf flow alone (`--workers=1`, load average 4.8–6.8) | **0 long tasks over 50 ms** scrolling (max 0 ms); switches: density 0, layout 0, select all 0, Esc 0, the type chip 1 (59 ms); with the mock's placeholder pictures 0 |

### Final gate (all four tracks, `mm/m3-int` @ the A3 CR batch)

| Step | Result |
|---|---|
| `npm run check`, `npm run typecheck -w client -w e2e` | clean |
| `npm run test -w client`, twice in a row | 90 files, 1119 tests, pass both times; with Edit details (§2): 91 files, 1122 tests, twice |
| bundle budget | **144.94 kB** of 150; with Edit details **146.14 kB** |
| `dev/run test plugin-static`, `up test`, `seed small` | pass |
| `dev/run test all` | **exit 0**: lint, typecheck, unit (server 806, client 1119), plugin-static, plugin-contract (208 passed, 1 skipped, in each of the three installs), server-live (49), e2e-mock (75), e2e-live (48 passed, 2 skipped: the archive flow) |
| `dev/run test e2e-mock`, three times | 75 passed each time; once more with Edit details (after `up test`, `seed small`): 75 passed |
| 50k perf flow alone (`--workers=1`; load average 11.5 at the start, 7.9 at the end, from other worktrees) | **0 long tasks over 50 ms** scrolling (max 0 ms); switches: density + 1 (59 ms), layout 0, select all 0, Esc 0, the type chip 1 (71 ms); with the mock's placeholder pictures 0 |
| `dev/run down` | done, volumes kept |

## 7. Open questions from the handoffs

**A1**
1. ~~Bundle budget~~ (kept; §3).
2. Focus without selecting: interaction-spec §1 says a modifier moves focus only, but Ctrl/Cmd+arrows break
   the layout rule. Drop it from the spec, or allow Ctrl/Cmd+arrows?
3. Pending upload tiles before the item exists (system.md §1): B2 needs a way to add pending rows to the
   collection, or the tile appears only once the item exists.
4. Should the "just changed" flash also play on the user's own saves next to the tile?
5. Delete in a folder: the menu with both choices is B3's.
6. ~~Dragging tiles~~ (A3 CR-1, §8).
7. Retry by keyboard: is the tray's Retry (B2) enough, or should Enter on a failed tile retry?
8. ~~The 50k perf flow on a quiet machine~~ (§6: passes).

**A2**
1. Should the detail More menu's Move / Edit / Delete act on the item on stage only (an `ids` argument),
   rather than on the selection when several are selected?
2. Deep links outside the view: keep "Not in this view" without stepping, or clear the filters, or step from
   the sort position?
3. Video playback is e2e-tested with audio only (Chromium without proprietary codecs can't play the H.264
   fixtures). Fine?

**A4**
1. Save & next at the end of an alt pass with earlier items left: step back to the previous remaining item?
2. `A` on a non-image: keep it unavailable, or fall back to Title (inspector.md §4)?
3. Batches over 1,000 items: "Mixed values" with a note, or hydrate everything?
4. ~~The e2e-mock flake~~ (§4).

**A3**
1. In the Move dialog's search, the root option ("Uncategorized" / "Top level") stays when its own label
   matches, as in the prototype. Keep?
2. The Move dialog's hint line ("↑ ↓ choose · Enter move") is read by screen readers too. Hide it from them?
3. Opening a folder below 900 px closes the drawer. Keep, or leave it open?
4. Esc in the tree clears the grid's selection (core's `selection.clear`). Should it move focus back to the
   grid instead?

**Integration**
1. ~~`inspector.edit-details` has no implementation~~ (implemented, §2).
2. Folder drags from the filmstrip (A3 CR-2) were added here; the iPad feel review should try a long-press
   drag on a filmstrip cell, since the strip also scrolls sideways by touch.

## 8. A3 (folders)

Merged after its review fixes with no conflicts; its CRs are in §2. Integration work on top:

- **Tests that assumed folders weren't built:** A1's selection-bar test and A2's More-menu test expected Move
  to folder disabled; it is A3's command now, so they assert it enabled (Edit details, Delete outside a
  folder and, with the inspector mocked, Edit image stay disabled).
- **Races under load** (full parallel client runs, while the bundle budget builds the client): A3's
  "N from the grid" checked the server while its row was still the pending one (now waits), and the Move
  dialog's triage test read the server right after the tile left optimistically (now waits) and gave its
  second move's round trip one second (now five).
- **Deviations recorded by A3:** no Undo for folder delete; the column doesn't open when a drag nears the left
  edge; the tree claims its keys with `preventDefault()` rather than `data-mm-local-keys`; commands stay
  available without FileBird or in per-user mode so every trigger explains itself; header New folder enabled
  in per-user mode; draggables `user-select: text`; `folders.expand-all` / `folders.collapse-all` are new
  commands; folder-move Undo PATCHes only the moved folder back; focus requests expire after 3 s.
- **For later tracks:** B3 takes `items.delete` (CR-6) and the Trash row's count (`setTrashRowCount()`); B5's
  `?` sheet lists `sheetBindings({ filebird })` (CR-5).

## 9. Deviations recorded by the tracks

- **A1:** `e2e/mock/a1-flows.ts` (shared flows outside the per-track spec names); every month in "+ Filter";
  the Missing alt chip stays at 0; clicking the active type chip turns it off; menu items are `menuitem` +
  `aria-current` (Mantine forces the role); the perf budget is enforced only when the perf flow runs alone.
- **A2:** `detail.play-toggle` on Space (now in core, §2); `e2e/support/a2-detail.ts`; touch panning without
  momentum (`touch-action: none` on the stage); pinch settles on the discrete zoom levels; swipe is
  touch-only; the More menu's `withInitialFocusPlaceholder={false}` plus a key layer; the filmstrip renders
  its own cell rather than A1's `Tile`; cell names include the badge.
- **A4:** batch values and permissions from the first 1,000 selected (usage and attach: 500); an empty batch
  field never commits; `A` on a non-image unavailable; the post picker is a plain anchored dropdown (Mantine's
  Popover cost 2.5 kB initial); no Visual Portfolio placeholder in the mock; folder paths built in two places
  (`folderName.ts`, `info/details.ts`); Delete passes `{ fromLibrary: true }`.

## 10. Commits on `mm/m3-int`

See `git log fc9999d..mm/m3-int`. Besides the four merges: the CR batch, the lazy chunks for the bundle, the
race fix with the flake fixes, the detail spec wait, the A3 CR batch, Edit details, and this note.
