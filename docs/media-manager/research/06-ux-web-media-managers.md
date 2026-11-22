# 06 — UX inspiration from web media managers & galleries

Track F of the media-manager research. It covers web apps only; desktop pro apps such as Lightroom are covered in a separate track.
Scope: what the best web media managers and galleries do for layout, grid, folders, selection, viewer/detail mode,
info and edit panels, upload, search and filters, loading states, theming and micro-interactions. The last sections turn
this into patterns to adopt, patterns to avoid, visual style notes and open questions for the design phase.

## Summary

- **The justified grid has won for photo-first web apps.** Google Photos, Immich, Eagle (its default) and Flickr all
  use justified rows that keep each item's aspect ratio. Square grids survive in DAMs and admin tools (Cloudinary,
  WordPress DataViews, Sanity), where aligned titles and metadata matter more than the images. Masonry suits
  inspiration feeds (Pinterest, Unsplash) but makes order hard to read across a row, so it fits a "sorted library"
  poorly.
- **Immich is the closest open-source blueprint.** It is a modern (Svelte 5 + Tailwind) clone of the Google Photos web
  UI, and its source gives concrete numbers: a 235 px target row height (100 px on small screens), 2 px gaps, a 360 px
  info panel that flies in over 150 ms, selected tiles that shrink to 85 % with rounded corners, a thumbhash placeholder
  that fades out over 100 ms, and a 60 px date scrubber.
- **The best viewers are routes, not modals.** Google Photos and Immich use a full-bleed dark viewer with a slide-in
  info panel that pushes the image aside instead of covering it. DAMs (Brandfolder, Bynder, Cloudinary) use tabbed
  modals or drawers, which feel heavier. Frame.io's three toggleable panels and Dropbox's "quick view" (list left,
  preview right) are the closest web analogues to the Lightroom-style detail mode we want.
- **"Premium" comes from many small, consistent details,** not from any one feature:
  - a placeholder colour or hash for every tile, so the grid never jumps;
  - the thumbnail growing into the viewer;
  - hover scrub on videos;
  - optimistic updates;
  - edits that autosave on blur, with a quiet confirmation;
  - a dark, image-first canvas with chrome that steps back;
  - fast keyboard paths (`?` help, arrows, `i` info, `x` select, `Esc` steps back one level).
- **Eagle is the best model for "folders + inspector".** It has a left sidebar with folders, a centre grid with a size
  slider, and a right inspector whose content changes with the selection: nothing selected shows the folder summary,
  one item shows editable fields, several items show batch editing. It maps almost one-to-one onto FileBird plus an
  info/edit panel.
- **On the WordPress side,** the DataViews grid (the component behind new admin screens) gives useful vocabulary:
  density (`comfortable` / `balanced` / `compact`), `previewSize`, `aspectRatio`, cover/contain fit with an "original
  aspect ratio" toggle, badge fields, primary filters, and bulk actions built into the layout. It is still a
  square-card admin grid and does not aim to feel premium. The FileBird, HappyFiles and Real Media Library plugins all
  bolt a folder tree onto the legacy WordPress screen.

## Confidence legend

| Tag | Meaning |
|---|---|
| **[docs]** | From official documentation, a product page or a vendor blog. |
| **[source]** | Read directly in open-source code (Immich `main`, sparse clone taken 2026-11-22). |
| **[observed]** | From familiarity with the live product, not re-verified in this session. Check against the live app before it drives a decision. |
| **[assumption]** | Inference or the author's judgement. |

---

## 1. Product teardown

### 1.1 Google Photos (web)

The reference design for a big personal library on the web. Its 2015 engineering write-up, *Building the Google Photos
Web UI*, is still the canonical source on justified grids at scale.

```
┌───────────────────────────────────────────────────────────────────────┐
│ ☰  [ Search your photos ……………… ]                  ⬆ Upload   ⚙  (A)  │
├──────────┬───────────────────────────────────────────────────────┬────┤
│ Photos   │ Thu, 12 Nov  ◯                                         │2026│
│ Explore  │ ▆▆▆▆▆ ▆▆▆▆▆▆▆▆ ▆▆▆▆ ▆▆▆▆▆▆                              │ •  │
│ Sharing  │ ▆▆▆▆▆▆▆▆ ▆▆▆ ▆▆▆▆▆▆▆ ▆▆▆▆▆                              │ •  │
│ ──────── │ Wed, 11 Nov  ◯                                         │2025│◀ date
│ Albums   │ ▆▆▆▆ ▆▆▆▆▆▆▆ ▆▆▆▆▆▆ ▆▆▆▆▆▆▆▆                            │ •  │  scrubber
│ …        │ …                                                      │    │
└──────────┴───────────────────────────────────────────────────────┴────┘
```

| Aspect | Notes |
|---|---|
| Grid | Justified rows grouped by day, with month and year sections. The layout algorithm ("FlexLayout") borrows from text line-breaking: it scores whole sections, lets row height flex around a target (about 180 px is the example) and picks the arrangement with the lowest "badness". **[docs]** |
| Scale tricks | The server sends section summaries first (for example "Jan: 150 photos"). The client estimates each section's height from the count and an average aspect ratio, then corrects it when real data loads. That keeps the scrollbar honest for 250k+ photos. About 50 tiles are rendered at a time, thumbnails are preloaded up to 5 screens ahead in the scroll direction, and scroll and resize work is batched to run once per frame. **[docs]** |
| Placeholders | Tiny pixelated placeholders (889 B against 71 KB for an HiDPI thumbnail) are swapped in with a **100 ms opacity fade**. Sections that have not loaded yet show a CSS texture that looks like photo rows at the target height. **[docs]** |
| Viewer transition | "We scale thumbnails instantly, then fade in the full image." The thumbnail is the first frame of the viewer. **[docs]** |
| Date scrubber | A custom scrollbar on the right with year labels. Hovering shows a date tooltip, and dragging scrubs through years. **[docs]**, **[observed]** |
| Selection | A check circle appears at the top-left of a tile on hover. Once anything is selected, the whole grid switches to selection mode, where a click toggles instead of opening. A day-header checkbox selects the whole day. Shift-click selects a range. The top bar turns into "N selected" with action icons. **[observed]** The keyboard shortcuts `x` (select), `Esc` (clear), `i` (info), `e` (edit), `#` (delete) and `Shift+?` (shortcut help) come from third-party guides. **[docs]** |
| Info panel | A right-side panel of roughly 360 px pushes the photo left instead of covering it. It holds an inline "Add a description" field, the date and time (editable), camera and EXIF data, a location map, people and albums. **[observed]** |
| Upload | Drag files anywhere onto the page to get a full-window drop overlay. A progress toast sits at the bottom left. New items land at their *capture date* in the timeline. **[observed]** |
| Theme | White chrome, a full-black viewer and Material 3 typography (Google Sans). **[observed]** |

### 1.2 Immich (open source, Svelte 5 + Tailwind v4)

A deliberately close, open-source re-implementation of the Google Photos web UI, which makes its numbers reusable. All of
this table is **[source]** unless marked otherwise. Paths are under `web/src/lib/`.

| Aspect | Implementation detail |
|---|---|
| Grid algorithm | `utils/layout-utils.ts` uses `@immich/justified-layout-wasm` by default, with a fallback to Flickr's `justified-layout`. Its options are `rowHeight`, `rowWidth`, `spacing` and `heightTolerance`. |
| Grid numbers | `Timeline.svelte`: `rowHeight: 235`, `headerHeight: 48` on desktop, and `rowHeight: 100`, `headerHeight: 32` below the `md` breakpoint. `GalleryViewer.svelte` (album and search grids): `spacing: 2`, `heightTolerance: 0.5`, `rowHeight` 235 (100 when the viewport is under 850 px). |
| Virtualisation | Assets are grouped into month buckets, with an intersection margin of 500 px above and below the viewport (`tunables.ts`). |
| Thumbnail | `components/assets/thumbnail/Thumbnail.svelte`: <br>• On hover, a **top gradient from `black/25` to transparent at 25 %** fades in, so the white check circle stays readable on any photo. <br>• A selected tile **scales to 0.85 and gets `rounded-xl`**, which leaves a visible gutter, and a `primary/40` overlay fades in over 100 ms. <br>• Video tiles show their duration at the top right. Hovering plays the video or motion photo inline. <br>• Favourite and archive icons sit at the bottom left, and a stack count shows when the item is a stack. <br>• While a selection exists, a "preview" magnifier button appears at the bottom right of a hovered tile, so you can open an item without toggling it. |
| Placeholder | A thumbhash (a compact blurred preview) is rendered first and **faded out over 100 ms** (`THUMBHASH_FADE_DURATION`) once the real image loads. |
| Scrubber | `timeline/Scrubber.svelte` is **60 px wide on desktop and 20 px on touch**. It shows year labels (at least 16 px apart) and month dots (at least 8 px apart). On hover, a date label in a pill follows the pointer with a `row-resize` cursor, and a 2 px primary-coloured line marks the current position. |
| Selection bar | `AssetSelectControlBar.svelte` replaces the top app bar while a selection exists. It shows "✕ N selected" on the left and the action buttons on the right, as an overlay on the same strip rather than a second bar. |
| Keyboard (grid) | `TimelineKeyboardActions.svelte`: <br>• `?` shows the shortcut list, `/` opens search. <br>• `Ctrl+A` selects all, `Ctrl+D` deselects, `Esc` steps back. <br>• `←` and `→` move focus by one asset. `D`, `M` and `Y` jump by day, month or year, and `Shift` reverses the direction. `G` opens "go to date". <br>• `Delete` moves to trash, `Shift+Delete` deletes permanently. `f` toggles favourite, `s` stacks the selection. <br>• Shift-click and shift-arrow select a range. |
| Viewer layout | `asset-viewer/AssetViewer.svelte` is a fixed, full-screen `bg-black` CSS grid with a 64 px top bar row. Previous and next buttons sit in the first and last grid columns, vertically centred. The image fills all four columns, under the bars. |
| Info panel | `DetailPanel` is **`w-90` (360 px)**, enters with **`fly`, 150 ms**, and has a left border in dark mode. The editor panel is `w-100` (400 px) and uses the same slot. Content order: description, star rating, people, date (editable), file details, location (editable, with a map), owner, albums, tags. |
| Inline editing | `DetailPanelDescription.svelte` is a borderless, auto-growing textarea with only a bottom border, which thickens to 2 px in the primary colour on focus. **It saves on blur, and `Ctrl+Enter` commits.** A toast says "Description updated" on success. Nothing saves when the value is unchanged. |
| Filmstrip analogue | For stacks, a horizontal strip of thumbnails runs along the bottom of the viewer. **The current item has a 2 px white border and sits at `bottom: 0`. The others are dimmed to `brightness-70` and dropped 10 px.** This is a ready-made micro-interaction for our filmstrip. |
| Viewer keys | `z` zooms, `s` starts a slideshow, `Ctrl/⌘+C` copies the image, `↑` and `↓` move through a stack, `Esc` closes. |
| Upload | `routes/(user)/DragAndDropUploadOverlay.svelte`: dragging files over the page shows a **full-window overlay (`bg/90`) that fades in over 250 ms, with a bouncing logo and "Drop files to upload"**. Folders dropped this way are walked recursively. The upload progress panel floats at the bottom right. **[observed]** |
| Empty state | `EmptyPlaceholder.svelte` is a rounded-3xl card with an illustration, a title and a light-weight explanation. |
| Theme tokens | `app.css`: light primary `rgb(66 80 175)` (#4250AF), dark primary `rgb(172 203 250)` (#ACCBFA), dark background `rgb(10 10 10)` (#0A0A0A), dark surface `rgb(33 33 33)`. The font is Google Sans. A command palette arrived in v2.4. **[docs]** |

### 1.3 PhotoPrism

| Aspect | Notes |
|---|---|
| Views | **Cards** (photo with its title, time and place), **Mosaic** (photos only, "distraction-free") and **List** (rows). A view button at the top right switches between them. **[docs]** |
| Selection | Click the **lower-right corner** of a tile to start selecting. After that, clicks add items and shift-click selects a range. The hot zone is hard to discover. **[docs]** |
| Viewer | Full screen. `Ctrl+I` toggles the info sidebar, `Ctrl+S` the slideshow, `Ctrl+F` full screen. **[docs]** |
| Editing | A separate **edit dialog** with Details, Labels, People and Files tabs. **Saving is explicit**: Apply saves and keeps the dialog open, while Close discards unsaved changes. It was redesigned for mobile in February 2025. **[docs]** This is the counter-example to inline autosave. **[assumption]** |

### 1.4 Eagle (eagle.cool)

A desktop app built on web technology (Electron) for designers' asset libraries. Of everything studied, its
information architecture matches ours most closely.

```
┌──────────────┬─────────────────────────────────────────┬──────────────┐
│ ▸ All        │  ◀ ▶  Folder name   ───○───── size  🔍 ⧩ │  [Preview]   │
│ ▸ Uncategor. │─────────────────────────────────────────│  name ✎      │
│ ▸ Untagged   │ ▆▆▆▆ ▆▆▆▆▆▆ ▆▆▆ ▆▆▆▆▆                    │  ● ● ● ● ●   │ ◀ colour
│ ▸ Random     │ ▆▆▆▆▆▆ ▆▆▆▆ ▆▆▆▆▆▆▆                      │  tags [+]    │  swatches
│──────────────│ ▆▆▆ ▆▆▆▆▆ ▆▆▆▆▆▆ ▆▆▆                     │  folders [+] │
│ FOLDERS      │                                         │  URL, notes  │
│ ● Brand  (12)│                                         │  size, dims  │
│ ● Web    (40)│                                         │  date        │
│ SMART FOLDERS│                                         │              │
└──────────────┴─────────────────────────────────────────┴──────────────┘
   sidebar            image list (justified by default)     inspector
```

| Aspect | Notes |
|---|---|
| Anatomy | Sidebar (navigators and folders), toolbar (navigation, size slider, search, filter), image list, and an inspector on the right. **[docs]** |
| Layouts | **Justified** is the default ("each image won't be cropped"). **Waterfall** (masonry) is for tall screenshots, **Grid** uses fixed frames, and **List** is compact. You can switch with `Alt+1`, `Alt+2`, … or by right-clicking empty space. **[docs]** |
| Density | A thumbnail-size slider sits in the centre of the toolbar. `Alt`+scroll wheel and `⌘+` / `⌘−` resize as well. **[docs]** |
| Folders | Folders have colours and icons, and show item counts. Smart folders are built from rules on name, tag, colour or format. An item can belong to several folders ("+" in the inspector). Auto-tag assigns a folder's tags to everything in it. **[docs]** |
| Inspector | **Content depends on the selection.** With nothing selected it shows the folder's info (count, size, date). With one item it shows editable title, URL, tags and folders, colour swatches and file facts. With several it offers batch editing. **[docs]** A tag box creates, adds, removes and searches tags in one control. **[docs]** |
| Filters | The advanced filter next to search combines **tag, colour, shape (orientation) and type**. Left-click includes a tag, right-click excludes it. A scope dropdown limits search to name, extension, tag or URL. **[docs]** |
| Viewer | **Spacebar** opens an instant preview, and the arrow keys move between items. Hovering previews GIFs, video and audio without opening them. `Z` zooms to a hovered item. "Focus zooming" lets you zoom precisely into detail. **[docs]** |
| Mixed media | It previews fonts, audio (MP3, WAV, FLAC and more) and video, and says "any file format" can be imported. Non-previewable files get file-type tiles. **[docs]** |

### 1.5 Cloudinary Media Library / Assets (DAM)

| Aspect | Notes |
|---|---|
| Folders | A **folder tree pane, open by default**. Its search field filters folders and still shows each match's parents and siblings for context. The current folder's breadcrumb sits at the top left, with a cloud icon for the root. **[docs]** |
| Grid | **Sub-folders appear as small tiles above the assets** of the current folder. In non-folder views (search results, collections), each asset card carries a link to its folder, and right-click offers "Open containing folder". **[docs]** |
| Selection and bulk | After selecting, an asset toolbar offers Move to folder (⋯ menu) and Add to collection (share icon). Assets can be **dragged onto a folder in the tree or the grid**. **[docs]** |
| Preview pane | **Single-clicking a folder opens a summary pane** with total assets, size and last upload date. **[docs]** |
| Upload | An Upload button, or drag files into the selected folder. Uploading straight into a collection is not allowed. **[docs]** |
| Search | Global search covers folders, assets and collections. "Search this folder" filters by asset type, and further filters combine with AND. **[docs]** |

### 1.6 Bynder and Brandfolder (enterprise DAM)

| Aspect | Notes |
|---|---|
| Brandfolder | Hover a card and press **View** to open a **modal with 7 tabs**: Overview, Metadata, Similar, Embed, Usage, Workflow and Edit. The Overview tab has the preview on the left and attachments and downloads on the right. Editing is split into Asset Details (name, description, tags) and Custom Fields. Up to 5 prioritised custom fields can be shown on the grid card. **[docs]** |
| Bynder | An asset detail view that collects metaproperties, automated tags, copyright, rights and licensing in one place. A sidebar has Collections and Versions tabs. **[docs]** |
| Takeaway | Strong on metadata, heavy on chrome. Tabs, modals and edit modes add clicks. Worth borrowing: "show N chosen fields on the card" and the "Similar / duplicates" idea. **[assumption]** |

### 1.7 Frame.io V4 (review and collaboration)

| Aspect | Notes |
|---|---|
| Panels | A **three-panel system**: navigation on the left, the player in the centre, comments and properties on the right. Each panel toggles from the top-right corner, and they can all be collapsed for a "distraction-free focus" view. **[docs]** |
| Grid appearance | An Appearance menu sets **card size, aspect ratio and thumbnail scale (fit or fill)**, and **which metadata fields show on cards**. The grid or list choice persists per workspace. **[docs]** |
| Hover scrub | Video cards scrub as the pointer moves across them, and still do after a long jump down the scrollbar, thanks to a two-tier data load. Folders hover-scrub through their contents. **[docs]** |
| Feel | "More akin to a beautifully crafted iOS app than a website." The team tuned it frame by frame from screen recordings. Updates are optimistic, and **uploads run in a Web Worker** so the UI never stutters. **[docs]** |
| Colour | A palette **built in the LCH colour space** for perceptual uniformity, light and dark themes, attention to colour-vision deficiency, and user-customisable accents. **[docs]** |
| Viewer | Frame-accurate hover preview, zoom and a mini-map. A "pocket" player can stay open while you browse the grid. **[docs]** |

### 1.8 Dropbox and Google Drive

| Aspect | Notes |
|---|---|
| Dropbox preview | Two modes the user can choose between: **Full screen**, or **Quick view, where the preview takes the right half and the file list stays on the left.** Mobile swipes between files. **[docs]** Quick view is a web precedent for "detail mode that keeps the collection visible". |
| Drive hovercards | Hovering a file icon shows a card with a landscape thumbnail, file type, owner and last-modified details. **[docs]** |
| Drive viewer (December 2025) | A refreshed file viewer. PDFs get a **left rail with page thumbnails and a table of contents**. **[docs]** |

### 1.9 Sanity Media Library: 2025–26 asset-grid refresh (bonus)

A small, very relevant changelog about polish details in a CMS media grid. **[docs]**

- Previews are a uniform size, **titles line up across each row**, and **the grid no longer shifts while thumbnails
  load**.
- Status is shown with tiny marks: a dot for drafts, a chip for shortcuts, and avatars for who else is viewing.
- **Long file names are truncated in the middle**, so the extension stays visible, and the full name shows on hover.
- Hover highlights a card, keyboard focus marks it more strongly, and selection is strongest of all. That is three
  clear visual levels.
- **Transparent images show the same light checkerboard in both themes.**
- **Video thumbnails scrub on hover, with a thin progress bar that shows only while the pointer is on the preview.**
- `Esc` clears the selection first, then focus.
- The preview in the sidebar scales with the window, so wide and square assets display at a similar size.

### 1.10 Client galleries (Pixieset, SmugMug, Format, Pic-Time)

| Aspect | Notes |
|---|---|
| Controls | These tools sell polish to photographers. Their controls stay deliberately coarse: **thumbnail size Regular or Large, spacing Regular or Large**, plus an option to emphasise vertical or horizontal images (Pixieset). Format offers Grid, Square or Masonry, with a Fixed or Flexible grid style. **[docs]** |
| Look | A full-bleed cover image, generous white space, thin type, and a minimal lightbox on white or black. **[observed]** |
| Takeaway | Two or three presets with good defaults beat a continuous slider for most users. A slider is still useful for power users (Eagle, Google Photos zoom). **[assumption]** |

### 1.11 WordPress-adjacent

**Gutenberg DataViews grid** (the component behind the new admin screens) **[docs]**

| Concept | API |
|---|---|
| Card anatomy | `mediaField`, `titleField`, `descriptionField`, and `badgeFields` (shown without labels, as badges) |
| Density | `density: 'comfortable' \| 'balanced' \| 'compact'` sets the gap. `previewSize` is a number. |
| Shape | `aspectRatio: '1/1' \| '4/3' \| '16/9'` (default `1/1`) and `mediaFit: 'cover' \| 'contain'`. With `config.mediaFitControl`, users get an **"Original aspect ratio"** toggle. |
| Selection | Cmd/Ctrl-click selects several items. **Bulk actions render inside the grid layout**; the separate `BulkActionToolbar` is deprecated. Items are only selectable when at least one action sets `supportsBulk`. |
| Filters | Each filter has a field, an operator and a value. `isPrimary` filters are always visible, and the rest sit under "Add filter". Global search covers fields with `enableGlobalSearch`. |
| Scrolling and grouping | `infiniteScrollEnabled`. The grid can **group by a field** (Gutenberg 21.3), and user view customisations persist (21.9). |
| Editing | `DataForm` has Regular, Panel, Card, Row and Details layouts, and `onChange` receives only the edits. |

Its value for us is shared vocabulary and familiarity for WordPress users. It is not visual inspiration: it uses
square cards and the default admin styling. **[assumption]**

**Media-folder plugins** **[docs]**

- **FileBird**: virtual folders (moving a file never changes its URL), drag-and-drop, context menus, and import from
  HappyFiles and Real Media Library.
- **HappyFiles**: drag-and-drop, plus a collapsible sidebar that remembers the most recent folder.
- **Real Media Library**: drag-and-drop, file shortcuts (one file in several folders) and a list mode.

All three graft a tree onto the left of the legacy `upload.php` grid. None of them changes the item modal. **[observed]**

### 1.12 Figma asset panels (brief)

The Assets panel is a left column with search at the top, collapsible library sections, and a toggle between list and
grid of thumbnails. Hovering shows the full name and the source library, and items are dragged out onto the canvas.
Its value for us is a compact, quiet left column that keeps working at 240–320 px wide. **[observed]**

---

## 2. Cross-cutting comparison

| Dimension | Google Photos | Immich | Eagle | Cloudinary | Frame.io | DataViews |
|---|---|---|---|---|---|---|
| Grid style | justified | justified | justified (default), waterfall, grid, list | square cards | cards with a set aspect ratio | square or set aspect ratio |
| Density control | pinch / `Ctrl`+wheel **[observed]** | none (breakpoint only) | slider, `Alt`+wheel, `⌘+/−` | none | card size and scale | 3 density presets and a preview size |
| Folders / collections | albums page | albums page, folder tree view | **left sidebar tree** | **left tree pane** | left navigation panel | n/a |
| Selection | hover check, mode switch, shift range | same, plus keyboard ranges | click, shift, ⌘, rubber band **[observed]** | checkbox, then toolbar | checkbox | Cmd/Ctrl-click |
| Bulk bar | top bar becomes "N selected" | same | inspector switches to batch mode | toolbar | toolbar | inside the layout |
| Viewer | full-bleed black route | full-bleed black route | space-bar quick look | drawer / page | 3-panel player | n/a |
| Info panel | right, pushes the image | right, 360 px, fly 150 ms | always-on right inspector | preview pane | right panel | DataForm panel |
| Editing | inline, saves on blur | inline, saves on blur, `Ctrl+Enter`, toast | inline in the inspector | form | properties panel | form with change set |
| Upload | drop anywhere, toast | drop anywhere, overlay, panel | drag from anywhere, browser extension | button or drop on a folder | background worker | n/a |
| Placeholder | pixelated tiny JPEG with a 100 ms fade | thumbhash with a 100 ms fade | n/a (local files) | grey box | two-tier load | n/a |

---

## 3. Grid layouts in depth

| Style | Used by | Pros | Cons | Fit for us |
|---|---|---|---|---|
| **Square crop** | Instagram profile, Cloudinary, DataViews, the WordPress media grid | Predictable; row order is obvious; titles align; mixed media looks uniform; cheap to build (CSS grid) | Crops content, so panoramas and tall images lose meaning; looks "admin" | Good as an alternative "compact" or list-like mode **[assumption]** |
| **Justified rows** | Google Photos, Immich, Flickr, Eagle | No cropping; edge-to-edge; reads left to right in sort order; looks premium | Needs JS layout; the size of an item depends on its neighbours; resizing reflows the rows | **Best default** for an image-first, sorted library **[assumption]** |
| **Masonry columns** | Pinterest, Unsplash, Eagle "waterfall" | Great for tall assets and browsing for inspiration | Order runs down columns, so sequence is ambiguous; keyboard navigation and range-select feel odd; items appended at the end jump between columns | Avoid as the default; offer it at most as an option **[assumption]** |

Implementation notes:

- **Flickr `justified-layout`** defaults to `targetRowHeight` 320, `targetRowHeightTolerance` 0.25, `boxSpacing` 10 and
  `containerPadding` 10. `forceAspectRatio` turns it into a uniform grid. `fullWidthBreakoutRowCadence` inserts a
  full-width "hero" row every *n* rows. `showWidows` controls the last row. **[docs]**
- **Immich** uses a WASM port (`@immich/justified-layout-wasm`) for speed, with a 2 px gap, tolerance 0.5 and a row
  height of 235 or 100 px. **[source]**
- **Native masonry**: CSS `display: grid-lanes` has shipped in Safari 26.x. Chrome and Firefox only have it behind
  flags, and MDN does not list it as Baseline. A JS layout is therefore still needed, with `@supports` for progressive
  enhancement. **[docs]**
- **The last row**: justified grids keep an incomplete last row at the target height instead of stretching it, so it
  sits left-aligned. **[docs]** (Flickr's `showWidows`) The same applies at the end of each date or folder group.
- **Placeholders and stability**: reserve each box from stored width and height before the image loads. WordPress
  attachments already carry `media_details.width/height`. **[assumption]** Then paint a placeholder (dominant colour,
  blurhash or thumbhash) and fade in the real image. The Unsplash API returns both `color` and `blur_hash` for this.
  **[docs]**

**Rendering non-images in a media grid**

| Type | Common treatment | Sources |
|---|---|---|
| Video | Poster frame, a duration badge at the top right, a ▶ glyph. Plays on hover (Immich, Eagle) or **scrubs on hover with a thin progress bar** (Frame.io, Sanity). | **[source]** **[docs]** |
| Animated GIF | Still frame, plays on hover (Eagle). | **[docs]** |
| Audio | Waveform or generic tile with the file type and duration. Plays on hover (Eagle). | **[docs]** |
| PDF | First-page render. In the viewer, a page-thumbnail rail (Drive, December 2025). | **[docs]** |
| SVG / transparent PNG | **A neutral checkerboard that looks the same in both themes** (Sanity), `contain` fit. | **[docs]** |
| Other files | A large type glyph or coloured extension label on a tinted tile, with the file name **truncated in the middle** to keep the extension visible. | **[docs]** (Sanity) |

In a justified grid, items without dimensions (audio, generic files) need a fixed aspect ratio, usually 1:1 or 4:3, so
they do not distort their rows. **[assumption]**

---

## 4. Viewer / detail mode and the transition

```
GRID ──click / Enter──▶ DETAIL (route /media/:id, keeps the grid's sort and filter)
 ▲                      ┌──────────────────────────────────────────────┬──────────┐
 │                      │ ← Back  filename.jpg            ⓘ ✎ ⋯       │ Info     │
 │                      │                                              │ ──────── │
 │                      │            [ large preview ]                 │ Title ✎  │
 │                      │      ◀                              ▶        │ Alt ✎    │
 │                      │                                              │ Caption  │
 │                      │──────────────────────────────────────────────│ Folder   │
 │                      │ ▫ ▫ ▫ ▣ ▫ ▫ ▫ ▫ ▫   filmstrip (grid order)   │ Sizes/URL│
 └──────Esc / Back──────┴──────────────────────────────────────────────┴──────────┘
  (on return, scroll to and briefly highlight the last viewed item)
```

| Product | Entry | Collection still visible? | Panels | Exit |
|---|---|---|---|---|
| Google Photos | The thumbnail scales instantly, then the full image fades in **[docs]** | No (full screen) | Info pushes the image | `Esc` / ←; grid restored |
| Immich | Full-screen route; thumbhash first **[source]** | Stack strip only | 360 px info or 400 px editor, fly 150 ms **[source]** | `Esc` |
| Eagle | Space-bar quick look **[docs]** | No | The inspector stays on | Space / `Esc` |
| Dropbox | Quick view **[docs]** | **Yes, the list on the left** | Preview on the right | Close |
| Frame.io | Player in the centre panel **[docs]** | Optional left panel | Toggle every panel | Back |
| Brandfolder / Bynder | Modal or detail page **[docs]** | No | Tabs | Close |

None of the web apps studied combines a filmstrip in grid order with toggleable side panels and a URL-addressable route.
That combination is the gap our "Lightroom-style detail mode" would fill on the web. Immich's stack strip is the
nearest visual precedent. **[assumption]**

---

## 5. Patterns to adopt (ranked)

| # | Pattern | Why | Seen in |
|---|---|---|---|
| 1 | **Justified grid that reserves boxes from known dimensions, with a placeholder colour or hash and a 100 ms fade-in** | The biggest single contributor to "looks premium": nothing is cropped, nothing jumps, and the grid feels instant. WordPress already stores the dimensions. | Google Photos, Immich, Sanity |
| 2 | **Detail mode as its own route, with a filmstrip in grid order and toggleable right panels that push the content instead of covering it** | Deep-linkable, works with the Back button, keeps the user oriented in the collection, and avoids the claustrophobic WordPress modal. | Immich, Google Photos, Frame.io, Dropbox quick view |
| 3 | **Shared-element transition between grid and detail** (thumbnail → hero, then load the full image; reverse on exit, scroll back to the item and highlight it briefly) | It is what makes the round trip feel seamless. The View Transitions API can do it in a few lines; without it, scale the thumbnail with FLIP. | Google Photos (instant scale, then fade) |
| 4 | **Inline edit fields that autosave on blur, with `Ctrl/⌘+Enter` to commit and a quiet confirmation** (an inline tick or "Saved" rather than a modal), plus optimistic UI | Removes Save buttons and edit modes. Lightroom-like flow. Optimistic updates keep it fast. | Immich, Google Photos, Frame.io |
| 5 | **Hover-revealed check circle on a subtle top gradient; once anything is selected, clicks toggle; shift-click for ranges; the top bar morphs into "✕ N selected · actions"** | A well-known model (Google Photos) that keeps tiles clean and makes bulk work quick. A "preview" button on hovered tiles still opens the item while selecting. | Google Photos, Immich |
| 6 | **Selected-tile feedback: the tile shrinks to about 0.85, rounds its corners and gets an accent overlay at about 40 %** | Readable at a glance, even at high density; feels tactile. | Immich |
| 7 | **Selection-aware inspector**: no selection shows the folder summary, one item shows editable fields, several show batch editing of the shared fields | One panel does three jobs and is never empty. | Eagle, Cloudinary (folder preview) |
| 8 | **Folder column**: a quiet tree with colour dots and counts, a filter box that keeps the parents of matches, drop targets for moving items, collapsible, remembers the last folder | FileBird users expect folders. Eagle and Cloudinary show how to do it well. | Eagle, Cloudinary, HappyFiles |
| 9 | **Drop anywhere to upload: a full-window overlay that fades in over about 250 ms; uploads appear at once in the grid as placeholder tiles with progress rings; a compact upload tray** | Feels magical and removes the separate "upload page". Uploading in a worker keeps the UI smooth. | Immich, Google Photos, Frame.io |
| 10 | **Density control**: a size slider with snapped steps, plus `Ctrl/⌘ +/−`, persisted per user. Optionally layout presets (justified, square, list), like DataViews density or Eagle's layout switch. | Different tasks need different sizes; persistence respects user intent. | Eagle, Frame.io, DataViews |
| 11 | **Keyboard model**: `?` help sheet, arrows to move, `Enter` / `Space` to open, `Esc` that steps back one level (clear selection, then close panel, then leave detail), `i` for info, `x` to select, `Del` to trash | Power users stay fast, and visible hints in tooltips teach the keys. | Immich, Google Photos, Eagle, Sanity |
| 12 | **Filter chips under the search field**: type (image, video, audio, document), date, folder, "missing alt text", orientation, colour. Primary chips stay visible; more sit behind "+ Filter". A command palette is optional later. | Faceted search without a heavy filter form. | Eagle, DataViews, Immich 2.4 palette |
| 13 | **Mixed-media tiles**: video duration badge with hover scrub and a thin progress line; PDF first page; checkerboard behind transparency; file names truncated in the middle | Non-image items look first-class instead of broken. | Sanity, Frame.io, Eagle |
| 14 | **Sticky group headers** (date or folder) in the grid, with a group-select checkbox; optionally a slim date scrubber on the right edge | Orientation in large libraries. The scrubber matters most when the library is sorted by date. | Google Photos, Immich |
| 15 | **Skeletons that look like the content** (row-shaped shimmer at the target row height) instead of spinners, and illustrated empty states with one clear call to action ("Drop files here or Upload") | The load and the empty state are the user's first impression. | Google Photos, Immich |

## 6. Patterns to avoid

- **Modal or tabbed asset dialogs** (WordPress attachment modal, Brandfolder's 7-tab modal). They hide the collection,
  are not addressable by URL and stack chrome on top of chrome.
- **Explicit Apply/Close edit dialogs that discard changes** (PhotoPrism). They risk lost work and add friction.
- **Hard-to-find selection hot zones** (PhotoPrism's "click the lower-right corner").
- **Masonry as the default for a sorted library.** The order becomes ambiguous and keyboard or range selection gets
  confusing.
- **Square-crop-only grids for a photo-centric site.** They look like an admin tool, and our goal is to feel better
  than WordPress.
- **Layout shift while thumbnails load** (Sanity's changelog calls this out as something they fixed).
- **Spinners in the middle of the grid,** or blocking the UI while uploads run.
- **A permanent always-on inspector on small screens.** Collapse it to a sheet or a toggle instead.
- **Too many density knobs** (card size, aspect ratio, scale and metadata, as in Frame.io and DataViews) in the main
  toolbar. Hide everything beyond size and layout in a "View options" popover.
- **Toasts for every save.** Immich toasts each description update; an inline "Saved ✓" next to the field is quieter.
  **[assumption]**

## 7. Visual style observations

| Area | What sleek media apps do | Source |
|---|---|---|
| Canvas | Images are the colour. Chrome is neutral grey with one accent hue. In dark mode, use a **near-black background (#0A0A0A to #121212), not pure black,** with surfaces one or two steps lighter (#1A1A1A to #212121). The viewer canvas is often true black. | Immich tokens **[source]**, Google Photos **[observed]** |
| Accent | One saturated accent, such as indigo or blue: Immich uses #4250AF on light and a pastel #ACCBFA on dark, because a dark theme needs a *lighter, desaturated* accent. Frame.io builds its palette in **LCH** so steps are perceptually even. | **[source]** **[docs]** |
| Typography | A humanist or geometric sans (Google Sans, Inter, SF). Small (12–13 px) medium-weight labels on tiles, a 14 px body in panels, tabular numbers for sizes and dates, and middle truncation for file names. | Immich **[source]**, Sanity **[docs]** |
| Spacing | **Tight gutters in the grid (2–4 px)**, so the images form one surface, against **generous padding in panels (16–24 px)**. Panels are about 360 px wide, and the left column 240–320 px. | Immich **[source]** |
| Shape | Mostly square tile corners (images flush) with rounded corners only for the *selected* state. Panels, popovers and chips use 8–12 px radii; empty states and cards up to 24 px. | Immich **[source]** |
| Overlays | Gradients (black/25 to transparent) instead of solid bars behind icons on tiles; white icons with a subtle shadow; badges that are small translucent pills. | Immich **[source]** |
| Motion | **Short and functional**: 100 ms fades for image swaps and selection, about 150 ms slide for panels, 200–250 ms for overlays and page transitions; ease-out on enter, ease-in on exit. Motion carries meaning (the thumbnail grows into the hero image). Honour `prefers-reduced-motion`. | Google Photos **[docs]**, Immich **[source]**, Frame.io **[docs]** |
| Feedback levels | Distinct states for hover, keyboard focus and selected, getting stronger in that order. | Sanity **[docs]** |
| Theme | Light and dark both first-class. Transparent images get the same checkerboard in either theme. The viewer can stay dark even in the light theme (Google Photos, Immich). | **[docs]** **[source]** |

## 8. Open questions for the design phase

1. **Default grid style:** justified (photo-first) or square (uniform, admin-familiar)? Offer both, with justified as
   the default? What target row height (Immich uses 235 px; Flickr defaults to 320) and gutter (2 px or 4–8 px)?
2. **Sort and grouping:** WordPress sorts by upload date. Should the grid group by day or month with sticky headers and
   a scrubber, or show a flat grid when a FileBird folder is active? Should new uploads always appear at the top?
3. **The detail-mode filmstrip:** fixed thumbnail height or justified mini-strip? Square crops in the filmstrip for
   rhythm? Show the current item raised and the others dimmed (Immich), or use a bordered highlight?
4. **Panel layout in detail mode:** one tabbed right panel (Info | Edit) or two separate toggleable panels? Should the
   panels push the image or overlay it at narrow widths? Should they also be available in grid mode (Eagle style, with
   batch editing)?
5. **Viewer background:** always dark (Google Photos, Immich), or following the theme? Light-on-dark is better for
   judging images but makes the round trip in light mode more jarring.
6. **Save model:** autosave on blur for every field, or autosave plus an "undo" toast? How should a failed save show,
   and what happens on conflicting edits?
7. **Selection model:** Google Photos style (hover check, then selection mode) or desktop style (click selects,
   double-click opens, rubber band)? The second is closer to Lightroom and Eagle; the first is more familiar on the web
   and on touch.
8. **Folder column:** a tree or a flat list with nesting arrows? Show counts? Colour dots (does FileBird expose folder
   colours)? Minimum and maximum widths and collapse behaviour?
9. **Non-image items:** how much effort to put into PDF first-page renders, audio waveforms and video hover scrub?
   WordPress provides PDF thumbnails for some setups but not for audio or video posters.
10. **Density control:** a continuous slider, or 3 presets (S/M/L, as in DataViews and Pixieset)? Persist it per device
    (`localStorage`) or per user (server)?
11. **Search:** a simple search box with chips, or a command palette (`⌘K`) from the start?
12. **Motion budget:** use the View Transitions API with a fallback, or hand-rolled FLIP? Same-document view
    transitions are believed to work in Chromium, Safari 18+ and Firefox 144+, but that needs checking.
    **[assumption]** And what is the reduced-motion behaviour?

---

## Sources

**Google Photos**
- Harasymiv, *Building the Google Photos Web UI* (Google Design, Medium): https://medium.com/google-design/45b714dfbed1. Fetching it returned 403, so the details were taken from a mirror of the same post.
- Mirror and repost of that article: https://forbsite.blogspot.com/2025/06/google-photos.html
- Dan Schlosser, *Building the Image Grid from Google Photos*: https://medium.com/@danrschlosser/building-the-image-grid-from-google-photos-6a09e193c74a
- Keyboard shortcut guides: https://www.guidingtech.com/google-photos-keyboard-shortcuts/, https://techlomedia.in/guides/google-photos-keyboard-shortcuts/

**Immich**
- Source code: https://github.com/immich-app/immich. Files read, under `web/src/lib/`: `utils/layout-utils.ts`, `utils/tunables.ts`, `components/timeline/{Timeline,Scrubber,AssetSelectControlBar}.svelte`, `components/timeline/actions/TimelineKeyboardActions.svelte`, `components/assets/thumbnail/Thumbnail.svelte`, `components/asset-viewer/{AssetViewer,PhotoViewer,DetailPanel,DetailPanelDescription}.svelte`, `components/shared-components/{gallery-viewer/GalleryViewer,EmptyPlaceholder}.svelte`. Also read: `web/src/app.css` and `web/src/routes/(user)/DragAndDropUploadOverlay.svelte`.
- DeepWiki overview: https://deepwiki.com/immich-app/immich/3.5-timeline-and-asset-display
- Immich 2.4 (command palette): https://linuxiac.com/immich-2-4-released-with-command-palette-and-ui-refinements/
- Milestones: https://immich.app/milestones

**PhotoPrism**
- Result views: https://docs.photoprism.app/user-guide/search/views/
- Edit dialog: https://docs.photoprism.app/user-guide/organize/edit/
- User interface: https://docs.photoprism.app/user-guide/navigate/

**Eagle**
- User interface: https://en.eagle.cool/support/article/eagles-user-interface
- Inspector: https://en.eagle.cool/article/477-interface-inspector
- Switching layouts: https://docs-en.eagle.cool/article/555-switching-layouts
- Toolbar: https://docs-en.eagle.cool/article/476-interface-toolbar
- Eagle 4 product page: https://eagle.cool/
- Tag filtering: https://kr.eagle.cool/blog/post/stop-relying-on-your-eyes-supercharge-your-creative-workflow-with-eagles-tag-filtering
- Organising a media library: https://core.eagle.cool/blog/post/how-to-organize-media-library

**Cloudinary**
- Folders, collections and sharing: https://cloudinary.com/documentation/dam_folders_collections_sharing

**Bynder and Brandfolder**
- Bynder asset detail view: https://support.bynder.com/hc/en-us/articles/21745299220882 (403 when fetched; search-result summary only)
- Brandfolder asset modal: https://help.smartsheet.com/articles/2482883-The-Anatomy-of-the-Asset-Modal
- Brandfolder view options: https://help.smartsheet.com/articles/2482988-View-Options

**Frame.io**
- V4 design and navigation: https://blog.frame.io/2024/05/21/frame-io-v4-web-app-beta-feature-focus-new-design-smooth-navigation/
- February 2025 releases: https://blog.frame.io/2025/03/11/whats-new-in-frame-io-version-4-february-2025-releases/
- Adobe V4 announcement: https://blog.adobe.com/en/publish/2024/10/14/frameio-v4-the-fully-reimagined-platform-is-now-available-for-all

**Dropbox and Google Drive**
- Dropbox preview: https://help.dropbox.com/files-folders/sort-preview/preview
- Drive hovercards: https://workspaceupdates.googleblog.com/2024/05/preview-files-in-google-drive-with-hovercards.html
- Drive file viewer redesign: https://workspaceupdates.googleblog.com/2025/12/google-drive-web-modern-file-viewer-interface.html

**Sanity**
- Media Library asset grid: https://www.sanity.io/docs/changelog/apiChange-ml-fuzzy-taxis-search.md

**Client galleries**
- Pixieset help: https://help.pixieset.com/hc/en-us/articles/115003795652
- Pixieset blog: https://blog.pixieset.com/blog/best-photo-gallery
- Format client galleries: https://help.format.com/en/articles/3780101-proofing-design-options

**WordPress**
- DataViews reference: https://developer.wordpress.org/block-editor/reference-guides/packages/packages-dataviews/
- Gutenberg 21.3: https://make.wordpress.org/core/2025/07/30/whats-new-in-gutenberg-21-3/
- Gutenberg 21.4: https://make.wordpress.org/core/2025/08/14/whats-new-in-gutenberg-21-4-13-august/
- DataViews in WordPress 7.0: https://make.wordpress.org/core/2026/03/04/dataviews-dataform-et-al-in-wordpress-7-0/
- Media library goals (2023): https://make.wordpress.org/core/2023/07/07/media-library/
- FileBird: https://wordpress.org/plugins/filebird
- Folder plugin comparison: https://www.uipress.co/uixpress-vs-filebird
- HappyFiles review: https://yaycommerce.com/?p=68427
- WordPress DAM plugins: https://wbcomdesigns.com/wordpress-digital-asset-management-plugins/

**Grid layouts**
- Flickr justified-layout: https://flickr.github.io/justified-layout/
- WebKit, when CSS Grid Lanes will arrive: https://webkit.org/blog/17758/when-will-css-grid-lanes-arrive-how-long-until-we-can-use-it/
- MDN, Grid Lanes: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout/Grid_lanes
- Unsplash API (`color` and `blur_hash` fields): https://unsplash.com/documentation#get-a-photo
- Unsplash-clone masonry write-up: https://gh.r-mj.com/PranjalMaithani/unsplash
