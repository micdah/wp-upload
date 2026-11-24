# Track F1 (client core runtime and shell): M1 handoff

Branch `mm/f1`, from `feature/media-manager` @ e09ac4f. Scope: the foundation APIs of
[plan §4](../implementation-plan.md#4-directory-layout-and-ownership), interaction-spec §1, §6, §8 and
§10, the shell, boot, login and session UI, and spikes C2 and C4. Everything lives in
`client/src/media-manager/{app,shell,core/{state,url,collection,commands,keymap,perms,ui,dnd,uploads}}`.
`App.tsx` needed no change (it keeps the `?view=` switch until M5).

## 1. What works

From the repo root (host, Node 24+):

```sh
npm ci
npm run check                                  # Biome: clean
npm run typecheck -w client                    # clean
npm run test -w client                         # F1's 171 unit tests (Vitest, node)
npm run build && npm run test -w server        # build + server tests (URL guards): pass
dev/run test lint                              # pass
dev/run test typecheck                         # pass
dev/run test unit                              # pass: server 349 tests, client 171 (14 files)
```

All `*.spec.ts` files are Node-safe, so they run unchanged in F3's `unit` project.

### Tested

- **Unit tests (Vitest, node):** 171 tests in 14 files, `core/**/*.spec.ts` (145 before the spike
  fixes; +26 in `keymap/dispatcher.spec.ts`, `ui/morph.spec.ts` and `ui/confirm.spec.ts`):
  - the URL codec (every param, lenient parsing, round trip, foreign params kept) and the history
    policy against an in-memory history (`core/url/memoryHistory.ts`): push on entering detail,
    replace for stepping, filters and folder (D16), `history.back()` when leaving a pushed entry,
    Back after a filter change in detail, deep links, navigations while Back is in flight, the
    browser's Back/Forward;
  - the selection rules (click, toggle, Shift ranges both ways, additive ranges, select all, clear,
    arrow modes, targets, hidden selected items, pruning);
  - the core store (persisted panels with sanitising, viewport-aware inspector and folder drawer,
    rail clicks, zoom steps, connectivity) and the URL ↔ store rules (folder change clears, filter
    change keeps, Back across a folder change, deep-link focus, detail resets zoom and overlays);
  - the keymap: the layout rule over all 39 default bindings and forbidden keys, conflicts, a US/DK
    event matrix (`?`, `+` shifted and unshifted, Caps Lock, Shift+letter, Ctrl/Cmd, Ctrl+Shift+Z),
    AltGr/Option rejection (Ctrl+Alt on Windows, `AltGraph` on Linux), IME, modes, suspension (text
    field, modal, popup, local keys, inert/suspended), Esc layering, repeats, unavailable commands;
  - `can()` over the bootstrap fixtures (normal, Author, per-user, no FileBird, Pro, Trash, missing
    plugin features, offline, item states) and `partition()`;
  - the command registry, the undo registry and `toast()`/`undoLast()`, collection row decoding,
    the media drag payload, and the upload transport (chunked job polling, cancel, error mapping) and
    tile upload state;
  - the spike fixes: Enter/Space on a focused control are left to it (and not `preventDefault`ed);
    the Esc layer and focus context snapshotted at capture (a layer gone by bubble time still takes
    its Esc); which expanded triggers count as popups; `morph` calls `to` under reduced motion and
    without the API, names and clears the hero, gives up after 150 ms, survives a skipped
    transition; `confirm()` queueing and focus return to its opener.
- **The spike harnesses against the fixed core:** C4's Playwright matrix now passes every scenario
  in Chromium, Firefox and WebKit with core's own dispatcher and `confirm()` (it failed S2g, S4,
  S11a and S11b before), except S10, a Popover without a key layer, which fails by design. C2's
  harness with core's `morph` now reveals the far tile under reduced motion and without the API, and
  strategy "a" gives up after about 150 ms instead of 500 ms.
- **Browser smoke test** (Chromium, the production build served under `/wp-upload/` with the API
  mocked from `shared/fixtures`; a throwaway script, not committed): 30 checks: the shell renders and
  every request stays under the mount; `F`/`I`; `+`/`L` replace the URL (no new history entries); the
  resizer by keyboard; `F` ignored inside `[data-mm-local-keys]`; theme toggle; Esc closes the account
  menu; logout → login screen → login → shell; 900–1199 px inspector starts collapsed; < 900 px
  folder drawer starts closed, `F` opens it and Esc closes it (key layer); each boot state renders
  its screen and no shell (plugin missing/outdated/forbidden/too-new, WordPress unreachable, app
  password rejected); no FileBird → no folder column and no Folders toggle; anonymous → login.
- Component tests in Vitest browser mode wait for F3's `client/vitest.config.ts` (on `mm/f3`, not
  merged here).

## 2. Foundation APIs (as built)

Import paths are relative to `client/src/media-manager/`. Module augmentation must name the
**declaring module** (`core/commands/registry`, `core/state/store`), not the folder's `index.ts`:
TypeScript doesn't merge an augmentation through a re-export (checked).

### `core/state`: the core store (Zustand)

```ts
coreStore: StoreApi<CoreStore>             // vanilla store; coreStore.getState().selectOnly(id)
useCore<T>(selector: (s: CoreStore) => T): T // use useShallow for object/array selectors
interface CoreState {
  selection: ReadonlySet<number>; anchor: number | null; focus: number | null
  overlay: OverlayName | null               // 'peek' | 'editor' | augmented (interface OverlayRegistry)
  zoom: 'fit' | 0.5 | 1 | 2
  panels: { foldersOpen; folderWidth /*220–480*/; inspectorOpen; inspectorTab: 'info'|'edit'|'usage' } // persisted
  compactInspectorOpen: boolean; compactFoldersOpen: boolean // < 1200 / < 900 px, not persisted
  viewport: 'wide' | 'medium' | 'narrow' | 'phone'
  connectivity: { state: 'online' | 'offline'; since: number | null; reason: string | null }
  bootstrap: Bootstrap | null
}
// actions: selectOnly, toggleSelected, selectRange(id, order, additive?), selectAll(order),
// clearSelection, setSelection(ids), moveFocus(id, 'select'|'focus-only'|'extend', order?), setFocus,
// resetSelection, pruneSelection(removed), openOverlay(name), closeOverlay(name?), setZoom, stepZoom(±1),
// setPanels, setFoldersOpen, toggleFolders, setFolderWidth, setInspectorOpen, toggleInspector,
// selectInspectorTab(tab), setViewport, setConnectivity(state, reason?), setBootstrap
isFoldersOpen(s), isInspectorOpen(s), isCompactViewport(v), viewportForWidth(px)
selectionRules.*                            // the pure rules (rangeTo, targetIds, hiddenSelectedCount, …)
installCoreSync(urlStore, coreStore)        // folder change clears selection+focus; detail focuses its item,
                                            // resets zoom, closes overlays; deep link focuses its item
```

### `core/url`: `useUrlState`

```ts
interface UrlState { folder: 'all'|'trash'|number; q; type; alt; size; orient; month; sort;
  layout: 'justified'|'square'; density: 0|1|2|3|4; item: number | null; view: string | null }
useUrlState(): UrlState;  useUrlState<T>(selector): T    // useSyncExternalStore; selectors return stable values
urlStore(): UrlStore
interface UrlStore { get(); subscribe(l); navigate(patch | (s) => patch, {replace?}); openItem(id); closeItem();
  isPushedDetail() }
parseUrlState(search), serializeUrlState(state, currentSearch), collectionQueryOf(state),
collectionSearch(query), sameCollection(a, b), hasActiveFilters(s), DENSITY_SIZES, LAYOUTS
createUrlStore(env), createMemoryHistory(url)   // tests
```

History policy: entering detail pushes (a marker in `history.state` records the grid entry beneath);
everything else replaces; leaving a pushed detail entry calls `history.back()` (the UI updates at
once; if the grid state changed while in detail, the landed entry is then replaced). A deep link
replaces. Unknown params (`view`, `mock-scenario`, …) are kept. Invalid values read as defaults.

### `core/commands`

```ts
interface CoreCommandMap { 'grid.move-focus': {to, mode?}; 'selection.toggle-focused'; 'selection.select-all';
  'selection.clear'; 'detail.open': {id?}|undefined; 'detail.close'; 'detail.step': {direction};
  'detail.zoom-toggle'; 'detail.zoom-step': {direction}; 'peek.toggle'; 'grid.density-step': {direction};
  'grid.layout-toggle'; 'panels.toggle-folders'; 'panels.toggle-inspector'; 'inspector.open-tab': {tab};
  'inspector.edit-image'; 'inspector.focus-alt'; 'folders.create'; 'folders.rename'; 'folders.move-to';
  'folders.context-menu'; 'upload.pick'; 'items.delete': {fromLibrary?}|undefined; 'items.download';
  'help.shortcuts'; 'palette.open'; 'undo.last'; 'theme.toggle'; 'session.logout' }   // others: undefined
interface CommandMap extends CoreCommandMap {}          // augment: declare module '…/core/commands/registry'
implementCommand(name, { run(args), available?(args): Availability }, info?: {label, group}): () => void  // throws if taken
runCommand(name, ...args): boolean                      // false if unimplemented or unavailable
useCommand(name, ...args): { run(): boolean; enabled; reason; code; shortcut; label }
commandAvailability, commandInfo, describeCommand, listCommands, isImplemented, notifyCommandsChanged
type Availability = { ok: true } | { ok: false; code: string; reason: string }
```

Unimplemented → `{ok: false, code: 'not-implemented', reason: 'Not available yet'}`; buttons render
disabled with that tooltip (`shell/CommandButton.tsx`). `useCommand` re-checks on registry, keymap,
core-store and URL changes; feature-local state calls `notifyCommandsChanged()`.

**Implemented by core** (`app/runtime.ts`): `selection.clear`, `selection.toggle-focused`,
`selection.select-all`, `detail.open` (morph from the tile), `detail.close` (reveal the tile, morph,
focus it), `detail.step` (no wrap-around), `detail.zoom-toggle`, `detail.zoom-step`,
`grid.density-step`, `grid.layout-toggle`, `panels.toggle-folders` (needs FileBird),
`panels.toggle-inspector`, `inspector.open-tab`, `undo.last`, `theme.toggle` (providers),
`session.logout` (auth gate). **Left to features:** `grid.move-focus`, `peek.toggle` (A1),
`inspector.edit-image` (A4/B1), `inspector.focus-alt` (A4), `folders.*` (A3), `upload.pick` (B2),
`items.delete`, `items.download` (B3), `help.shortcuts`, `palette.open` (B5).

### `core/keymap`

```ts
type Binding = { key; mod?; shift?; mode: 'grid'|'detail'|'any'; command; args?; label?; group?; hidden?; repeat? }
registerBindings(feature, bindings): () => void   // asserts the US+DK rule and rejects conflicts (throws)
DEFAULT_BINDINGS                                    // the spec's 39 bindings; core registers them at start-up
layoutProblem(b), assertKeymapIsLayoutSafe(), listBindings(), bindingsFor(cmd), formatShortcut(b, mac?)
installKeymap({ getMode, onDecision? }): () => void // the one dispatcher (the shell installs it)
useKeyLayer(name, onEscape, active = true); pushKeyLayer({name, onEscape}): () => void
createKeyDispatcher({ getMode, readContext, getLayer, blur, onDecision? }) // the window-free dispatcher
decideKey(input), readFocusContext(target), matchesBinding(b, event, mode)   // pure parts, tested
isExpandedComboboxTrigger(attribute), CONTROL_SELECTOR
```

Rules: `event.key`; letters, digits, `, . - + ?`, named keys; Ctrl/Cmd only with a letter or Enter;
Shift only on named keys and Mod+letter (for characters it is part of the character). The dispatcher
ignores IME, Alt/AltGr, handled events, text fields (Esc blurs), Enter and Space on a focused control
(button, link, checkbox, radio, switch, tab, menu item, option), open `aria-modal` dialogs, menus,
listboxes, expanded comboboxes and listbox triggers, `[data-mm-local-keys]`, `[inert]` and any
`[data-mm-keymap-suspended]` on the page. An expanded Menu or Popover button doesn't count as a
popup, so its Esc reaches the Popover's key layer. Esc goes to the newest key layer first. The focus
context and the top layer are both read in the capture phase (spike C4). Key repeats run only
bindings with `repeat: true`.

**What features must do (C4):** keep Mantine's defaults for Menu, Select, Autocomplete, Combobox,
Modal and Drawer; give a Popover or HoverCard with focusable content a controlled `opened` plus
`useKeyLayer(name, () => setOpened(false), opened)` (closing must be idempotent); use `useKeyLayer`
for our own transient UI; wrap any non-native widget that owns arrows, Enter or Space in
`[data-mm-local-keys]`. Grid tiles must be `gridcell`s, not buttons, or Enter/Space won't reach the
app.

**Design decision:** the whole spec keymap is declared in core (`DEFAULT_BINDINGS`), so the `?` sheet
is complete from day one and two features can never claim the same key. Features implement the
commands; `registerBindings` is for keys beyond the spec.

### `core/perms`

```ts
can(action: PermAction, item?: PermItem): CanResult    // CanResult = {ok:true} | {ok:false, code: DenyCode, reason}
partition(action, items): { allowed; denied: {item, result}[] }
useCan(action, item?): CanResult
evaluate(ctx, action, item?), partitionWith(ctx, action, items)   // pure
PermAction: upload | edit-meta | attach | trash | delete | restore | empty-trash | move-to-folder |
  folder-create | folder-rename | folder-move | folder-delete | folder-color | folder-sort | edit-image |
  regenerate | replace | download | view-usage
DenyCode: not-ready | offline | needs-plugin | no-filebird | filebird-per-user | not-pro | trash-disabled |
  no-cap | no-item-perm | unsupported-type | processing | trashed | not-trashed
PermItem = { id; perms: {edit, delete}; kind?; mime?; sizesPending?; trash? }   // tiles and full items fit
```

Fed by `bootstrap` (caps, FileBird `active/perUser/pro`, trash, image editor MIME types, plugin
`features[]`/`missingFeatures` → "Needs plugin x.y" from the bundled version) and connectivity.

### `core/ui`

```ts
toast({ message, title?, tone?: 'info'|'success'|'warning'|'error', undo?: {run, done?}, action?: {label, run},
  autoClose?, id?, announcement? }): { id; close() }
undoLast(): Promise<boolean>; canUndo(): boolean        // Ctrl/Cmd+Z; an entry lives while its toast shows (8 s)
announce(message); <LiveRegion/>                         // one polite region; toasts are announced through it
confirm({ title, body?: ReactNode, confirmLabel?, cancelLabel?, tone?: 'default'|'danger', typeToConfirm?,
  typeToConfirmLabel? }): Promise<boolean>; <ConfirmHost/>  // queued; danger focuses Cancel;
                                                         // focus returns to the opener afterwards
morph(update, { from?: () => Element|null, to?: () => Element|null|Promise<Element|null> }): Promise<void>
                                                         // `to` always runs (it carries the reveal);
                                                         // the hero is dropped after 150 ms
morphWith(env, update, options)                          // the same over an injectable environment (tests)
icons.ts                                                 // the curated @tabler/icons-react set
```

### `core/collection`

```ts
useCollection(): { status; isPlaceholder; query; rev; total; rows: CollectionRows; ids; indexComplete; error }
useItem(id, view?: 'tile'|'full'): { item; status; missing }   // batched, ≤ 100 ids per request
useTargets(): { ids; source: 'selection'|'focus'|'none'; hidden }
getCurrentCollection()                                   // for commands; the shell publishes it
decodeRows(rows): CollectionRows  // ids[], widths/heights Uint32Array, kinds Uint8Array, indexOf, kindAt, has
neighbourOf(rows, id, ±1)
centerApi: { revealItem(id): Promise<HTMLElement|null>; tileElement(id); focusTile(id); stageElement() }
  // revealItem: synchronous DOM work (flushSync + scrollTop), never waits for a frame (C2)
registerCenter(part: Partial<CenterApi>): () => void     // grid: revealItem/tileElement/focusTile; detail: stageElement
```

### `core/dnd`, `core/uploads`

```ts
useMediaDraggable(ref, id, { disabled?, getOrder? }): { dragging }  // drags the selection if id is in it
isMediaDragData(data), MEDIA_DRAG_TYPE, mediaDragStore, setMediaDropTarget({label, refusal?} | null)
<MediaDragPreview/>                                       // pointer-following "Move N items · to X"
startUpload(file, { folder?, onProgress?, signal? }): Promise<JobAccepted>  // XHR, progress, 401 → session dialog
fetchUploadJobs(ids), cancelUploadJob(id): Promise<boolean>, checkDuplicate(filename), UploadRequestError
TileUploadState = { phase: 'queued'|'uploading'|'processing'|'error'; progress; error; previewUrl }
setTileUploadState(key, state|null), rekeyTileUploadState(from, to), useTileUploadState(key)
```

### `shell/` and `app/`

- `Shell`: toolbar (brand, slots, Folders/Inspector/theme toggles, account menu with Log out),
  banners row (`SystemBanners`), folder column (`FolderColumn`; resizable 220–480 px by pointer and
  keys, double-click or `F` collapses, `inert` when closed, absent without FileBird), centre
  (`FilterBar`, then the grid or `TrashView` at `folder=trash`, `inert` under detail and the editor,
  and overlay layers for `PeekOverlay`, `DetailOverlay`, `EditorOverlay`), inspector column
  (`InspectorPanel`; 48 px rail + 312 px panel), and `UploadLayer`, `CommandLayer`, `PhoneChrome`,
  `MediaDragPreview`. Root attributes `data-viewport`, `data-folders`, `data-inspector`,
  `data-detail` for feature CSS.
- `registerToolbarItem({ id, slot: 'start'|'center'|'end', order, Component })` (`shell/slots.ts`):
  features put breadcrumb, search, sort, layout, density and Upload in the toolbar from `register()`.
- `app/`: `AppProviders` (Mantine with its own colour-scheme key, notifications, QueryClient,
  `ConfirmHost`, `LiveRegion`), `AuthGate` (`useAuthSession`, copied from the old page: login screen,
  session-expired dialog over the mounted app, logout-failed dialog, visibility re-check; `useAuth()`),
  `Boot` (bootstrap first: hairline while loading; server unreachable; WordPress unreachable; app
  password rejected; plugin `missing` → `Onboarding` with a minimal fallback screen until B4 renders
  it; `forbidden`/`outdated`/`too-new` → a minimal blocking screen with the zip download and change
  list; `ok`/`update-available` → `Shell`), `runtime.ts` (core commands, default keymap, and
  `installRuntime()`: dispatcher, URL ↔ store sync, browser online/offline).

## 3. Missing, and why

- **F2's data layer isn't wired yet** (it lands in parallel). Three small seams are marked
  `TEMPORARY (M1)` and switch to F2's hooks at integration (I do this as the M2 agent):
  `core/collection/source.ts` (collection and item queries), `app/boot/useBootstrap.ts`, and the
  `QueryClient` in `app/providers.tsx`. Setting `connectivity` from `wp_unreachable`/`wp_timeout` and
  re-running bootstrap on `plugin_missing` belong in F2's http layer (see change requests).
- **F3's theme isn't wired yet:** Mantine defaults until `MediaManagerThemeProvider` lands; then
  `app/providers.tsx` swaps it in. Shell CSS already reads the token names (`--surface-*`, `--line-1`,
  `--z-*`, `--dur-*`, `--accent`, `--shadow-3`) with Mantine fallbacks.
- **Component tests in browser mode** wait for F3's Vitest config.
- **Phone layout (< 600 px):** the shell treats it like 600–899 px; B6 owns the phone chrome (M4).

## 4. Deviations

- Module augmentation names the declaring module (above); the plan's text doesn't say which.
- The whole spec keymap lives in core (`DEFAULT_BINDINGS`), not in each feature's `register()`.
- Mantine's `Modal` hard-codes `role="dialog"` (with `aria-modal`); interaction-spec §10 mentions
  `alertdialog`. `confirm()` uses `dialog`.
- `TrashView` replaces `GridView` at `folder=trash` (the shell chooses), rather than overlaying it.

## 5. Change requests

1. **F2 (`core/data`):** export the `QueryClient`, a bootstrap hook, a collection hook keyed by
   `CollectionQuery`, and item hydration by id; set `coreStore.getState().setConnectivity('offline', code)`
   on `wp_unreachable`/`wp_timeout` (and back online on success); invalidate bootstrap on
   `plugin_missing`. F1 then points the three `TEMPORARY (M1)` seams at them.
2. **F3 (theme):** expose the token names the shell CSS reads: `--surface-app`, `--surface-panel`,
   `--line-1`, `--text-1`, `--accent`, `--shadow-3`, `--z-grid|detail|stage-overlay|toolbar|drawer`,
   `--dur-1|2`, `--ease-standard`.
3. **Core follow-ups from the spikes:** done in this branch (commit `7da2fee`), see §6.

## 6. Spikes

Notes: [`spikes/C2.md`](spikes/C2.md) and [`spikes/C4.md`](spikes/C4.md); harnesses under
`client/src/media-manager/app/spikes/{c2,c4}/` (dev-only pages, not in the build; delete after the gate).

- **C2 (morph with a virtual grid), Chromium/Firefox/WebKit:** revealing the far-away tile by waiting
  for frames inside the transition callback fails in Chromium and Firefox (no rAF or scroll events
  run there, so the hero is lost after the timeout). **Decision:** the inert grid follows the current
  item while in detail, backed by a synchronous `revealItem` (`flushSync` + direct `scrollTop`).
  **Applied:** `morph` always calls `to` (also under reduced motion and without the API, since it
  carries the reveal) and the timeout dropped from 500 to 150 ms; `centerApi.revealItem` documents the
  synchronous contract. **For the grid (A1, and me in M2):** follow the current item while detail is
  open, no `content-visibility: auto` on rows, name the tile's `<img>` and the stage image, and name
  `from` on entry only when the tile is fully inside the scroller.
- **C4 (Esc layering vs Mantine), all three engines:** the capture-time focus snapshot is
  load-bearing (Modal, Combobox). **Applied:** the top Esc layer is snapshotted at capture too (a
  Popover closed by Mantine no longer also closes detail); an expanded trigger counts as `popup` only
  for comboboxes and listbox triggers; a new `control` context leaves Enter/Space on a focused button,
  link, checkbox, switch, tab or menu item to the control (they used to run `detail.open` /
  `peek.toggle` and cancel the click); `confirm()` returns focus to its opener. I derived the changes
  from `spikes/C4.md` and checked them with its harness (§1). What features must do is in §2
  (`core/keymap`). Remaining risk: a Popover without a key layer still lets Esc through (S10); a
  dev-only warning or a thin `Popover` wrapper in core could catch it.

## 7. Open questions

1. **Hidden selected items and bulk actions.** Filters keep the selection (spec §1), and `useTargets()`
   returns visible selected items in collection order, then hidden ones. Should bulk actions touch
   hidden selected items, or only visible ones? (`useTargets().hidden` lets the UI say "N hidden".)
2. **Detail stepping at the ends** stops (no wrap-around), as in the prototype. Confirm.
3. **Undo window:** Ctrl/Cmd+Z undoes only while the undoable toast is on screen (8 s). Should it reach
   further back (e.g. the last N changes this session)?
4. **One centre overlay at a time** (`overlay: 'peek' | 'editor' | …`). Peek over the editor or the
   reverse isn't possible. Fine for v1?

## 8. Against F2 and F3 (read from `mm/f2` and `mm/f3`, not merged)

Both branches cover change requests 1 and 2 above. Their handoffs' "F1 wiring" notes become my M2
integration list. These are the mismatches and decisions to make then:

1. **Colour-scheme key.** `app/providers.tsx` uses `wpu-media-manager:color-scheme`; F3's
   `MediaManagerThemeProvider` uses `wpu-mm-color-scheme` (`COLOR_SCHEME_STORAGE_KEY`). Adopt F3's when
   swapping in the provider (F3's note says `app/MediaManagerApp.tsx`; in this branch the provider sits
   in `app/providers.tsx`). Nothing has shipped, so no migration is needed.
2. **Connectivity has two stores.** F2's `connectivityStore` has `online | offline | wp-auth-failed`
   with `failures` and `nextRetryAt`; core's `connectivity` has `online | offline` and `since`/`reason`.
   In M2, core's `connectivity` mirrors F2's store, or `can()` and the banners read F2's directly.
   Either way `can()` must deny mutations under `wp-auth-failed` too. F2 doesn't write to
   `coreStore` (change request 1 asked it to), so the mirroring is mine.
3. **Session.** `AuthGate` must call `sessionGate.restore()` after a re-login in the session-expired
   dialog, and `sessionGate.abandon()` plus `clearLibraryData(queryClient)` on logout. Keep
   `useAuthSession`'s `setUnauthorizedListener`: F2's gate pauses requests but leaves the dialog to us.
4. **Collection rows are decoded twice.** F2's `useCollectionRows()` returns a `CollectionSnapshot`
   (`Uint32Array` rows, stride 4, `positionOf()`), while `core/collection` has `decodeRows()` →
   `CollectionRows` (an `ids` array, typed columns, `indexOf`). In M2, `useCollection()` builds on the
   snapshot and keeps its own shape as a thin view (`ids` is what the selection rules and
   `useTargets()` take). Drop `decodeRows` if the view can read the snapshot directly at 50k
   (to measure in M2).
5. **Two `useItem`s.** `core/data` and `core/collection` both export `useItem(id, view)`, and F2's
   returns the item or `null`, mine `{ item, status, missing }`. Mine will delegate to F2's; features
   should import from `core/collection`.
6. **Two collection-query parsers.** F2's `normaliseCollectionQuery()` drops the other filters and the
   sort at `folder=trash` (the server's echo, and so the cache key); my `collectionQueryOf()` keeps
   the URL values. The URL may keep them (Back leaves the Trash with the filters intact); the query key
   must come from F2's normaliser.
7. **Upload errors.** `core/uploads` throws `UploadRequestError` (`status`, `code`); the rest of the
   data layer throws F2's `LibraryError` (adds `kind`). In M2 the transport throws `LibraryError` so
   one error path covers both (a change in my own files).
8. **Rev polling.** F2's `useRevPolling()` must be mounted once in the shell (M2).
9. **Layout tokens.** F3 exposes `--toolbar-h`, `--rail-w`, `--folders-w` and `--inspector-panel-w`;
   the shell CSS defines `--mm-toolbar-h`, `--mm-rail-w` and `--mm-inspector-panel-w` locally. Switch
   to F3's names in M2. Every other name the shell reads (`--surface-*`, `--line-1`, `--text-1`,
   `--accent`, `--shadow-3`, `--z-*`, `--dur-*`, `--ease-standard`) exists in F3's list.
10. **Test layout.** F3's `unit` project runs `src/**/*.spec.ts` in Node and `*.browser.spec.ts(x)`
    in Chromium. All of F1's specs are Node-safe. `readFocusContext` and the shell are the first
    candidates for browser specs with F3's `renderWithProviders` and `pressKey` (the C4 harness
    scenarios can move there and the harness can go).
11. **The legacy Google Fonts link.** The smoke test's one console error was most likely the old page's Google
    Fonts request from `index.html`; F3's CR replaces it with `@fontsource/orbitron`.
