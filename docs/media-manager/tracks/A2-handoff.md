# Track A2 (M3): detail mode — handoff

Branch `mm/a2`, from `feature/media-manager` @ fc9999d. Brief: [A2.md](A2.md), with
[M3-wave-A.md](M3-wave-A.md) and [README.md](README.md). Every change is inside `features/detail/**`
plus the A2 e2e files; `core/`, `app/` and `shell/` are untouched.

## 1. What works

From the repo root:

```sh
npm ci
npm run check                              # Biome: clean
npm run typecheck -w client -w e2e         # clean
npm run test -w client                     # 61 files, 784 tests (detail: 34 unit + 51 browser)
node client/scripts/bundle-budget.mjs      # initial chunk 147.76 kB of 150; detail lazy 11.3 kB
dev/run test plugin-static                 # builds the plugin dist the live e2e needs
dev/run up test && dev/run seed small
dev/run test e2e-mock e2e-live
```

To look at it: `npm run dev:mock -w client`, then `?view=library&item=1086` (video), `1090` (audio),
`1088` (PDF), `1092` (zip), `1091` (SVG), `1003` (image).

1. **Stage per media type** (`StageMedia.tsx`, `Player.tsx`, `Media.module.css`):
   - **image** fitted (40/16 px padding, never upscaled), upgraded to the sub-size that fits, neighbours
     preloaded (M2);
   - **SVG** on a checkerboard;
   - **video**: poster (or the first frame), a play overlay, and the player bar (play/pause, time,
     scrubber, duration); a click on the video toggles too;
   - **audio**: a card with the cover (if any) or a music icon, file name, "Audio · 30:43 · 28 MB", and
     the player bar;
   - **PDF**: the first-page preview (the PDF's preview renditions) as a paper sheet, or a blank sheet
     with lines when WordPress made none; "PDF · page 1 of N · size", **Open PDF** (new tab) and
     **Download**. The meta column goes under the sheet below 640 px of stage;
   - **archive, other documents, anything else**: a card with the type ("ZIP archive", "DOCX"), size and
     **Download**;
   - **keys (spike C4)**: the play button is a native button (Enter/Space activate it; ←/→ still step).
     The scrubber is a native range under `[data-mm-local-keys]`: arrows, Home/End and PageUp/Down
     seek; Esc leaves it for the detail region (a second Esc leaves detail); Space plays/pauses.
     **Space anywhere in detail mode plays/pauses** through a new command, `detail.play-toggle`
     (`commands.ts`), available only while a player is on stage;
   - a file the browser can't play says "Can’t play this file here" and disables Play;
   - a video or audio file starts loading (`preload="metadata"`) only after the item has been on stage
     for 400 ms, so stepping quickly through media downloads nothing and cuts no request off.
2. **Virtual filmstrip** (`Filmstrip.tsx`): TanStack Virtual, horizontal, over `useCollection()`;
   hydrates its visible cells with the grid's aligned id chunks. Cells are dimmed except the current
   one (neutral outline, kept centred: the strip has half a strip of padding at each end, and scrolls
   smoothly on a step, instantly on open, on long jumps and under reduced motion). Selected cells keep
   the neon ring and check. A click steps there (replace); Ctrl/Cmd+click or the check circle toggles
   the selection. Badges: duration, PDF pages, missing alt. The tile upload state shows as a bar.
   ARIA: a one-row `grid` of `gridcell`s with `aria-selected` and `aria-current`, a roving tab stop on
   the current cell; the app keymap works there (←/→ step and focus follows, X, Esc). It is chrome:
   `data-mm-no-select`, `touch-action: manipulation`, no `user-select: none`. A vertical wheel scrolls it
   sideways.
3. **Zoom and pan** (`Stage.tsx`, `useStageGestures.ts`, `gestures.ts`): `Z`, `+`/`−` (core's commands);
   the bar's Zoom button shows the level ("Fit", "50 %", …) and is disabled for non-pictures. Changing
   level keeps the point at the centre; entering zoom starts at the picture's centre. Drag to pan
   (mouse, pen, one finger) with the grab/grabbing cursor; a trackpad pans natively. Pinch on touch
   scales live and settles on the nearest level (Fit, 50, 100, 200 %) around the pinch point. Zoom
   resets on step and leave (core sync).
4. **Top bar** (`DetailBar.tsx`): Back, title, index (`12 / 93`, mono) or "Not in this view", Zoom,
   Download, and **More**: Copy URL (clipboard, with a fallback for insecure contexts; toast), Open in
   wp-admin (`links.edit`, new tab), Move to folder… (`folders.move-to`, hidden without FileBird), Edit
   image (`inspector.edit-image`), Delete (`items.delete {fromLibrary: true}`, shows Shift+Delete).
   The last three are disabled until their tracks implement them; a disabled one shows its reason under
   the label unless it is only "not built yet". Below 900 px an **Info** button toggles the inspector
   (system.md §5). On a phone the step arrows and the Zoom button go and the strip is 64 px.
5. **Swipe to step on touch** (system.md §5): the picture follows the finger, with resistance (35 %)
   where there is nothing further; commits past 64 px or on a flick (≥ 0.5 px/ms over ≥ 16 px). At an
   end a full swipe runs `detail.step`, which nudges and announces (D34). The new item slides in from
   that side (1 ms under reduced motion). A swipe doesn't also click (play a video).
6. **Edge cases:**
   - **Deep link to an item the view doesn't have:** the bar says "Not in this view"; the step buttons
     hide and ←/→ do nothing (there is no known place to step from); the strip shows the view without a
     current cell, and a click on it steps in. An item that *left* the view while shown still steps on
     from its old place (M2, core's `detail.step`).
   - **Deep link to an item that doesn't exist:** "Item not found" with Back to grid.
   - **Items removed while open** (`removal.ts`): when the item on stage is deleted, trashed, removed
     from or moved out of the folder on view, or restored out of the Trash view, the item that followed
     it shows (the first survivor after it, so a batch delete lands right; else the one before it), and
     detail returns to the grid when the view is empty. An item that only stopped matching a filter
     (alt saved under Missing alt) stays, as in M2.
   - **Reduced motion:** the morph is core's cross-fade; the nudge is off; the strip doesn't scroll
     smoothly; swipe snap-back and slide-in use `--dur-2` (1 ms).

## 2. Tests and gate

| Check | Result |
|---|---|
| `npm run check`, `typecheck -w client -w e2e` | clean |
| `npm run test -w client` | 61 files, 784 tests pass |
| Detail unit (`format`, `gestures`, `fit`, `removal`) | 34 |
| Detail browser (`detail`, `stage`, `filmstrip`, `edges`) | 51, `failOnReactWarnings()` in each |
| Bundle budget | initial media-manager chunk **147.76 kB** of 150 (base fc9999d: 145.95); detail lazy chunk 11.3 kB |
| `dev/run test plugin-static` | pass |
| `dev/run test e2e-mock` | 47 passed (D's smoke, the M2 slice and keyboard specs, A2: 8 flows × light/dark) in most full runs. The A2 specs passed in every run. Over 6 full runs, 3 M2 slice tests failed now and then (1 failure in each failing run): see below |
| `dev/run test e2e-live` | 28 passed, 2 skipped (the archive flow: the live seed has no archive), in every run |

**Mock e2e flakes, all in the M2 slice spec (`e2e/support/slice.ts`):**

- "edits alt text with autosave": also flaky on the base commit (fc9999d) with `--repeat-each=4`
  (3 of 8). Not A2's.
- "on a touch screen › the inspector follows…": a race in the test that reads tile names before the
  tiles are hydrated (CR-3).
- "opens detail with Enter… Back returns to the grid": an uncaught `AbortError: Transition was skipped.
  New ViewTransition started` (captured with a temporary logging tweak to the e2e fixture, since
  reverted). Core's `morphWith` awaits `transition.finished` but never handles `transition.ready`,
  which rejects too when a newer transition skips one. The test's double-click-then-Esc starts the close
  morph while the open morph is still running. The heavier detail overlay (filmstrip, players) makes the
  open morph's update a little slower, which probably makes the overlap more likely. The fix is in core
  (CR-5). I could not verify it, because core is frozen even for a local experiment.

The A2 e2e (`e2e/support/a2-detail.ts`, run by `e2e/{mock,live}/a2-detail.spec.ts`) covers, in both
schemes with axe: the filmstrip (centred, click replaces, Ctrl+click, keyboard focus), zoom and mouse
pan, video, audio (plays, Space pauses, the scrubber seeks without stepping), PDF, the archive card
(mock), the More menu (Copy URL with the clipboard, Open in wp-admin, Esc layering) and a real CDP touch
swipe both ways. (The numbers are from the run after the review fixes; see the commit list.)

**Bundle note:** of the +1.8 kB, only `commands.ts` (detail's `register()`) is new code in the initial
graph. The rest is Rolldown re-partitioning: the lazy detail chunk now shares more modules with the
initial graph (toast, commands, data items, Mantine buttons), so the shared modules are split into more,
smaller initial chunks, each gzipped on its own. See CR-4.

**Independent review:** a `final-reviewer` pass (high effort) found 3 important and 5 minor issues. All
are fixed in 114201d with tests: removal from a folder and Trash restore now step on, batch removals land
on the real successor, the drag click suppression never swallows a keyboard activation and expires, a
mouse released outside no longer hover-pans, a no-op pinch leaves no stale centre, Space works on the
scrubber, and three tests that couldn't fail now can.

## 3. Change requests

**CR-1, `client/src/media-manager/core/ui/icons.ts` (core is frozen):** add the icons detail uses, then
`features/detail/icons.ts` can go (its imports switch to `core/ui/icons`).

```diff
 export {
   IconAlertTriangle as AlertIcon,
   IconArchive as ArchiveIcon,
   IconArrowBackUp as UndoIcon,
   IconArrowForwardUp as RedoIcon,
   IconArrowLeft as BackIcon,
   IconCheck as CheckIcon,
   IconChevronLeft as PreviousIcon,
   IconChevronRight as NextIcon,
+  IconCopy as CopyIcon,
   IconCrop as CropIcon,
+  IconDots as MoreIcon,
   IconDownload as DownloadIcon,
+  IconExternalLink as ExternalIcon,
   IconFile as FileIcon,
   IconFileTypePdf as PdfIcon,
   IconFolder as FolderIcon,
+  IconFolderSymlink as MoveIcon,
   IconFolders as FoldersIcon,
@@
   IconPencil as EditIcon,
   IconPhoto as ImageIcon,
+  IconPhotoOff as MissingIcon,
+  IconPlayerPauseFilled as PauseIcon,
+  IconPlayerPlayFilled as PlayIcon,
   IconPlug as PluginIcon,
   IconRefresh as RetryIcon,
   IconSearch as SearchIcon,
   IconSun as SunIcon,
+  IconTrash as DeleteIcon,
   IconUpload as UploadIcon,
```

**CR-2, `client/vitest.config.ts` (browser project):** every run prints "Vite unexpectedly reloaded a
test" because `react-dom/client` is discovered late; when the reload lands mid-file the first test of
that file fails (seen once locally, not in the final runs). Pre-bundle it:

```diff
-        optimizeDeps: { force: true },
+        // react-dom/client is found late (testing-library) and reloads a test.
+        optimizeDeps: { force: true, include: ['react-dom/client'] },
```

**CR-3, `e2e/support/slice.ts` (M2 slice e2e, flaky):** "on a touch screen › the inspector follows
the item…" reads the tiles' `aria-label`s right after the first tile is visible, before they are
hydrated, so `names[0]` can be `"Loading"`. Wait for hydration first:

```diff
           await openLibrary(page)
+          await expect(tiles(page).nth(4)).not.toHaveAttribute('aria-label', 'Loading')
           const names: string[] = []
```

**CR-4, `client/vite.config.ts` (optional, bundle headroom):** merge small shared chunks (Rolldown's
`output.advancedChunks` or `minChunkSize`) so the initial graph isn't split into many separately gzipped
chunks as more lazy features share core modules. Worth measuring once wave A has merged.

**CR-5, `client/src/media-manager/core/ui/morph.ts` (a flaky uncaught rejection, see §2):** handle
the skipped transition's `ready` promise too.

```diff
 interface ViewTransitionLike {
   finished: Promise<void>
+  ready?: Promise<void>
 }
@@ export async function morphWith(
   const transition = env.startViewTransition(async () => {
     …
   })
+  // A transition that a newer one skips rejects `ready` as well (AbortError).
+  // Nothing else waits on it, so without this it is an unhandled rejection.
+  transition.ready?.catch(() => {})
   try {
     await transition.finished
```

A unit test in `morph.spec.ts` can pass a fake whose `ready` rejects and assert no unhandled rejection.

**CR-6, docs (`interaction-spec.md` §8 and `system.md` §6):** add `Space` | detail | Play / pause video
or audio. And §5: a deep link to an item the view doesn't contain shows "Not in this view" without
stepping (see open question 2).

## 4. Deviations

- **Icons** live in `features/detail/icons.ts` until CR-1.
- **A new command and binding,** `detail.play-toggle` on Space in detail mode, declared by module
  augmentation and registered from `register()`. Not in interaction-spec §8 (CR-6).
- **The shared e2e module** is `e2e/support/a2-detail.ts`, outside the `a2*.spec.ts` names: Playwright
  forbids a spec importing another spec, and the slice did the same (`support/slice.ts`).
- **Touch panning of a zoomed picture is our own drag, without momentum:** the stage is
  `touch-action: none`, because a pinch can't start once the browser pans natively.
- **Pinch settles on the discrete zoom levels** (core's `ZoomLevel`); there is no continuous zoom.
- **Swipe is touch-only;** a mouse drag only pans a zoomed picture.
- **The More menu's Mantine options:** `withInitialFocusPlaceholder={false}` (Mantine's placeholder is a
  focusable `role=presentation` inside `role=menu`, an axe `aria-required-children` violation), plus a
  `useKeyLayer` while open, so Esc with focus still on the trigger closes only the menu (C4 S10/S11a).
  Other tracks' Menus will hit the same axe rule.
- **The filmstrip doesn't reuse A1's `Tile`** (A1 owns it and is changing it in parallel); it renders
  its own small cell with the same ring/check look and minimal badges. Unify after the merge if wanted.
- **Cell names include the badge** ("photo.jpg, Alt text missing", "clip.mp4, 1:34"): axe's
  label-content-name-mismatch counts the badge as visible text.

## 5. Notes for other tracks

- **A3 (Move to…, Remove from folder) and B3 (delete, trash):** in detail mode you don't need to step
  yourselves. Once the item on stage reads as moved out of the folder on view (`item.folder`), trashed,
  restored from the Trash view, or missing (its cache entry `null`), detail shows its successor or
  returns to the grid. Keep the cached item current (the mutation result or the rev poll does).
- **A1:** the filmstrip reads `useTileUploadState(id)`; any richer tile states can be mirrored there.
- **Anyone using Mantine `Menu`:** see the deviation above (axe and the Esc layer).

## 6. Open questions

1. **What the More menu's Move / Edit / Delete act on.** They run the shared commands, which act on the
   targets. With 0–1 selected, D52 makes that the item on stage; with several selected, Move and Delete
   would act on the whole selection from detail mode. Should the detail menu always act on the item on
   stage only (an `ids` argument on those commands)?
2. **Deep links outside the view:** shown with "Not in this view" and no stepping until the user picks
   an item in the strip (there is no known place to step from). Alternatives: clear the filters that hide
   it (as the palette does, system.md §11), or step from its sort position. Keep?
3. **Video playback in the e2e:** the e2e only asserts the player bar for video (the fake's and the
   seed's mp4 is H.264, which a Chromium build without proprietary codecs can't play; the app then says
   "Can’t play this file here"). Playback itself is tested with audio. Fine?

## 7. Branch and commits

Branch `mm/a2` (not pushed):

- 2797f49 feat: detail mode stages per media type, filmstrip, zoom and pan, More menu
- 3c8a8d8 test: detail mode e2e in mock and live, both schemes, with axe
- 114201d fix: detail review findings: removals, click suppression, hover-pan
- d335f40 fix: load stage video and audio only once the item stays on stage
- (this note) docs: add the A2 track handoff note

The test stack was stopped with `dev/run down` (volumes kept).
