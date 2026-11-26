# Interaction spec — wp-upload media manager

How the media manager behaves. This is the hand-off for implementation, together with the design system
([design-system.md](design-system.md)) and the clickable prototype (`prototype/`, see
[README](README.md)). Where the prototype and this text disagree, treat it as a bug and fix one of them.

This document covers the **core model** (collection, selection, grid, detail, peek, filters, URL,
keyboard, motion, accessibility) and summarises the three feature areas. Each area has a detailed spec:

| Area | Spec | Screens |
|---|---|---|
| Folders and organising (FileBird) | [specs/folders.md](specs/folders.md) | `screenshots/folders-*` |
| Inspector, metadata, batch edit, image editing | [specs/inspector.md](specs/inspector.md) | `screenshots/inspector-*` |
| Upload, delete and trash, system states, shortcuts, small screens | [specs/system.md](specs/system.md) | `screenshots/system-*` |

A visual walkthrough of every flow is in [screens.md](screens.md).

## 1. The model: one collection, many views

- **Collection.** The ordered list every view walks. It is the current folder (All files, Uncategorized
  or a FileBird folder) plus search, type and extra filters, plus sort. The grid, the filmstrip, `←`/`→`
  in detail mode, quick peek and Save & next all use this same list.
- **Selection** is a set of item ids plus an **anchor** (for Shift ranges). **Focus** is a single item
  (the keyboard position). They are deliberately separate: focus moves without changing the selection
  only when you hold a modifier; plain arrow keys move focus *and* select (Finder/Lightroom behaviour).
- **Targets.** Actions apply to the selection, or to the focused item when nothing is selected. The
  inspector shows the same targets in grid mode; in detail mode it shows the item on stage, and stepping
  moves a selection of 0 or 1 items along with it (D52, [implementation plan](../implementation-plan.md) §0).
- **Changing folder** clears the selection and focus. Changing filters or sort keeps the selection
  (hidden selected items stay selected, and the count says so).

### URL state

All state that matters for sharing or Back/Forward lives in query parameters, never path segments, so the
app works under any sub-path:

| Param | Meaning | Default |
|---|---|---|
| `folder` | `all`, `0` (Uncategorized) or a folder id | `all` |
| `q` | Search text | — |
| `type` | `image`, `video`, `audio`, `document` | all |
| `alt=missing` | Missing-alt filter | off |
| `size` (`gt1`, `gt5`), `orient` (`landscape`, `portrait`, `square`), `month` (`YYYY-MM`) | Extra filters | off |
| `sort` | `date-desc`, `date-asc`, `title-asc`, `name-asc`, `size-desc`, `size-asc`, `dimensions-desc`, `type-asc` | `date-desc` |
| `layout`, `density` | `justified` or `square`; 0–4 | `justified`, 2 |
| `item` | Open item: present means detail mode | — |

- **Entering detail pushes** a history entry. Stepping between items and changing filters **replace** it,
  so Back always returns to the grid you came from.
- **Deep links:** `?item=<id>` opens detail mode directly, with the grid behind it.
- **Trash view** *(amended: it is `folder=trash`, see [server-api.md](../contracts/server-api.md) §6)*: it should become `folder=trash` so it can be linked to. See
  [system.md](specs/system.md) §9.

## 2. Grid

- **Layouts.**
  - **Justified** (default): aspect-preserving rows packed Flickr-style from known dimensions. The last
    row keeps the target height.
  - **Square:** a uniform grid of cropped cells, better for mixed media and documents.
  - `L` toggles between them; the segmented control in the toolbar does the same.
- **Density:** five steps (120 / 160 / 200 / 260 / 340 px row height or cell size), set with the slider
  or `+`/`-`.
- **Tiles:** quiet at rest. Hover shows the check circle (top left, on a soft gradient) and the file name
  (bottom). Badges sit bottom right: Alt missing, video or audio duration, PDF page count. Non-images are
  neutral cards with a type icon; SVG and PNG sit on a checkerboard. Images fade in over a placeholder of
  reserved size, so there is no layout shift.
- **Selection by pointer:**

  | Gesture | Effect |
  |---|---|
  | Click | Select only that item, and focus it |
  | `Ctrl/Cmd`+click, or click the check circle | Toggle that item |
  | `Shift`+click | Select the range from the anchor, in collection order |
  | Double-click | Open detail mode |
  | Drag a tile | Move it, or the whole selection if the tile is part of it, to a folder ([folders.md](specs/folders.md) §6) |

- **Selection by keyboard:** arrows move focus and select; `Shift`+arrows extend; `X` toggles the focused
  item; `Ctrl/Cmd+A` selects everything in the collection; `Esc` clears; `Home`/`End` jump to first/last.
  `↑`/`↓` pick the tile in the row above or below whose centre is nearest horizontally.
- **Selection feedback:**
  - A selected tile shrinks its image to 90 % inside a neon ring on a neutral cell, with a check.
  - At **≥ 2 selected**, all check circles show and the toolbar becomes the **selection bar** ("✕ N
    selected · Move to folder · Edit details · Download · Delete").
  - The inspector switches to batch editing.
- **Empty and loading:**
  - Loading uses skeleton rows shaped like the justified grid.
  - "This folder is empty" offers an Upload action and a drop zone.
  - "No media matches" offers Clear filters.
  - An empty library offers Upload and drop anywhere.
  - No spinners in content areas.

## 3. Search, filters and sort

- **Search** (toolbar) filters as you type (150 ms debounce) across title, file name, caption and alt
  text. REST covers title, caption, description and file name; alt-text and EXIF search come from the
  companion plugin.
- **Type chips:** All, Images, Video, Audio, Documents. Each has a count for the current folder and is
  hidden when 0.
- **Missing alt** chip: shows its count, and pairs with the Save & next alt-text pass
  ([inspector.md](specs/inspector.md) §4).
- **"+ Filter" menu**, grouped:
  - **Size:** > 1 MB, > 5 MB.
  - **Orientation:** Landscape, Portrait, Square.
  - **Uploaded:** months that contain media, newest first, with counts (from the plugin's month list).
  - Active extra filters appear as removable chips (click to remove).
- **Sort menu:** Newest, Oldest, Title A–Z, File name A–Z, Largest/Smallest file, Largest dimensions,
  File type. The toolbar shows the current sort.
- The filter bar ends with a live summary: `N items · total size` (mono).

## 4. Quick peek (`Space`)

- **Opens** a Quick Look-style preview of the focused item over the grid area: a scrim plus a blur, the
  image at up to 86 % of the centre, and a caption pill with the name, dimensions and size and key hints.
- **While open:**
  - `←`/`→`/`↑`/`↓` keep moving grid focus and the peek follows.
  - `Space` or `Esc` closes.
  - `Enter` closes and opens detail mode.
  - Clicking the scrim closes.
- **Not detail mode:** the grid, selection and URL don't change, so it is for checking, not inspecting.

## 5. Detail mode

- **Open** with `Enter` or a double-click on a tile, or with a `?item=` deep link.
- **Overlay, not navigation.** Detail covers only the centre area. The toolbar, the folder column and the
  inspector stay where they are ("stable chrome, changing centre"). The grid stays mounted underneath,
  `inert`, so scroll position and selection survive the round trip.
- **Shared-element morph.** The clicked thumbnail grows into the stage image (View Transitions API, only
  that one element is named, `--dur-morph` 260 ms), and shrinks back into its cell on exit. The cell you
  return to gets a fading accent ring. Reduced motion uses a cross-fade instead.
- **Stage:**
  - The image is fitted with 40 px side and 16 px vertical padding.
  - The cached thumbnail shows instantly and then upgrades to the right sub-size; neighbours are
    preloaded.
  - Prev/next buttons appear on hover.
  - The top bar shows Back, the title, the index (`12 / 93`, mono), Zoom, Download and More (Copy URL,
    Open in wp-admin, Move to folder, Edit image, Delete).
- **Stepping:** `←`/`→`, the stage buttons, or a filmstrip click. It always walks the **whole
  collection**, never only the selection. It replaces the URL entry.
- **Deep link outside the view:** a `?item=` the current collection doesn't contain (filtered out, other
  folder) opens with "Not in this view" in place of the index. The step buttons hide and `←`/`→` do
  nothing, because there is no known place to step from; the filmstrip shows the view without a current
  cell, and a click on it steps in. An item that *leaves* the view while shown still steps on from its old
  place. A deep link to an item that doesn't exist shows "Item not found" with Back to grid.
- **Filmstrip:**
  - A strip of the collection, dimmed except for the current item, which has a neutral outline and is
    kept centred.
  - Selected items keep their neon ring and check. `Ctrl/Cmd`+click toggles selection from the strip.
- **Zoom** (images and SVG):
  - `Z` or the Zoom button toggles **Fit ↔ 100 %**. `+`/`-` step through Fit, 50, 100, 200 %.
  - When zoomed, the stage scrolls; drag to pan (grab cursor).
  - Zoom resets to Fit when you step or leave.
- **Media types:**
  - **Video:** poster, play button and player bar (play, time, scrubber, duration).
  - **Audio:** a card with the title, duration and player bar.
  - `Space` plays and pauses the video or audio on stage, wherever focus is in detail mode.
  - **PDF:** the first-page preview as a paper sheet, plus "page 1 of N", Open PDF and Download.
  - **Archive:** a card with Download.
- **Leave** with `Esc`, `G`, Back or the ← button. `Esc` closes the innermost layer first (an open field,
  menu or peek).

## 6. Panels and layout

- **Toolbar:** brand, breadcrumb, search, sort, layout, density, Upload, and the panel and theme toggles.
  Without FileBird there is no Folders toggle and no "Move to folder".
- **Folder column (left):**
  - 280 px by default, drag 220–480 px (the width is remembered); arrow keys on the resizer; double-click
    or `F` collapses it.
  - **Constant width:** the grid takes the rest of the space.
  - Details in [folders.md](specs/folders.md).
- **Inspector (right):**
  - A 48 px icon rail (**Info**, **Edit image**, **Usage**) plus a 312 px panel.
  - Clicking the active rail icon collapses the panel to the rail; `I` toggles it, `E` opens Edit, `A`
    jumps to the alt-text field.
  - Details in [inspector.md](specs/inspector.md).
- **Breakpoints:**

  | Width | Layout |
  |---|---|
  | ≥ 1200 px | Everything |
  | 900–1199 px | Inspector starts collapsed |
  | 600–899 px | Folders become a drawer, the inspector an overlay sheet |
  | < 600 px | Single column: the inspector is a bottom sheet; detail is full screen with swipe; search collapses to an icon. See [system.md](specs/system.md) §5 |

## 7. Feature areas (summaries)

### Folders and organising — [specs/folders.md](specs/folders.md)

- **Column contents:** All files, Uncategorized, the nested tree with direct or nested counts (toggle),
  expand/collapse all, and folder search that keeps ancestors visible.
- **Create and rename:** inline. Duplicate names become "Name (1)", explained in a toast.
- **Delete:** a confirm that explains the subtree, and that files move to Uncategorized.
- **Context menu** on right-click or the `ContextMenu` key.
- **Drag and drop:** tiles or the selection onto a folder, with a pointer-following "Move N items · to X"
  preview, auto-expanding folders, and an Undo toast. Folders can be reparented and reordered.
- **Move to…** (`M`): a searchable dialog with Recent folders and "Create folder".
- **Scenarios:**
  - FileBird Pro: colours and folder sort.
  - Per-user mode: a notice, and the column is read-only.
  - No FileBird: no folder UI at all.

### Inspector, metadata and editing — [specs/inspector.md](specs/inspector.md)

- **Info panel by selection:**
  - **None:** folder summary, alt-text coverage and "Start alt-text pass".
  - **One:** preview, fields, and collapsible File / Camera / Sizes sections.
  - **Many:** "Editing N items" with Mixed values, Replace/Append for the description, and an Undo
    toast.
- **Autosave:** Unsaved → Saving… → Saved ✓, or "Not saved · Retry". `Ctrl/Cmd+Enter` commits; `Esc`
  reverts. Half-typed edits survive re-renders.
- **Save & next:** in the alt field, `Enter` saves and moves to the next item, keeping focus in the field;
  `Shift+Enter` goes back. A progress strip shows how far you are, and a completion toast ends the pass.
- **Usage panel:** where the item is used and in what context, a featured-image warning, and attach or
  detach with a post picker.
- **Edit image (in place):**
  - A crop canvas over the centre: ratios, numeric W×H, handles, and arrow keys to nudge.
  - Rotate and flip, scale down, and "Apply to" (all sizes, thumbnail only, all except thumbnail).
  - Undo/redo, Save in place with Undo, a discard guard, Restore original, Regenerate thumbnails, and
    Replace file (keeps ID and URL).
  - Each media type that can't be edited explains why.
- **Author role:** other people's media is read-only, with a lock notice.

### Upload, delete, states, shortcuts — [specs/system.md](specs/system.md)

- **Upload:**
  - Drop anywhere: a full-window overlay naming the target folder. Also `U` or the Upload button.
  - Tiles appear at once, with the progress ring, then "Processing", then done.
  - A collapsible tray with per-file status, Retry, and type and size rejection.
- **Delete:**
  - **In a folder:** `Delete` removes items from the folder (Undo, no confirm); `Shift+Delete` deletes
    from the library.
  - **With `MEDIA_TRASH`:** Trash plus Undo, and a Trash view (Restore, Delete permanently, Empty trash).
  - **Otherwise:** a permanent-delete confirm showing thumbnails and where items are used, typing the
    count for 25 or more items.
  - **Download** is honest: no ZIP in v1.
- **States:**
  - No plugin: an onboarding screen. ~~with the basic uploader as a fallback~~ *(amended, D1c, [implementation plan](../implementation-plan.md) §0:
    no fallback)*.
  - Offline: a banner, retry with back-off, cached browsing, and mutations disabled.
  - Author: a banner.
  - Loading: a hairline plus skeletons.
- **`?` shortcut sheet**, built from the live keymap, and a **`Ctrl/Cmd+K` command palette** (actions,
  filters, sorts, folders, media).
- **`Ctrl/Cmd+Z`** undoes the latest toast.

## 8. Keyboard

**Rules:**

- **Layouts:** shortcuts are matched on `event.key` and must be typable natively on US **and** Danish
  keyboards. That allows letters, digits, `, . - + ?`, named keys and `Ctrl/Cmd` + letter. It forbids
  `[ ] { } \ | @ $ ~` and F-keys. `keymap.js` checks this at startup (`assertKeymapIsLayoutSafe`).
- **Text fields:** single-key shortcuts never fire while typing; only `Esc` (leave or revert the field)
  and `Ctrl/Cmd+Enter` (commit) work there.
- **Modals:** while focus is inside a modal (dialog, sheet, palette), app shortcuts pause and the modal
  handles its own keys.

The complete map (40 bindings: the prototype's 39, plus `Space` in detail mode added in wave A):

| Group | Key | Mode | Action |
|---|---|---|---|
| Navigate | `←` `→` `↑` `↓` | grid | Move focus (and select) |
| Navigate | `Home` / `End` | grid | First / last item |
| Navigate | `←` / `→` | detail | Previous / next item |
| Select | `Shift` + arrows | grid | Extend selection |
| Select | `X` | any | Toggle selection of the focused item |
| Select | `Ctrl/Cmd+A` | grid | Select all |
| Select | `Esc` | grid | Clear selection |
| View | `Enter` | grid | Open in detail mode |
| View | `Space` | grid | Quick peek |
| View | `Esc` / `G` | detail | Back to grid |
| View | `+` / `-` | grid | Larger / smaller thumbnails |
| View | `L` | grid | Justified / square layout |
| View | `Z` | detail | Zoom: fit / 100 % |
| View | `+` / `-` | detail | Zoom in / out |
| View | `Space` | detail | Play / pause video or audio |
| Panels | `F` | any | Toggle folder column |
| Panels | `I` | any | Toggle inspector |
| Edit | `E` | any | Edit image (the inspector's Edit tab; reserved for the inspector) |
| Edit | `A` | any | Jump to alt text (reserved for the inspector) |
| Folders | `N` | grid | New folder |
| Folders | `R` | grid | Rename current/focused folder |
| Folders | `M` | any | Move selection to folder… |
| Folders | `ContextMenu` | grid | Folder menu |
| Files | `U` | any | Upload files |
| Files | `Delete` | any | Remove from folder (in a folder), otherwise delete |
| Files | `Shift+Delete` | any | Delete from library |
| General | `?` | any | Keyboard shortcuts |
| General | `Ctrl/Cmd+K` | any | Command palette |
| General | `Ctrl/Cmd+Z` | any | Undo the last change |

**Local keys** (only inside their component):

- **Folder tree:** arrows, Home/End, Enter/Space, Delete.
- **Alt field:** `Enter` / `Shift+Enter` for Save & next.
- **Image editor:** `Enter`/`Esc`, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y`, and arrows on the
  crop box.
- **Menus and palette:** arrows, Enter, Esc.

## 9. Motion

| Moment | Duration | Easing | Reduced motion |
|---|---|---|---|
| Hover, fades, image fade-in | `--dur-1` 90 ms | ease-out | Kept |
| Panels open/close, selection scale, chips | `--dur-2` 150 ms | standard | 1 ms |
| Overlays (peek, menus, dialogs, drop overlay, page cross-fade) | `--dur-3` 220 ms | ease-out in / ease-in out | Fade only |
| Grid ↔ detail morph | `--dur-morph` 260 ms | standard | Cross-fade |
| Return highlight on the tile | 900 ms | ease-out | Kept (no movement) |
| Skeleton shimmer | 1.4 s loop | linear | Off |

## 10. Accessibility

- **Grid:** an ARIA grid of `gridcell` tiles with a roving tabindex; `aria-selected` reflects selection.
- **Folder tree:** an ARIA tree with a roving tabindex.
- **Menus and dialogs:**
  - Menus use `role=menu` with arrow navigation, and return focus to the opener.
  - Dialogs use `alertdialog`/`aria-modal`, trap focus, close on Esc and restore focus.
- **Announcements:** one polite live region for selection counts, mode changes, saves and toasts.
- **Contrast:** AA everywhere, measured for tokens and for **hovered controls** (`token-report.mjs`,
  hover sweep in `screenshots.mjs`).
- **Signals:** focus and selection are distinct, and colour is never the only signal.
- **Prototype simplifications** to fix in implementation: native tooltips via `title`, and some
  `button`s without `type`.

## 11. Simulated scenarios

The prototype's dev box (bottom right) and `?scenario=` switch between site situations, so every state can
be designed and tested:

| Scenario | Shows |
|---|---|
| `normal` | Default site with FileBird Lite |
| `pro` | FileBird Pro detected: folder colours and folder sorting |
| `per-user` | FileBird per-user folders: unsupported notice, column read-only |
| `no-filebird` | No folder UI at all |
| `no-plugin` | Companion plugin missing: onboarding screen |
| `author` | WP user is an Author: others' media read-only |
| `trash` | `MEDIA_TRASH` on: Trash flow and Trash view |
| `offline` | WordPress unreachable: banner, cached browsing, mutations disabled |
| `loading` | Slow site: skeletons |
| `empty` | Empty library |

## 12. Companion plugin and API needs (consolidated)

Everything the design relies on that core REST and FileBird's public API don't provide. Details are in
each area spec.

| Area | Need |
|---|---|
| Detection | REST namespace on `GET /wp-json/` (plugin present; version); FileBird present, **Pro** licence, **per-user mode**; `MEDIA_TRASH` and `EMPTY_TRASH_DAYS`. *Amended (D15, [implementation plan](../implementation-plan.md) §0): Pro is detection-gated and tested in mock mode only* |
| Listing | *(Amended: superseded by the plugin's `/collection` and the `wpu.folder` field, see [plugin-api.md](../contracts/plugin-api.md).)* `GET /wp/v2/media?fbv=<id\|0>` with paging and sort; `fbv_folder` field on every item; orderby/filter on size, dimensions, file name, type; missing-alt filter; alt and EXIF search; month list with counts; compact id/width/height list for the justified layout |
| Folders | Tree with counts in one call; create/rename returning the final (auto-suffixed) name; move/reorder with cycle check; recursive delete returning the moved count; atomic bulk assign returning counts; Pro colour/sort only when Pro is licensed |
| Metadata | Batch metadata update (or proxy fan-out) with per-item results |
| Images | In-place edit `{rotate, flip, crop, scale, applyTo}`, undo last edit, restore original, regenerate (single + batch, pollable), replace file (keeps ID and URL) |
| Usage | Where-used per item and batched (content, featured, galleries…), powering the Usage panel and delete warnings |
| Trash | List trashed attachments with `trashed_at`, restore, permanent delete, empty trash |
| Uploads | `wp_max_upload_size()`, allowed MIME types, processing status of sub-sizes |
| Permissions | `users/me?context=edit` capabilities, plus `targetHints.allow` per item (core) |

## 13. Implementation notes

**Already resolved in the prototype's core:**

- Tile rings are drawn above images (`::after`).
- The grid has its own stacking context, so rings never show through detail mode.
- Detail's index and filmstrip follow `library-changed`.
- Menus support checked/disabled items and return focus.
- The light-theme drop-target ring uses `--select-ring`.
- `runAction()` exists for the palette.
- Shortcuts pause inside modals.
- There is a `--z-stage-overlay` token, and the redo icon is in the sprite.
- Local drop zones (`[data-drop-zone]`) are ignored by the window drop overlay.
- Without FileBird, the toolbar has no folder UI.

**For the real implementation** (from the area specs' "Requests to core"; worth designing in from the
start):

1. **Upload state in tiles:** tiles, stage and inspector should render an upload/processing state and an
   object-URL preview natively. The prototype patches them with MutationObservers.
2. **One permission check:** `can(action, item)` in front of every mutation, fed by capabilities and
   `targetHints`.
3. **Toasts:** a toast API that marks undoable toasts, so `Ctrl/Cmd+Z` doesn't rely on button text.
4. **Confirm dialogs:** `confirmDialog` should accept rich content (thumbnails, lists), replacing the
   separate delete dialog.
5. **Inspector refresh:** the inspector re-renders on library changes while keeping in-progress edits
   (the prototype keeps drafts per field).
6. **Trash in the URL:** add `folder=trash`.
7. **Plugin check first:** check for the plugin before rendering the app shell, so the no-plugin state
   shows first.
8. **Read-only state:** a first-class read-only state in the inspector rather than DOM patching.
9. **Lazy loading:** the media manager is a lazily loaded chunk, because the client bundle is already
   ~522 kB.
10. **Real code, not prototype code:** the prototype is vanilla JS for design only. Rebuild it in React
    19 + Mantine 9 using the design system's tokens (design-system.md §8).
