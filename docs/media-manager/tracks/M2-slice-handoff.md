# Track M2-slice: handoff

Branch `mm/m2-slice`, from `feature/media-manager` @ 1c1dfb5. Scope: [M2-slice.md](M2-slice.md). One
helper agent (high effort) built `features/inspector` and `core/data/inspector.ts` on exclusive paths;
the track owner reviewed and committed its files.

## 1. What works

From the repo root:

```sh
npm ci
npm run check                      # Biome: clean
npm run typecheck -w client        # clean (also -w e2e)
npm run test -w client             # unit (Node) + browser (Chromium): 51 files, 675 tests
node client/scripts/bundle-budget.mjs        # initial media-manager chunk 144.8 kB of 150
dev/run up test && dev/run seed small && dev/run test all   # the gate (§4)
```

- **Glue (M1-integration §6, all 12 items):**
  1. F2's data layer replaces the three `TEMPORARY (M1)` seams. `core/collection/source.ts` is gone;
     `useCollection()` reads `useCollectionRows()`, `app/boot/useBootstrap.ts` re-exports core/data's,
     and the providers use `LibraryQueryProvider`.
  2. `MediaManagerThemeProvider` with `wpu-mm-color-scheme`; `auto` (the OS) until the user picks with
     the theme toggle.
  3. One connectivity source: `installConnectivityMirror()` (app/runtime.ts) mirrors F2's
     `connectivityStore` plus the browser's online flag into the core store; `wp-auth-failed` becomes
     offline with reason `wp_auth_failed`, and `can()` then denies with "WordPress rejected the app
     password".
  4. Session: the gate is imported statically now; logout calls `sessionGate.abandon()` and then
     `clearLibraryData()` (`useAuthSession({ onLoggedOut })`, wired in `AuthGate`).
  5. One collection decode: `CollectionRows` is a thin view over F2's `CollectionSnapshot` (`rowsOf`,
     one per snapshot, `ids` built lazily once). `decodeRows` is gone.
  6. One `useItem`: core/collection's delegates to core/data's. Features import core/collection's.
  7. Query keys from `normaliseCollectionQuery()` (the URL may keep Trash-ignored filters).
  8. `core/uploads` throws `LibraryError` (`uploadError()`); `UploadRequestError` is gone.
  9. `useRevPolling()` is mounted once, in the shell.
  10. The shell uses F3's `--toolbar-h`, `--rail-w`, `--folders-w`, `--inspector-panel-w`.
  11. Browser specs: `core/keymap/readFocusContext.browser.spec.tsx` (against real Mantine Menu, Modal,
      Select, inputs, `[inert]`, local keys) and `shell/Shell.browser.spec.tsx` (tokens, rev poll,
      colour-scheme key, panel toggle). The C4 harness is deleted.
  12. Orbitron 600 is self-hosted in `theme/fonts.ts`; the wordmark uses `--font-brand`.
- **D31, per-component Mantine CSS** (`theme/mantineStyles.ts`): the `.layer.css` files only, so
  unlayered app CSS always wins whatever the load order. A feature that uses another Mantine component
  imports its layer file next to the use (the file's header says how).
- **The slice:**
  - **Boot** checks the plugin first and shows the onboarding placeholder, a blocking screen, or the
    shell (unchanged from M1; covered by `Boot.browser.spec.tsx`).
  - **Grid** (`features/grid`): justified or square, virtualised, driven by `?folder&q&sort&layout&density`.
    C1's layout module moved here (`justifiedLayout.ts`, plus a `square` option) and keeps C1's four
    rules plus the stable gutter. `gridcell` tiles with a roving tabindex and `aria-selected`; click,
    Ctrl/Cmd+click, Shift+click, double-click, and double-tap on touch; arrows (↑/↓ nearest tile), Home,
    End, Shift+arrows, X, Ctrl/Cmd+A, Esc through the keymap (`grid.move-focus`). Pictures come from
    `srcset` at the tile's size and pixel ratio, with `?v=<modifiedAt>`, and fade in over reserved boxes.
    Skeleton rows, "No media matches" with Clear filters, empty folder and empty library. A refetch of
    the same query keeps the scroll position; another folder, filter or sort starts at the top.
  - **Detail** (`features/detail`, a lazy chunk prefetched when idle): Enter, double-click or a deep
    link. `?item=` pushes once; ←/→ replace and stop at both ends with a nudge and "First/Last item in
    this view" (D34); Back, Esc and G leave. The stage shows the tile's loaded picture at once, then the
    sub-size that fits (40 px / 16 px padding, never upscaled), preloads both neighbours, and has Zoom
    (fit ↔ 100 %, `+`/`-`), Download and Prev/Next (always shown on touch screens). The morph follows
    C2: the grid follows the current item, `revealItem` is synchronous, and the hero is the tile's
    picture only when the tile is fully in view. The tile you return to gets focus and the return ring.
    Video and audio use native players and documents their cover; the filmstrip is wave A.
  - **Inspector** (`features/inspector`; the panel is a lazy chunk): rail (Info, Edit image, Usage),
    0 / 1 / N targets; for one item the file name, meta line, preview (grid mode only), and Title and
    Alt text with autosave: Unsaved → Saving… → ✓ Saved, or "⚠ Not saved" with Retry; blur, Enter and
    Ctrl/Cmd+Enter commit; Esc reverts, a second Esc returns to the tile. `core/data/inspector.ts`'s
    `saveItemMeta()` is an optimistic PATCH with rollback, then `applyItemSnapshots` and `applyRev`
    (`item-meta`). Drafts and field states are kept by `id:field`, so they survive re-renders; a field
    left with unsaved text commits to the item it was typed for. Read-only (Author) state with a lock
    notice. `A` focuses the alt field.
  - **Both themes** and the sub-path: the e2e slice runs in light and dark, under `/wp-upload-mock/`
    and `/wp-upload/`, and checks no request leaves the sub-path.

### Bundle (plan §9, D31)

Initial media-manager chunk, gzip, measured with `client/scripts/bundle-budget.mjs` on the host:

| State | kB | Of which CSS |
|---|---|---|
| M1 baseline (feature/media-manager @ 1c1dfb5) | 148.59 | 38.70 |
| Glue wired in, still `@mantine/core/styles.css` | **156.19** (over) | 39.78 |
| **After D31** (per-component layer CSS) | **130.50** | 14.11 |
| After the slice (grid in the chunk; detail, inspector panel and the notifications container lazy) | **144.80** | 14.52 |
| After the review fixes (§4a) | **145.30** | — |

Lazy chunks: detail overlay 2.6 kB, inspector panel 7.3 kB, notifications container 8.7 kB, boot
screens 2.0 kB.

## 2. Feel review at 50k (D47)

The mock needs no stack. On this machine (localhost is a secure context, which the mock's service worker
needs):

```sh
npm run dev:mock -w client
# open http://localhost:5173/?view=library&mock-scenario=large&mock-images=picsum
```

`mock-scenario=large` is 50k items; `mock-images=picsum` uses real photos (needs internet). The choice
is remembered for the tab; `?mock-scenario=normal` resets it.

**From the iPad on the same network.** Service workers only run over HTTPS (or on localhost), so the
mock dev server needs a certificate the iPad trusts. The test stack's dev CA signs one. Run these from
the repo root:

```sh
dev/run up test                                   # once: creates the dev CA (dev/.state/test/ca)
client/scripts/mock-lan-cert.sh <this machine's LAN IP>
```

The script prints the next commands with absolute paths; they are:

```sh
WPU_MOCK_HTTPS_CERT=dev/.build/mock-lan/server.crt \
WPU_MOCK_HTTPS_KEY=dev/.build/mock-lan/server.key \
  npm run dev:mock -w client                      # Vite already listens on all interfaces
```

The two paths may be absolute or relative to the repo root (not to `client/`, where npm runs Vite).
Vite prints its `Network:` URLs; the port is 5173 unless it is taken.

Then on the iPad:
1. AirDrop or mail `dev/.state/test/ca/public/ca.crt` to it and open it.
2. Settings → Profile Downloaded → Install.
3. Settings → General → About → Certificate Trust Settings: turn on full trust for
   "wp-upload dev CA (local test stack only)".
4. Open `https://<LAN IP>:5173/?view=library&mock-scenario=large&mock-images=picsum`.

Checked on this machine after the review: the documented command with relative paths started Vite over
HTTPS, and `curl --cacert dev/.state/test/ca/public/ca.crt https://127.0.0.1:5173/…` (a certificate
made for `127.0.0.1` the same way) verified the chain and the IP name (`ssl_verify_result` 0) and
served the page and `mockServiceWorker.js`. A bad address makes the script stop with openssl's error.

**The stack route** (`WPU_BIND_ADDRESS`): `WPU_BIND_ADDRESS=0.0.0.0 dev/run up test` exposes the test
proxy, which serves the mock build under `/wp-upload-mock/`. Its certificate only names `wpu.test`,
`wp.wpu.test` and `localhost`, and an iPad can't resolve `wpu.test`, so that route fails on the
certificate until CR-2 lands; the dev-server route above works today.

On the iPad: tap selects, two taps open detail, the stage's Prev/Next buttons step (swipe is wave A),
and the inspector shows beside the grid at 1200 px and wider (an iPad in landscape is 1024–1366 px wide;
below 1200 px the inspector starts collapsed, `I` or the rail opens it).

## 3. Frozen foundation API (M2 gate)

`core/`, `app/` and `shell/` pass to the orchestrator. Signatures are in
[F1-handoff.md](F1-handoff.md) §2 and [F2-handoff.md](F2-handoff.md) §2; M2 changes are marked **(M2)**.
Import from each folder's `index.ts` (core/data from `core/data`), except module augmentation, which
names the declaring module.

- **`core/state`**: `coreStore`, `useCore`, `CoreState`/`CoreActions`/`CoreStore`, `createCoreStore`,
  `selectionRules`, `isFoldersOpen`, `isInspectorOpen`, `isCompactViewport`, `viewportForWidth`,
  `installCoreSync`, `OverlayRegistry` (augmentable), `Connectivity` (now mirrored from core/data **(M2)**).
- **`core/url`**: `useUrlState`, `urlStore`, `setUrlStoreForTesting`, `createUrlStore`,
  `browserUrlEnvironment`, `UrlStore`, `UrlState`, `UrlPatch`, `NavigateOptions`, the codec
  (`parseUrlState`, `serializeUrlState`, `collectionQueryOf`, `collectionSearch`, `sameCollection`,
  `hasActiveFilters`, `DENSITY_SIZES`, `LAYOUTS`, `MAX_DENSITY`, …), `createMemoryHistory` (tests).
- **`core/commands`**: `CommandMap` (augment `core/commands/registry`), `CoreCommandMap`,
  `implementCommand`, `runCommand`, `useCommand`, `commandAvailability`, `commandInfo`,
  `describeCommand`, `listCommands`, `isImplemented`, `notifyCommandsChanged`, `subscribeCommands`,
  `Availability`, `MoveDirection`, `COMMAND_GROUPS`, `shortcutFor`.
- **`core/keymap`**: `registerBindings`, `DEFAULT_BINDINGS`, `Binding`, `layoutProblem`,
  `assertKeymapIsLayoutSafe`, `listBindings`, `bindingsFor`, `formatShortcut`, `describeBinding`,
  `installKeymap`, `createKeyDispatcher`, `decideKey`, `readFocusContext`, `matchesBinding`,
  `isExpandedComboboxTrigger`, `isTextField`, `CONTROL_SELECTOR`, `useKeyLayer`, `pushKeyLayer`,
  `topKeyLayer`, `keyLayerNames`.
- **`core/perms`**: `can`, `partition`, `useCan`, `evaluate`, `partitionWith`, `PERM_ACTIONS`,
  `PermAction`, `DenyCode`, `PermItem`, `PermContext` (+ `offlineReason` **(M2)**), `WP_AUTH_FAILED`
  **(M2)**.
- **`core/ui`**: `toast`, `undoLast`, `canUndo`, `announce`, `plural`, `LiveRegion`, `confirm`,
  `ConfirmHost`, `morph`, `morphWith`, `MORPH_NAME`, `prefersReducedMotion`, `icons.ts` (+ the slice's
  icons **(M2)**).
- **`core/collection`**: `useCollection` (rows over the snapshot **(M2)**), `useItem` (delegates to
  core/data **(M2)**), `useTargets`, `getCurrentCollection`, `useTrackCurrentCollection`,
  `CollectionRows` (`snapshot`, `length`, `ids`, `idAt`, `widthAt`, `heightAt`, `kindAt`, `indexOf`,
  `has`) **(M2)**, `rowsOf` **(M2)**, `EMPTY_ROWS`, `neighbourOf`, `centerApi` / `registerCenter` /
  `CenterApi` (+ `heroElement(id)`, `nudgeStage(direction)` **(M2)**), renditions **(M2)**:
  `pickSource`, `pictureFor`, `smallestPictureFor`, `withVersion`, `RenditionItem`.
- **`core/data`**: everything in F2-handoff §2 (libraryApi, http/request, LibraryError, sessionGate,
  connectivityStore, client, keys, collection snapshot helpers, items/chunks, invalidation map,
  optimistic, bulk, params, results, rev). Per-feature files: `core/data/inspector.ts`
  (`saveItemMeta`, `useSaveItemMeta`, `ItemMetaField`, `ItemMetaPatch`) **(M2)**.
- **`core/dnd`**: `useMediaDraggable`, `MediaDragPreview`, `mediaDragStore`, `setMediaDropTarget`,
  `isMediaDragData`, `dragIdsFor`, `MEDIA_DRAG_TYPE`.
- **`core/uploads`**: `startUpload`, `fetchUploadJobs`, `cancelUploadJob`, `checkDuplicate`,
  `uploadError` **(M2, replaces `UploadRequestError`)**, tile upload state (`setTileUploadState`,
  `useTileUploadState`, `rekeyTileUploadState`, …).
- **`app/`**: `MediaManagerApp`, `AppProviders` (+ `queryClient`, `forceColorScheme` props **(M2)**),
  `AuthGate`, `useAuth`, `useAuthSession` (+ `onLoggedOut` **(M2)**), `Boot`, `isUsablePluginState`,
  `registerCoreCommands`, `openDetail`, `closeDetail`, `installRuntime`, `installConnectivityMirror`
  **(M2)**, `registerFeatures`.
- **`shell/`**: `Shell`, `registerToolbarItem`/`useToolbarItems`, `CommandIconButton`,
  `useFolderDrawerLayer`, `useViewportTracking`, the layout data attributes (`data-viewport`,
  `data-folders`, `data-inspector`, `data-detail`).
- **Test harness** (`test/`): `renderWithProviders`, `mockNetwork`, keyboard helpers,
  `startFakeLibrary`/`stopFakeLibrary` **(M2)**, `renderLibrary`/`cleanupLibrary` (the whole app over
  the fake, in memory history) **(M2)**.

Behaviour that is part of the contract: `detail.step` stays available at both ends and nudges
(`centerApi.nudgeStage`) and announces instead of moving; it is unavailable while loading and for an
item outside the view. `openDetail` blurs a focused tile before the grid turns inert.

## 4. Gate

Docker was available. From a fresh stack: `dev/run up test`, `dev/run seed small`, `dev/run test all`
→ **exit 0**.

| Suite | Result |
|---|---|
| lint | pass |
| typecheck | pass (server, client, e2e, plugin) |
| unit | pass: server 795 tests (39 files); client 657 tests (50 files, both projects, bundle budget included) |
| plugin-static | pass |
| plugin-contract | pass: `plugin`, `oldest` and `mu-plugin` runs, each 164 passed, 28 skipped (the `wp eval` tests, as in M1) |
| server-live | pass: 49 tests (4 files) |
| e2e-mock | pass: 10 (D's 2 smoke tests + 8 slice tests: 4 flows × light/dark, axe on each screen); 12 after the review (§4a) |
| e2e-live | pass: 10 (the same, on the production image under `/wp-upload/`; saved title and alt survive a reload); 12 after the review (§4a) |

The slice e2e (`e2e/support/slice.ts`, run by `e2e/{mock,live}/slice.spec.ts`) covers: boot into the
grid under the sub-path with no request outside it; click and arrow selection; Enter → detail
(`?item=` pushed), ←/→ replace and stop at the first item with its announcement, browser Back, Esc back
to a focused tile, double-click; a `?item=` deep link; alt text Unsaved → Saved with Ctrl+Enter, Esc
revert, Title saved on blur, and (live) persistence after a reload. The stack was stopped with
`dev/run down` (volumes kept).

## 4a. Review fixes

An independent review of the branch found no critical issues, 2 important and 13 minor. All are fixed,
each with a test where one was possible, in commits dc025ad, 99b7e0f and 0cd03f8.

| # | Fix | Test |
|---|---|---|
| 1 (important) | `vite.mock.config.ts` resolves `WPU_MOCK_HTTPS_CERT`/`_KEY` against the repo root; `mock-lan-cert.sh` prints the commands with absolute paths; §2 rewritten | Checked by hand, end to end (§2) |
| 2 (important) | Esc while a field is saving reverts to the text being sent; nothing newer is committed on blur | `inspector.browser.spec.tsx` (write latency, PATCH count) |
| 3 | A blur within 1.8 s of a save keeps "✓ Saved" | `autosave.spec.ts` |
| 4 | A refused commit of a field no longer on screen also toasts; a dirty field keeps taking input while offline, and only the commit is refused | `inspector.browser.spec.tsx` |
| 5 | Logout resets session state: `core/state`'s `onSessionReset`/`resetSession`, joined by core (selection, focus, overlay) and the inspector (drafts, errors, timers, bridge); a save settling after the logout changes nothing. `AuthGate` calls it after `sessionGate.abandon()` and before `clearLibraryData` | `sessionReset.spec.ts`, `inspector.browser.spec.tsx` |
| 6 | With nothing focused, the roving tab stop is the first tile in view | `grid.browser.spec.tsx` |
| 7 | `focusTile` scrolls a pinned tile's row into view first | `grid.browser.spec.tsx` |
| 8 | `closeDetail` names no hero unless `heroElement` gives one (spike C2) | covered by the detail and e2e flows |
| 9 | A tile keeps its picture until a newer src has loaded (no blank after a save) | `grid.browser.spec.tsx` (same `<img>`, still loaded) |
| 10 | The inspector preview uses `pictureFor` (versioned URL, covers for non-images) | `format.spec.ts`, inspector browser spec |
| 11 | An item that leaves the view while shown (`?alt=missing`, alt saved) steps from its old place: `stepFrom()` plus a position remembered per requested query; its Prev/Next buttons stay | `rows.spec.ts`, `detail.browser.spec.tsx` |
| 12 | Focus a pointer press gives a tile doesn't scroll, so the click selects it | `grid.browser.spec.tsx` (fails on the old code) |
| 13 | The end nudge animates the stage's first child, so documents nudge too | — (CSS) |
| 14 | `mock-lan-cert.sh` shows openssl's error when a step fails | Checked by hand (an invalid address) |
| 15 | Tests: C1 rules (scroll kept across a refetch, focus back after a re-layout, tab stop), D34 at the last item (browser and e2e), the e2e autosave test asserts "Saving…" with slowed writes (`&mock-latency=400`; a delaying route live), scopes "Saved" per field and waits for the live reset saves | as listed |

After the fixes: `npm run test -w client` 51 files, 675 tests; bundle 145.30 kB; `dev/run test e2e-mock`
and `e2e-live` 12 passed each (2 smoke + 5 slice flows × light/dark).

Known, out of scope: the panel header's "Unsaved changes" note doesn't count typing done during a save.

## 5. Deviations

- **Lazy chunks beyond plan §9's list:** the detail overlay, the inspector panel and Mantine's
  notifications container. Without them the slice is 150.8 kB. Detail is prefetched when idle, so the
  first Enter normally finds it loaded (else the first morph runs without a hero); the inspector panel
  is fetched at mount.
- **Tiles are named by their file name** (what the hover overlay shows; axe's
  label-content-name-mismatch), not their title.
- **The detail browser spec runs without the View Transitions API:** in Vitest's iframe, Chromium's
  renderer crashed when a keyboard-opened detail started a view transition. It doesn't reproduce in a
  top-level page; the e2e slice (real page) and `core/ui/morph.spec.ts` cover the morph.
- **`A` is unavailable for non-images** (inspector.md §4 suggests Title): the brief's wording.
- **Shift+Enter just commits** until Save & previous (wave A).
- The spike C2 harness (`app/spikes/c2/`) is still there; the grid now carries its rules, so it can go
  whenever the orchestrator likes. Spike C1's `VirtualJustifiedGrid` stays as the perf harness and now
  imports the grid's layout module.

## 6. Change requests

- **CR-1, repo `CLAUDE.md` (M5 docs, F3 CR-4 again):** add `npm run test -w client` to the commands.
- **CR-2, `dev/lib/make-dev-ca.sh` (track D / M2-followups, optional):** when `WPU_BIND_ADDRESS` is a
  specific IPv4 address, add `IP:$WPU_BIND_ADDRESS` to `server_names` (and reissue the proxy
  certificate), so the stack route of §2 works from another device that trusts the dev CA.
- **CR-3, `client/index.html` (M5, already planned):** drop the old page's Google Fonts link. On the host
  it produced a console error (`net::ERR_NETWORK_CHANGED`) that failed an e2e test once; the media
  manager self-hosts its fonts now.

## 7. Open questions

1. **Retry while offline:** after a `wp_unreachable` failure `can()` says offline, so the fields turn
   read-only and Retry is refused until connectivity returns; the typed text stays. Keep, or let Retry
   try anyway?
2. **Inspector at iPad widths:** at 900–1199 px the inspector starts collapsed (interaction-spec §6). On
   an iPad in landscape (1024–1194 px) that hides the alt field by default. Fine for v1?
3. **Morph in Vitest's iframe** (§5): worth a Chromium bug report, or ignore?

## 8. Feel-review fixes (branch `mm/m2-feel`)

The owner's iPad (Safari) feel review found four problems. All are fixed on `mm/m2-feel`, each with tests.

1. **The inspector follows the item in detail mode (D52).** Before, stepping only moved the focus, and
   the inspector showed the selection.
   - Core sync now calls `followDetailItem()` whenever detail shows an item: when it opens, steps, comes
     from a deep link or from history.
   - With 0 or 1 items selected, the selection moves with the focus. With 2 or more, the selection is
     kept and only the focus moves. Leaving detail keeps the selection as it is then.
   - The inspector's panel, its rail dot and `A` all read `useInspectorTargets()`. In detail mode that is
     the item on stage; batch editing stays in grid mode.
   - Drafts still commit to the item they were typed for.
   - Core API additions: `selectionRules.followDetailItem` and `inspectorTargetIds`, the store action
     `followDetailItem`, and `useInspectorTargets` in core/collection.
   - A deep link now also selects its item.
   - Tests: `selection.spec.ts`, `store.spec.ts`, `features/inspector/detailMode.browser.spec.tsx`, and
     the touch step in the e2e slice.
2. **The mock fell through to the network** (`mock-scenario=large&mock-images=picsum` over LAN HTTPS).
   - Cause, reproduced in Playwright WebKit: WebKit gives a service worker 70 s to answer a top-level
     navigation. If it takes longer, WebKit loads the page from the network and terminates the worker.
     From then on it sends every request of every tab past the worker, while
     `navigator.serviceWorker.controller` stays set. MSW forwards every navigation to the page and waits
     for it, for example during a reload while the old page is busy.
   - MSW 3 already restores its clients after an ordinary worker restart (checked in Chromium with CDP
     `ServiceWorker.stopAllWorkers`).
   - The mock now registers `mock-sw.js` (`mocks/serviceWorker.js`), following MSW's "merging service
     workers" recipe. It keeps navigations (except `api/` downloads) and cross-origin requests (picsum,
     fonts) away from MSW, then imports the unchanged `mockServiceWorker.js`.
   - `vite.mock.config.ts` no longer proxies `api`/`session`. Such a request gets a 503
     (`mock_worker_bypassed`, header `X-WPU-Mock-Unhandled`) and a `[mock] … reached the dev server` log
     line.
   - A watchdog (`mocks/watchdog.ts`, `workerRecovery.ts`) pings the worker after a suspicious backend
     response, a controller change, or when the page becomes visible. If the worker is bypassed, it
     unregisters it and reloads once, with a "mock service worker was restarted" notice. A second
     failure within 60 s shows a message instead of reloading again.
   - `entry.ts` retries a failed start once and never boots the app without the mock.
   - Tests: `mocks/watchdog.spec.ts`, `mocks/serviceWorker.spec.ts` and `e2e/mock/mock-worker.spec.ts`.
3. **"flushSync was called from inside a lifecycle method."**
   - Cause: the grid dispatched scroll events from layout effects (following the focused item,
     re-layouts), and `@tanstack/react-virtual` answers a scroll event with `flushSync`.
   - Those notifications now run in a microtask. Only `revealItem` (the morph's close path, spike C2,
     outside React's lifecycles) still flushes synchronously.
   - `test/consoleErrors.ts`'s `failOnReactWarnings()` guards the grid, detail and D52 specs; every grid
     and detail test failed on the old code.
4. **Fast taps on Next started a text selection.**
   - The toolbar, rail, grid, detail bar, stage and step buttons now have `user-select: none` (with
     Safari's `-webkit-` prefix) and no long-press callout. The stage picture keeps its callout.
   - Every control is `touch-action: manipulation`.
   - Inputs, textareas and the inspector panel stay selectable.
   - Tests: computed-style checks in the detail and inspector browser specs, and the e2e step that taps
     Next four times and expects four steps with no selection. A one-off WebKit check showed the old CSS
     leaving a selection, and none with the new.

**For the iPad re-test:**
- Restart `npm run dev:mock -w client`.
- Clear the LAN origin's website data once (Settings → Safari → Advanced → Website Data).
- If the watchdog ever reloads, the Vite log names the requests that slipped past the worker.

**Change request (design docs):** interaction-spec §1 "Targets" says the inspector shows the same targets
as actions. Add D52: in detail mode it shows the item on stage, and stepping moves a selection of 0 or 1
along. F2-handoff, which says the mock registers `mockServiceWorker.js`, is outdated: the mock now
registers `mock-sw.js`, which loads it.
