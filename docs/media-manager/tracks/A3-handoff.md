# Track A3 (M3): folders: handoff

Branch `mm/a3`, from `feature/media-manager` @ fc9999d. Scope: [A3.md](A3.md), following
[M3-wave-A.md](M3-wave-A.md). One helper (high effort) built the Move to… dialog on exclusive files. A second helper
started the e2e specs, but its files collided with the track owner's; the track owner wrote the final e2e
specs and ran the gate. The track owner reviewed and committed their work.

## 1. What works

All of [folders.md](../design/specs/folders.md) except what §3 lists, in `client/src/media-manager/features/folders/`
and `core/data/folders.ts`.

| Deliverable | Where | Tests |
|---|---|---|
| **The column:** header (FOLDERS, New folder, ⋯ options, Hide), Find folder, the per-user notice, then All files, Uncategorized, the Trash row (when `bootstrap` says the Trash is on), a separator and the tree. Counts direct or nested (⋯ menu, a per-user preference in localStorage keyed by the WordPress user id, with the expansion); All files and Uncategorized always direct. Expand all / Collapse all. Loading skeleton, load error with Try again, "No folders yet" with New folder | `Column.tsx`, `ColumnMenus.tsx` (`OptionsMenu`), `entries.ts`, `store.ts`, `Column.module.css` | `column.browser.spec.tsx`, `entries.spec.ts` |
| **The tree:** a flat ARIA `tree` virtualised with TanStack Virtual (lifted from spike C3): `aria-level/posinset/setsize/expanded/current/selected`, one Tab stop (last focused row, else the viewed folder, else the first), pinned while focused, dragged or edited. ↑/↓, Home/End, →/←, Enter/Space open (`?folder=` replaced, D16; selection cleared by core sync; leaves detail; closes the drawer below 900 px). Delete/Backspace, N, R, M and ContextMenu on the focused row. The tree claims its keys with `preventDefault()` instead of `data-mm-local-keys`, so F, ?, Ctrl/Cmd+Z and Ctrl/Cmd+K keep working inside it. A deep link reveals its folder | `Tree.tsx`, `model.ts` | `column.browser.spec.tsx`, `model.spec.ts` |
| **Search:** client-side, case-insensitive; matches and all their ancestors shown expanded (saved expansion untouched), the match marked, All files / Uncategorized hidden; "No folders match “x”" with Clear search; the count announced after a pause; Esc clears, a second Esc leaves; ↓ enters the tree; Enter opens the first match | `model.ts` (`searchFolders`, `highlightParts`), `Column.tsx` | as above |
| **Create and rename in place:** N (global: in the viewed folder; in the tree: in the focused one), the header button, the empty-tree button and the menus. The input row is the parent's last child; ancestors expand and the search clears. Enter or blur saves, Esc or an empty name cancels, one input at a time (starting another saves the first). A pending row shows while the create runs; the new row takes focus and flashes; the view doesn't switch. Taken names: "A folder named “Logos” is already there, so this one is “Logos (1)”." Rename: R, double-click, menu; optimistic; "Renamed to “X”" (or the suffix sentence) with Undo | `actions.tsx`, `NameInput.tsx` | `operations.browser.spec.tsx` |
| **Delete:** Delete/Backspace on a row or the menu; the confirm is worded from the real numbers ("Delete “Blog” and 3 subfolders?", "…The 25 files in them move to Uncategorized. No media is deleted.", "Deleted folders can’t be restored.", "Delete 4 folders"); focus returns to the row on cancel. Inside the deleted subtree you land in Uncategorized. Toast "Deleted “Blog” · 25 files moved to Uncategorized", no Undo | `actions.tsx` (`confirmDeleteFolder`, `deleteWording`) | `operations.browser.spec.tsx` |
| **Context menu:** right-click, the ContextMenu key on a row, and the global `ContextMenu` for the viewed folder: New subfolder (N), Rename (R), Move to… (M), Colour… (Pro), Delete folder (Del); All files and Uncategorized offer New folder. Focus returns to the row on Esc. Radio items in ⋯ are `menuitemradio` with `aria-checked` | `ColumnMenus.tsx` | `operations.browser.spec.tsx`, `column.browser.spec.tsx` |
| **Drag and drop:** tiles are made draggable from the folder feature's side through core/dnd's drag data (§4 CR-1): a selected tile carries the selection in collection order, an unselected one only itself; dragged tiles dim; core's preview reads "Move N items · to “X”", "to Uncategorized" or "All files isn’t a folder". Folder rows nest (middle), reorder (top/bottom quarter, a select-ring line; an open folder's bottom edge means inside), move to the top level (the empty tree area), and refuse with the reason (into itself or its subtree, onto All files / Uncategorized) in their own in-page preview. Pro's name sort offers only "inside". Auto-expand after 700 ms, edge auto-scroll. Toasts with Undo ("Moved 3 items to “Press kit”", "Already in “X”", "Moved “Team” into “Brand”" / "to the top level"); folder Undo PATCHes the old parent and position (server-api.md §7.11) | `Tree.tsx`, `tileDragSources.ts`, `actions.tsx` | `dnd.browser.spec.tsx` |
| **Move to… (M):** a Mantine dialog with a combobox over a listbox: Uncategorized (Top level in folder mode), Recent (≤ 3 this session), every folder indented with Pro colours; flat matches with their path while searching, and "Create folder “query”" (a top-level folder, then the move). Current marked and skipped by ↑/↓; Enter, the button or a double-click moves; Esc, Cancel or the scrim closes and focus returns. The triage flow: moved items leave the selection and focus moves to the next tile; in detail mode the stage shows the neighbour or returns to the grid. Also from the selection bar or inspector through `folders.move-to`, and in detail mode | `MoveDialog.tsx`, `moveOptions.ts` (helper) | `MoveDialog.browser.spec.tsx`, `moveOptions.spec.ts` |
| **Remove from folder:** `Delete` inside a real folder moves the targets to Uncategorized: "Removed N items from “X”" with Undo, focus to the next tile; outside a folder `items.delete` stays "Not available yet" for B3 (§4 CR-6). Also a command `folders.remove-from-folder` | `index.tsx`, `actions.tsx` | `operations.browser.spec.tsx` |
| **Scenarios:** Pro (D42/D23): colours tint the icon (outline and a 28 % fill) in the tree, the Move dialog and the folder drag preview, written only through the PATCH `color` (FileBird's own function, plugin side) when `mode.colorsWritable`; the ⋯ sort (manual, A–Z, Z–A, natural). Lite hides stored colours. Per-user (D25): the notice; browsing works; New, rename, delete, drags, Move to… and menus explain in a toast. No FileBird: no column (the shell), and N/R/M/Delete-in-folder and drags explain "Folders need the FileBird plugin on your WordPress site." Offline: changes refused with "WordPress can’t be reached, so folder changes can’t be saved right now." Author (D41): counts are the server's (per D41 they match the collection), moves of others' items are skipped by the server and the toast says "N items skipped: you can only change your own media"; they are not removed optimistically | `actions.tsx` (`guardFolderChange`), `Column.tsx` | `column.browser.spec.tsx`, `dnd.browser.spec.tsx` |
| **Trash row integration point (B3):** the row opens `?folder=trash`; B3 can show a count with `setTrashRowCount()` | `trashRow.ts` | `column.browser.spec.tsx` |
| **Data layer:** `createFolder`, `updateFolder` (optimistic rename/move/colour with rollback), `deleteFolder`, `assignItemsToFolder` (optimistic `optimisticMove` + chunked `bulkAssign`, rolled back only when nothing reached the server), `restoreItemFolders` (Undo grouped by previous folder) | `core/data/folders.ts` | through the browser specs |

### Commands

```sh
npm ci
npm run check
npm run typecheck -w client -w e2e
npm run test -w client                          # unit + browser
node client/scripts/bundle-budget.mjs           # after npm run build -w client
cd client && npx vitest run src/media-manager/features/folders   # just this track
dev/run test plugin-static
dev/run up test && dev/run seed small && dev/run test e2e-mock e2e-live
```

Mock: `npm run dev:mock -w client`, then `?view=library` (`&mock-scenario=pro`, `per-user`, `no-filebird`,
`author`, `trash`, `offline`, `large` for 300 folders).

## 2. Tests and gate

Run in this worktree (Docker available):

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm run typecheck -w client -w e2e` | clean |
| `npm run test -w client` | **63 files, 862 tests pass** (after the review fixes, commit 1945b93) |
| This track's specs | unit: `model.spec.ts` 34, `entries.spec.ts` 9, `moveOptions.spec.ts` 29; browser: `column` 18, `operations` 15, `dnd` 15, `failures` 11, `MoveDialog` 16 |
| Bundle budget (D31) | initial media-manager chunk **149.51 kB of 150 kB** (baseline at fc9999d: 145.95). See CR-0 |
| `dev/run test plugin-static` | pass |
| `dev/run up test`, `dev/run seed small` | ok |
| `dev/run test e2e-mock` | **43 passed** (the 10 new folder tests: 4 flows × light/dark plus the per-user and no-FileBird scenarios × light/dark, with axe; the folder spec alone also 36/36 with `--repeat-each=3`) |
| `dev/run test e2e-live` | **22 passed** (the 8 new folder tests plus the existing smoke and slice tests) |
| `dev/run down` | done, volumes kept |

The table is the gate after the review fixes: `plugin-static`, `up test`, `seed small`, `e2e-mock`,
`e2e-live` from a clean start, all exit 0, with no other `dev/run` in this worktree.

**One flaky run, not this track's:** one full e2e-mock run failed the slice's touch test in light mode (`slice.ts:260`: it read the tile's name while the tile still said "Loading"); the rerun passed 43/43.

**What the e2e runs found and fixed** (commit ad4edb3): a just-created folder didn't get focus when its row arrived after the focus request (the request now waits for its row); Mantine's menus put a focusable initial-focus placeholder inside `role=menu` (axe `aria-required-children`; `withInitialFocusPlaceholder={false}` now, focus goes to the first item); Mantine's red "Delete folder" item and yellow notice title were under 4.5:1 in light (now `--danger` and the warn tokens).

**e2e** (`e2e/support/folders.ts`, run by `e2e/{mock,live}/a3-folders.spec.ts`): opening folders by click (`?folder=` replaced, no new history entry) and with the tree's keys, search, create / rename with Undo / delete with the confirm, the context menu, Move to… (M) with Undo, remove from folder (Delete), dragging a tile onto a folder with Playwright's real mouse (preview, toast, Undo), and in mock the per-user and no-FileBird scenarios; axe on the column, the menu, the confirm and the Move dialog. Live runs only touch folders they create (`e2e-…`), delete them, and put moved items back (Undo, then the API as a fallback).

### Review fixes (commit 1945b93)

An independent review found no critical issues, 3 important and 9 minor. Finding 3 (the bundle) went to
the integration agent (CR-0). The others are fixed, each with a test:

| # | Fix | Test |
|---|---|---|
| 1 | Focus requests are cleared from the store once handled and expire after 3 s if their row never shows; the tree stays mounted (`hidden`) while a search matches nothing, so the search box's `aria-controls` keeps its target and a remount never replays an old request | `column` › search (focus stays in the box through "zzz", backspacing to a match, typing `n`, Clear search) |
| 2 | Failure and rollback paths: rename, a move the server refuses as a cycle, a Pro colour, a create (pending row gone), an assign that never reached the server (items, counts, selection and focus back), a partly done assign (5000-id chunks: what moved stays with Undo, "couldn’t move the rest"), offline refusals, an Undo offline, Undo after later changes (items; a folder; a cycle) | `failures.browser.spec.tsx` (11) |
| 4 | A move that never reached the server restores the selection, focus and the item on stage | `failures` › nothing reached the server |
| 5 | A folder dropped on the Trash, the name input or a pending row is refused ("Folders can’t go here") | `dnd` › the Trash row |
| 6 | The "just changed" flash plays once per change (a module-level last-played seq) | `column` › flash once |
| 7 | `.twisty` and `.icon` are no longer `-webkit-user-select: none` | `column` › selectable twisty and icons |
| 8 | A deep link to a folder far down the tree scrolls it into view once its row exists | `column` › deep link (the large mock, all expanded) |
| 9 | Deviation recorded (§3) | — |
| 10 | Undo that can't run says why once: refusals are thrown as sentences (`FolderActionError`), request failures are reworded, and a move that would make a cycle in the tree as it is now reads "A folder can’t move into itself or one of its subfolders." | `failures` › Undo offline, Undo cycle |
| 11 | The selection drag asserts the request's collection order and the one right toast; the e2e create / rename / delete test runs in `try/finally`, and every live test deletes its `e2e-…` folders through the API whatever failed | `dnd`, `e2e/support/folders.ts` |
| 12 | No native `title` tooltips: a truncated name shows its full text in an in-page tip (aria-hidden; the name is the row's accessible name already); colour swatches use Mantine's Tooltip | `column` › truncated name |

Browser specs must not run concurrently in one worktree: `client/vitest.config.ts` forces a fresh
`optimizeDeps` bundle into the shared `node_modules/.vite`, and two runs break each other ("Failed to fetch
dynamically imported module"). Mantine notifications also persist between tests; the folder specs clear them
(`features/folders/test/cleanup.ts`).

## 3. What's missing, and deviations

- **No Undo for delete**, as specified (FileBird can't restore ids).
- **The column opening while a drag nears the left edge** (folders.md §12 request 8) is not done.
- **The folder drag preview** is this feature's own; the media drag preview is core's and has no thumbnails
  yet (CR-3).
- **The tree doesn't use `data-mm-local-keys`:** it claims its keys with `preventDefault()`, so global keys
  that the tree doesn't use (F, ?, Ctrl/Cmd+Z, Ctrl/Cmd+K, I, U) still work with focus in it. Single-key
  global shortcuts it doesn't claim (X, A, E, L, +, -) also reach the grid from the tree.
- **Commands stay available without FileBird or in per-user mode** so that every trigger explains itself in a
  toast (folders.md §9). A consequence: `useCommand('folders.move-to').enabled` is true there; the selection
  bar should hide Move to folder without FileBird (interaction-spec §6, A1).
- **Header New folder stays enabled in per-user mode** (the prototype disabled it) so the click explains why.
- **Draggable tiles and rows are `user-select: text`:** browsers' UA sheets make `draggable="true"` elements
  `user-select: none`, which on iPadOS keeps a trackpad click from handing the page the keyboard. The column is
  a `data-mm-no-select` region, and tiles already were. A browser test guards it.
- **`folders.expand-all` / `folders.collapse-all`** are new commands (for the palette, B5).
- **Undo of a folder move PATCHes only the moved folder back** to its old parent and position (server-api.md
  §7.11: "position counted without the folder itself, as taken from the tree before the move"). folders.md
  §6/§11 describe restoring a snapshot of the whole tree's parents and order; with later reorders in between,
  those stay. If the tree changed so that the way back would make a cycle, the Undo is refused with that
  sentence.
- **A focus request expires after 3 s** if its row never appears (e.g. hidden by a search), so it can't take
  focus much later.

## 4. Change requests

- **CR-0, bundle budget (orchestrator):** this track takes the initial chunk from 145.95 to 149.51 kB. Only
  about 0.5 kB is the feature's own initial code (index.tsx and runtime.ts; the store, the column, the
  actions and the dialog are lazy chunks of 15.1, 6.5 and a few kB). The rest is Rollup's chunking: lazy
  chunks that use core modules (core/data, core/ui, Mantine components) pull those exports into shared chunks
  the initial chunk imports, and the extra chunk boundaries compress worse. Experiments (stubbing the column
  import: 148.49; stubbing the actions import too: 146.47; stubbing `confirm` alone made it larger) showed no
  single culprit. With A1, A2 and A4 merging first, the budget will likely be exceeded; consider
  `build.rollupOptions.output.experimentalMinChunkSize` or a `manualChunks` rule for core/ and Mantine in
  `client/vite.config.ts`.

- **CR-1, A1 / `features/grid/Tile.tsx`:** call core's `useMediaDraggable(ref, id, { getOrder })` on the tile
  (with `getOrder: () => getCurrentCollection()?.ids ?? []`), give tiles `-webkit-user-select: text;
  user-select: text` (see §3), and dim them while `dragging`. Then delete `features/folders/tileDragSources.ts`
  and its one call in `Column.tsx` (`useEffect(() => attachTileDragSources(), [])`) plus the
  `[data-mm-folder-drag]` / `[data-mm-drag-source]` rules in `Column.module.css`. Until then the folder
  feature attaches the draggables itself and skips any tile that is already `draggable="true"`, so applying the
  CR first is safe. Note that core's `useMediaDraggable` should only be enabled when FileBird is active
  (nothing to drop on otherwise).
- **CR-2, A2 / filmstrip:** filmstrip cells are draggable too (folders.md §6): `useMediaDraggable` on each cell,
  with the same `user-select` override.
- **CR-3, `core/dnd/MediaDragPreview.tsx`:** the spec's preview: up to three stacked thumbnails (from
  `pictureFor`), the title "Move 3 items", a target line that reads "Drop on a folder" with no target, the
  accent colour for a valid target and `--danger` for a refusal (`refusal` set). Optionally a `valid` flag in
  `MediaDropTarget`.
- **CR-4, `core/ui/icons.ts`:** add the icons in `features/folders/icons.ts` (FolderOpen, FolderPlus,
  ChevronRight/Down/Up, Dots, FolderSymlink, Palette, Trash, Circle) and delete that file.
- **CR-5, keymap without FileBird (folders.md §9):** N, R, M aren't registered nor listed in `?` when FileBird
  is missing. Today they are in `DEFAULT_BINDINGS` and only toast. Suggest the `?` sheet (B5) leaves out the
  Folders group when `bootstrap.site.filebird` isn't active.
- **CR-6, `items.delete` (B3, M4):** this track implements `items.delete` for the in-folder case only (its
  `available()` is "Not available yet" elsewhere). B3 takes the command over: remove its `implementCommand`
  from `features/folders/index.tsx` and run `folders.remove-from-folder` for the in-folder, non-Shift case.
  The Trash row's count goes through `setTrashRowCount()` (`features/folders/trashRow.ts`).
- **CR-7, `app/runtime.ts` `panels.toggle-folders`:** without FileBird, F should toast "Folders need the
  FileBird plugin on your WordPress site." (folders.md §9) instead of being unavailable.
- **CR-8, `core/keymap/dispatch.ts`:** the comment on `CONTROL_SELECTOR` says the folder tree sits under
  `[data-mm-local-keys]`; it doesn't (§3).
- **CR-10, `core/ui/toast.tsx`:** Mantine's notification close button has no accessible name (axe `button-name` whenever a toast is open). Pass `closeButtonProps: { 'aria-label': 'Dismiss' }` in the backend's `show()`. The folder e2e excludes `.mantine-Notification-closeButton` from axe until then.
- **CR-11, `client/vitest.config.ts`:** Vite discovers `react-dom/client` late in browser runs ("optimized
  dependencies changed. reloading", "Vite unexpectedly reloaded a test"), and whichever spec runs first can
  fail. Add `optimizeDeps: { force: true, include: ['react-dom/client'] }` to the browser project. Seen in
  some full runs during the review fixes; the reruns passed 63/63 files.
- **CR-9, spike C3 (`client/src/media-manager/test/spikes/c3/`):** lifted into `features/folders/model.ts`
  (+ spec) and `features/folders/test/{dragDriver,seedFolders}.ts`; the spike folder can go.

## 5. Open questions

1. While searching in the Move dialog, the root option ("Uncategorized" / "Top level") stays in the list when
   its own label matches the query, as in the prototype. Keep?
2. The Move dialog's hint line ("↑ ↓ choose · Enter move") is read by screen readers too. Hide it from them?
3. Opening a folder below 900 px closes the drawer (so the grid shows). Keep, or leave the drawer open?
4. Esc with focus in the tree clears the grid's selection (core's `selection.clear`). Should it rather move
   focus back to the grid?

## 6. Commits

Branch `mm/a3` (not pushed):

- 2757c1f feat: folder column with a virtual tree, counts, search and menus (A3)
- d606a3a feat: drag and drop to folders and the Move to… dialog (A3)
- dd0185f fix: keep folder drag sources selectable, and the initial chunk lean
- 8cb2579 test: an Author's move skips others' media (A3)
- c0c8095 docs: add the A3 (folders) handoff note
- ad4edb3 fix: folder focus after create, and axe-clean menus and notice (A3)
- 438d49e test: folder e2e flows in mock and live, both schemes, with axe (A3)
- 08222c2 docs: A3 handoff with the e2e results
- 1945b93 fix: review findings on the folder column (A3)
- this update of the handoff note
