# 05 — UX inspiration from pro photo/media desktop apps

Track E of the media-manager research. Goal: extract proven interaction and layout patterns from professional photo/media desktop apps (Lightroom Classic, Lightroom (cloud), Capture One, Apple Photos, Adobe Bridge, Photo Mechanic, darktable) and map them to a web-based WordPress media manager. This document is research only. It feeds the design-system and visual-design work in the next iteration.

**Confidence markers**

| Marker | Meaning |
|---|---|
| **[docs]** | Confirmed in vendor documentation (Adobe, Apple, Capture One, Camera Bits, darktable). The text was read directly or via search-engine extracts of the page. |
| **[observed in tutorials]** | Described in third-party tutorials, reviews or vendor community threads. |
| **[assumption]** | Based on product familiarity or inference, not verified against a source in this session. Verify before relying on exact details. |

> Note on sources: `helpx.adobe.com` and `support.captureone.com` block automated fetching (HTTP 403). Facts from those pages were taken from search-engine extracts of the official pages, which are cited. Apple, darktable and Camera Bits pages were read directly.

---

## Summary

- **One collection, many lenses.** Every app studied treats grid and single-item view as two *views of the same ordered, filtered collection*, not as separate pages. Selection, sort and filter carry over between views, and the filmstrip is that same collection laid out in one row. This is the backbone of the owner's Lightroom-style vision, and it maps cleanly to a web SPA with one shared "collection state" store.
- **Single-key mode switching** (`G` grid, `E`/`Enter`/`Space` detail, `Esc` back) is universal and cheap to learn. Apple Photos adds a **zoom transition** from the thumbnail into the detail view and back, which is what makes the switch feel seamless instead of like navigation.
- **Panels are toggled, not dismissed.** Lightroom Classic's model (left/right panel groups, `Tab` for both sides, `Shift+Tab` for everything, per-side keys, drag-to-resize, collapse to an edge strip, persisted per view) is the best-documented reference. Lightroom (cloud) simplifies it to *one* right-hand panel slot with an icon rail (Edit / Info / Keywords), which fits WordPress better.
- **Batch metadata editing is a known pain point.** Lightroom Classic's "Target Photo vs Selected Photos" plus "Auto Sync" model confuses even experienced users (many Adobe community threads). Apple Photos and Lightroom (cloud) use the simpler "edit with N selected → applies to all N" model. Photo Mechanic adds **"Save & next"** for per-item caption work. For alt text (unique per image) the "save & next" flow matters more than batch apply.
- **Neutral dark-grey chrome is deliberate.** A neutral surround avoids shifting how colours and contrast are perceived. darktable documents that a very dark surround makes images look darker and leads to over-processing. Accent colour is used sparingly, for selection and active state only.
- **Avoid:** develop/editing modules, Quick Develop, catalog/import concepts, module pickers, five-mode view switching (Compare/Survey are optional extras), floating tool palettes, and the full IPTC field zoo. WordPress has four editable text fields (title, alt, caption, description) plus folder, so the info panel can be far simpler and friendlier.

---

## 1. Adobe Lightroom Classic — Library module

The most complete reference for "grid ↔ loupe + filmstrip + side panels". Its complexity is also the main cautionary tale.

### 1.1 Layout anatomy

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Identity plate                    Library | Develop | Map | ... (F5)       │  ← module picker
├────────────┬───────────────────────────────────────────────┬─────────────┤
│ LEFT (F7)  │ Library Filter bar: Text | Attribute | Metadata│ RIGHT (F8)  │
│ Navigator  │ ───────────────────────────────────────────── │ Histogram   │
│ Catalog    │                                               │ Quick Develop│
│ Folders    │        GRID (G) / LOUPE (E) / COMPARE (C)     │ Keywording  │
│ Collections│        / SURVEY (N)                           │ Keyword List│
│ Publish    │                                               │ Metadata    │
│ Services   │                                               │ Comments    │
│            │ ───────────────────────────────────────────── │             │
│[Import]    │ Toolbar (T): view btns, sort, painter, flags, │ [Sync Meta] │
│[Export]    │ stars, labels, rotate, thumb-size slider      │ [Sync Sett.]│
├────────────┴───────────────────────────────────────────────┴─────────────┤
│ [1][2]  ◀ ▶  Source indicator: "Folder: Trip / 312 photos / 3 sel / x.jpg" │  ← filmstrip header
│ ▭ ▭ ▭ ▭ [▣] ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭ ▭     Filter: ★ ⚑ ●   │  ← FILMSTRIP (F6)
└──────────────────────────────────────────────────────────────────────────┘
```

- Four edge regions (module picker top, left group, right group, filmstrip bottom) around a central work area. Each can be shown or hidden on its own **[docs]** ([Workspace basics](https://helpx.adobe.com/lightroom-classic/desktop/workspace/workspace-basics.html)).
- Left = *where* (sources: folders, collections). Right = *what about the current item(s)* (metadata, keywords). This "sources left, properties right" split appears in every app studied, and it matches the owner's vision (FileBird folders left, info/edit right).
- The **toolbar** under the work area (toggle `T`) holds view-mode buttons, sort, flag/rating/label controls and the thumbnail-size slider. Its contents can be customised from a dropdown **[docs]** ([Dummies cheat sheet](https://www.dummies.com/article/technology/software/adobe-products/lightroom/adobe-photoshop-lightroom-classic-for-dummies-cheat-sheet-261807/) lists `T`). Contents are **[assumption]**.

### 1.2 View modes and switching

| Mode | Key | What it is | Relevance to WP |
|---|---|---|---|
| Grid | `G` (also `Esc` from Loupe) | Thumbnail grid of the current source | Core |
| Loupe | `E` or `Enter` | Single large image. Click/`Z` toggles fit ↔ 100% | Core ("detail mode") |
| Compare | `C` | Two images side by side: "select" vs "candidate" | Optional ("compare two versions") |
| Survey | `N` | All selected images fitted into the work area | Optional (review a multi-selection) |
| Full screen preview | `F` | Image fills the screen, no chrome | Nice to have |
| Lights out | `L` | Cycles lights on → dim → off (UI darkened around image) | Optional |

Sources: Adobe shortcut table (Grid `G`/`Esc`, Loupe `E`/`Enter`, Compare `C`, Survey `N`) **[docs]** ([Keyboard shortcuts](https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/keyboard-shortcuts.html)). `L` cycles dim and blackout **[observed in tutorials]** ([Fstoppers](https://fstoppers.com/lightroom/keyboard-shortcuts-actually-speed-lightroom-classic-718346); community threads describe the "Lights on → dim → out" cycle and a configurable screen colour in Preferences > Interface: [Adobe community](https://community.adobe.com/t5/lightroom-classic-discussions/photo-gets-black-using-dim-lights-out-mode/td-p/13015417)).

**How the transition feels.** Grid → Loupe is an instant swap in the centre area. There is no animated zoom. The side panels and filmstrip stay where they are, so the surrounding chrome is stable and only the centre changes. That stability is what makes it feel like one app rather than a navigation **[assumption]**. The lack of a spatial transition is something we can improve on (see Apple Photos).

### 1.3 Filmstrip behaviour

- Shows **the same source, filter and sort as the grid**. Selection is mirrored between grid and filmstrip. The source indicator in the filmstrip header shows the source name, count, selected count and current filename. Clicking it switches source (All Photographs, Quick Collection, Previous Import, recent sources) **[docs]** ([View photos](https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/view-photos.html)).
- **Resizable**: drag the top edge to change thumbnail size. **Double-clicking the edge toggles between the last two sizes** **[docs]** (same page).
- Navigation: `←`/`→` move the active photo. The scroll bar, the arrow buttons and dragging also work **[docs]**. The strip auto-scrolls so the active photo stays visible **[assumption]**.
- The filmstrip has its own mini filter (flags, stars, colour labels) and can be hidden with `F6` **[observed in tutorials]** ([Fstoppers](https://fstoppers.com/lightroom/keyboard-shortcuts-actually-speed-lightroom-classic-718346)).
- The filmstrip appears in *all* views, including Grid, where it duplicates the grid. Many users hide it in Grid view **[assumption]**. For our case the filmstrip should only appear in detail mode, because there the grid isn't visible.

### 1.4 Panel model

| Behaviour | How | Confidence |
|---|---|---|
| Toggle both side groups | `Tab` | [docs] |
| Toggle all chrome (sides, module picker, filmstrip) | `Shift+Tab` | [docs] |
| Toggle individual edges | `F5` top, `F6` filmstrip, `F7` left, `F8` right | [observed in tutorials] (F6) / [assumption] (F5, F7, F8) |
| Toggle by mouse | Click the small triangle on each outer edge | [docs] |
| Auto show/hide | Right-click the outer edge → *Auto Hide & Show* (reveal on edge hover), *Auto Hide*, *Manual*, *Sync With Opposite Panel* | [docs] |
| Solo mode | Right-click a panel header → Solo Mode, or Alt/Option-click a header. Opening one panel collapses the others | [docs] |
| Show/hide single panels | Right-click a panel header → tick panel names | [assumption] |
| Resize | Drag the inner edge of a side group to change its width | [assumption] |
| Persistence | Panel visibility and width remembered per module across restarts | [assumption] |

Sources: [Workspace basics](https://helpx.adobe.com/lightroom-classic/desktop/workspace/workspace-basics.html), [Photofocus — hiding & showing Lightroom panels](https://photofocus.com/software/hiding-showing-lightroom-panels/), [Lightroom Killer Tips](https://lightroomkillertips.com/?p=13700).

**Takeaway:** Lightroom's "Auto Hide & Show" (panels slide out when the cursor touches the screen edge) is beloved by some and a known annoyance for others (panels popping out by accident). Make it opt-in, not the default.

### 1.5 Grid cells and overlays

- **Cell styles** cycle with `J`: no extras → compact → expanded. Each style has its own configured extras (index number, filename, dimensions, rating, flag, rotation buttons, badges) in Library View Options (`Ctrl/Cmd+J`) **[docs]** ([Set Library view options](https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/setting-library-view-options.html); [jkost.com](https://jkost.com/blog/?p=15474)).
- `Ctrl/Cmd+Shift+H` toggles all cell extras **[docs]** (Adobe shortcut table via search).
- Options include *"Show clickable items on mouse over only"* (rotate arrows and flag appear on hover) and *tint grid cells with label colours* **[assumption]**. The hover-reveal is the key pattern: a calm grid at rest, controls on hover.
- **Badges** (small icons on a thumbnail corner) show "has keywords", "metadata edited", "in collection", "cropped". Clicking a badge jumps to the related panel **[assumption]**. For WP this maps to "missing alt text" (a warning badge) and "used in N posts".
- **Thumbnail size**: toolbar slider plus `+`/`-` keys in Grid **[assumption]**.
- **Loupe info overlay**: `I` cycles Info 1 → Info 2 → off. Each info set shows up to three configurable lines (e.g. filename, dimensions, capture date) in the top-left of the image. `Ctrl/Cmd+I` shows/hides **[docs]** ([Set Library view options](https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/setting-library-view-options.html)). The overlay fades after a moment so it doesn't cover the image **[assumption]**.

### 1.6 Selection model (the "active photo")

Lightroom distinguishes three states **[assumption, well known]**:

```
┌───────┐ ┌───────┐ ┌───────┐
│ ░░░░░ │ │ ▒▒▒▒▒ │ │ █████ │
│unsel. │ │selected│ │ACTIVE │  ← active = brightest cell, also selected
└───────┘ └───────┘ └───────┘
```

- **Active (most-selected) photo**: the one shown in Loupe and in the Metadata panel. Brightest highlight.
- **Selected photos**: lighter highlight. Commands like flagging, rating and keywording apply to them.
- `Ctrl/Cmd+click` toggles, `Shift+click` selects a range, `Ctrl/Cmd+A` selects all, `Ctrl/Cmd+D` deselects all **[docs]** ([Dummies](https://www.dummies.com/article/technology/software/adobe-products/lightroom/adobe-photoshop-lightroom-classic-for-dummies-cheat-sheet-261807/)).
- In Loupe with a multi-selection, `←`/`→` move through **only the selected photos** **[assumption]**. This is powerful but surprising. Decide explicitly whether our filmstrip navigates the selection or the whole collection.

### 1.7 Metadata viewing and editing

- **Metadata panel** (right side) with a preset dropdown that picks *which fields* are shown (Default, EXIF, IPTC, Minimal, …). Mixed values across a selection show as `< mixed >` **[assumption]**.
- **Target Photo vs Selected Photos**: with several photos selected, the panel can show the active photo or the whole selection. Edits follow that choice. **Auto Sync** (a switch next to the Sync button) makes every edit apply to all selected photos. Keywording always applies to all selected photos in Grid. In Loupe, with Auto Sync off, edits go to the current photo only, even if "Selected Photos" is highlighted **[docs]** + **[observed in tutorials]** ([Advanced metadata actions](https://helpx.adobe.com/lightroom-classic/help/advanced-metadata-actions.html); [community thread on targeting one or many images](https://community.adobe.com/t5/lightroom-classic-discussions/p-changes-to-metadata-panel-for-targeting-one-or-many-images/m-p/12478251)). Users repeatedly report this as confusing and misleading, which is a clear anti-pattern.
- **Sync Metadata**: copy chosen fields from the active photo to the other selected photos through a dialog with a checkbox per field. It overwrites existing values **[docs]** ([Advanced metadata actions](https://helpx.adobe.com/lightroom-classic/help/advanced-metadata-actions.html)).
- **Metadata presets**: saved sets of field values (copyright, creator, …) applied on import or later **[assumption]**.
- **Keywording**: type keywords with autocomplete. **Keyword sets** give 9 one-keystroke keywords (`Alt/Option+1…9`). The **Painter tool** "sprays" a keyword, label or rating onto thumbnails by clicking or dragging **[docs]** ([Use keywords](https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/keywords.html); [jkost — keywords](https://jkost.com/blog/2020/03/working-with-keywords-in-lightroom-classic.html)).

### 1.8 Culling keys (flags, ratings, labels)

| Action | Key | Confidence |
|---|---|---|
| Pick / Reject / Unflag | `P` / `X` / `U` | [observed in tutorials] |
| Stars | `0`–`5` | [assumption] |
| Colour labels red/yellow/green/blue | `6` / `7` / `8` / `9` | [observed in tutorials] |
| Auto-advance after a flag or rating | `Caps Lock` on, or `Shift+key` | [observed in tutorials] (Caps Lock) / [assumption] (Shift) |
| Add to Quick Collection | `B` | [assumption] |

Source: [Fstoppers](https://fstoppers.com/lightroom/keyboard-shortcuts-actually-speed-lightroom-classic-718346).

**Auto-advance** is the key micro-pattern for fast batch work. Apply an attribute and move to the next item. This maps directly to an "alt-text pass": type alt text, press `Enter`, land on the next image with the alt field focused.

### 1.9 Secondary display

A second window can show Grid, Loupe ("normal", "live" = follows the hover, "locked"), Compare, Survey or Slideshow while the main window shows something else. Zoom and pan work there too **[docs]** (partial: [View photos](https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/view-photos.html)) / **[assumption]** for the modes. For a web app the equivalent would be "open detail in a new window that follows the selection". That's niche, so treat it as a later idea.

### 1.10 Visual style and feedback

- Dark neutral greys (no colour cast) for all chrome. Panels are slightly lighter than the work-area background. The panel-header type is small, all-caps or small-caps and low contrast. Values are brighter than labels **[assumption]**.
- Selection is shown with **lighter grey fills**, not a saturated accent. Colour is reserved for colour labels and flags **[assumption]**.
- Lights-out background colour (black, greys, white) is configurable **[observed in tutorials]** ([havecamerawilltravel](https://havecamerawilltravel.com/lightroom/lightroom-classic-change-color-behind-image/)).
- Feedback is a brief centred text toast over the image after a command ("Set Rating to 3", "Flag as Pick"), which fades **[assumption]**. This is very effective for keyboard actions that otherwise give no visible feedback.

---

## 2. Adobe Lightroom (cloud-based "Lightroom" desktop/web)

A deliberately simplified rethink of Classic. It is the closest match to a "modern, sleek" target.

### 2.1 Layout anatomy

```
┌──────────────────────────────────────────────────────────────────────┐
│ ☰  All Photos ▾                         search…    sort ▾   ⇪ share    │
├───────────┬──────────────────────────────────────────────────┬──┬────┤
│ My Photos │                                                  │  │Edit│ ← one
│  All      │     PHOTO GRID (justified rows, true aspect)     │  │ ── │   panel
│  Recent   │     or SQUARE GRID                               │  │Info│   slot,
│  People   │     or DETAIL (single photo)                     │  │ ── │   icon
│ Albums    │                                                  │  │Keyw│   rail
│  ▸ Trip   │                                                  │  │    │
│  ▸ Work   │  ┌────────────────────────────────────────────┐  │  │    │
│           │  │ filmstrip (detail view only, toggle "/")   │  │  │    │
├───────────┴──┴────────────────────────────────────────────┴──┴──┴────┤
│ [▦ photo grid][▣ square][▢ detail]  ⚑ ★★★★★   ─────●── size   ⋯    │ ← bottom bar
└──────────────────────────────────────────────────────────────────────┘
```

- **Three view modes** in one segmented control: Photo grid (justified, aspect-preserving), Square grid, and Detail. Shortcuts: `G` grid, `D` detail, `E` edit, `I` info, `/` filmstrip, `O` cycle overlay **[docs]** ([Lightroom keyboard shortcuts](https://helpx.adobe.com/lightroom-cc/using/keyboard-shortcuts.html), via search extract).
- The web version uses the same scheme (`G`, `I`, `E`) and has a **`Shift+?` shortcut cheat-sheet overlay** **[docs]** ([Lightroom web shortcuts](https://helpx.adobe.com/lightroom/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html)).
- Web: *Adaptive grid* (dynamic layout that adapts to the screen) vs *Square grid* **[docs]** ([Lightroom web — tour the workspace](https://helpx.adobe.com/lightroom/web/get-set-up/learn-the-basics/tour-the-workspace.html)).
- **One right-hand panel at a time**, chosen from an icon rail (Edit, Crop, …, Info, Keywords, Activity). Clicking the active icon again closes the panel **[assumption]**. This is much easier to understand than Classic's stack of collapsible panels, and it's the best fit for "toggleable right-side info/edit panels".
- The Info panel holds title, caption, copyright, location and capture details. With several photos selected in the grid and the Info panel open, typed values apply to all selected photos **[observed in tutorials]** ([community thread](https://community.adobe.com/t5/lightroom-ecosystem-cloud-based-ideas/p-iptc-information-in-info-panel/idc-p/13985648)). Only a limited set of IPTC fields is editable, which users note as a limitation and we see as a strength for WP.
- Detail view in the web app shows one photo with Info available for camera, dimensions and file size **[docs]** (tour page above).

### 2.2 What it teaches

- **Justified "photo grid" vs uniform "square grid"** is a user preference worth offering. Justified suits browsing photos. Square suits mixed media (PDFs, video posters, SVG) because every cell is the same size and scannable.
- A **single "panel slot" + icon rail** removes the need for solo mode, panel stacks and per-panel hiding.
- **Overlay cycling (`O`)**: thumbnails can show none, basic, or detailed info.

---

## 3. Capture One

### 3.1 Layout anatomy

```
Default (browser right)                    "Browser below" (filmstrip-like)
┌──────────┬──────────────────┬────────┐   ┌──────────┬───────────────────────┐
│ Tool     │                  │Browser │   │ Tool     │                       │
│ tabs     │     VIEWER       │ grid   │   │ tabs     │        VIEWER         │
│ [Lib]    │  (single or      │ ▭ ▭    │   │ [Lib]    │                       │
│ [Exp]    │   multi-variant) │ ▭ ▭    │   │ [Exp]    │                       │
│ [Meta]   │                  │ ▭ ▭    │   │ [Meta]   ├───────────────────────┤
│ [+ tab]  │                  │ ▭ ▭    │   │          │ ▭ ▭ [▣] ▭ ▭ ▭ ▭ ▭ ▭ ▭ │
└──────────┴──────────────────┴────────┘   └──────────┴───────────────────────┘
```

- **Viewer and Browser are shown together by default.** You can hide the viewer (pure browser = grid mode) or hide the browser (pure viewer) **[observed in tutorials]** ([Capture One — Workspace layouts](https://support.captureone.com/hc/en-us/articles/360002470117-Workspace-layouts), via search). Shortcuts: `Cmd/Ctrl+B` browser, `Cmd/Ctrl+T` tools **[observed in tutorials]**.
- **Browser placement**: View → Customize Browser → *Place Below* / *Place Right* **[docs]** ([The Browser modes](https://support.captureone.com/hc/en-us/articles/360002469797-The-Browser-modes)).
- **Browser modes**: Grid, List, Filmstrip. In Filmstrip mode **thumbnail size follows the strip height automatically** and the zoom slider is hidden. In Grid/List a zoom slider in the browser toolbar sets thumbnail size **[docs]** (same page; [Thumbnails](https://support.captureone.com/hc/en-us/articles/360002474238-Thumbnails)).
- **Tool tabs**: a vertical strip of tabs, each holding a stack of tools. Users add or remove tabs (right-click the tab bar), drag tools between tabs, or float tools. Workspaces can be saved and switched **[observed in tutorials]** ([creativeLIVE — customizing workspace](https://site.creativelive.com/class/get-the-most-out-of-your-photos-with-capture-one-pro-12-david-grover/lessons/customizing-your-workspace-and-keyboard-shortcuts)).
- **Keyboard shortcuts are fully remappable** (Edit → Edit Keyboard Shortcuts; duplicate the default set first) **[observed in tutorials]**.

### 3.2 Selection model: primary vs selected variants

- One **primary variant** (thick border, shown in the viewer) plus additional **selected variants**. *Select Primary Variant Only* (`Shift+click` the primary) collapses the selection **[docs]** ([Selecting only the primary variant](https://support.captureone.com/hc/en-us/articles/360002485998)).
- **Edit All Selected Variants** toggle: orange when on. When off, edits go to the primary only **[docs]** ([Primary and selected variants](https://support.captureone.com/hc/en-us/articles/360002481917-Primary-and-selected-variants), [Editing primary / all selected variants](https://support.captureone.com/hc/en-us/articles/360003099397-Editing-primary-all-selected-variants)). Community reports say which actions follow the toggle is inconsistent: sliders affect the primary, presets and actions affect all **[observed in tutorials]**.
- **Multi-view**: with several variants selected and the viewer set to show all, the viewer becomes a Survey-like layout. The primary is highlighted **[assumption]**.

### 3.3 What it teaches

- **"Browser below" = filmstrip** is just the grid component in a one-row layout, with thumbnail size derived from the container height. For a web implementation, the filmstrip can be the same virtualised thumbnail component as the grid with `rows=1`.
- Again, **a visible on/off state for "applies to all selected"** is necessary but not sufficient. The rules for which actions follow it must be uniform.

---

## 4. Apple Photos (macOS)

The reference for *feel*: transitions, restraint, content-first chrome.

### 4.1 Layout anatomy

```
┌───────────┬───────────────────────────────────────────────────────────┐
│ Sidebar   │  ◀ ▶  Years | Months | All Photos     ─●─ zoom   ⓘ ♡ ↻ ⌕   │ ← toolbar
│ Library   ├───────────────────────────────────────────────────────────┤
│ Favorites │                                                           │
│ Albums    │      square, edge-to-edge grid (tight gutters)            │
│  ▸ Trip   │                                                           │
│ Projects  │      ── Space / double-click ──▶ photo ZOOMS out of its    │
│           │         cell to fill the content area                     │
│           │                                                           │
│           │      [▭ ▭ ▭ ▣ ▭ ▭ ▭]  ← thumbnails under open photo (⌥S)   │
└───────────┴───────────────────────────────────────────────────────────┘
                                     ┌──────── Info (⌘I) ─────┐
                                     │ Title                  │  floating
                                     │ Caption                │  inspector,
                                     │ ♡  date · size · camera│  follows the
                                     │ Keywords [+]           │  selection
                                     │ Location (map)         │
                                     └────────────────────────┘
```

### 4.2 Mode switching and transitions

- **Open:** double-click or `Space`. **Close:** `Space` or `Esc`. **Up a level:** `Cmd+↑`. **Prev/next:** `←`/`→` **[docs]** ([Photos keyboard shortcuts](https://support.apple.com/guide/photos/pht9b4411b24/mac)).
- **Thumbnails under an open photo** (the filmstrip) are toggled with `Option+S` **[docs]**.
- Opening a photo **zooms it out of its grid cell** to fill the view. Closing it shrinks it back into the (possibly different, after arrow-key navigation) cell, so the grid is scrolled to keep that cell in view **[assumption, consistent with Apple's documented zoom-transition pattern]**. Apple's UIKit/SwiftUI zoom transition does exactly this: a source view the animation "zooms out from and zooms back in to" **[docs]** ([UIKit zoom transition](https://developer.apple.com/documentation/uikit/uiviewcontroller/transition/zoom(options:sourceviewprovider:)), [WWDC24 — Enhance your UI animations and transitions](https://developer.apple.com/videos/play/wwdc2024/10145/)).
- **Web mapping:** the View Transitions API (`view-transition-name` on the thumbnail and the detail image) or a FLIP animation reproduces this. Combined with the grid scrolling to the last-viewed item on return, this is the single biggest contributor to "seamless" **[assumption]**.
- **Zoom in the detail view:** `Z` toggles current zoom ↔ 100%. `Cmd +`/`Cmd -` and pinch zoom. Drag to pan **[docs]**.
- **Grid density:** `Cmd +`/`Cmd -` or the toolbar zoom slider resizes thumbnails **[docs]**. On trackpads, pinch in the grid changes density **[assumption]**.

### 4.3 Info window and editing

- **Info (`Cmd+I`)** is a *floating* inspector showing title, caption, favourite, date, camera and exposure details, keywords and location. It **follows the selection**: select another photo and the window updates **[docs]** ([Add titles, captions and more](https://support.apple.com/guide/photos/phta4e5a733f/mac)).
- **Batch edit:** select several photos, open Info, type a title/caption/keywords/location, and it applies to all selected **[docs]** + **[observed in tutorials]** ([Apple Community](https://discussions.apple.com/thread/255675482)). There is no "different value per photo" batch mode.
- **Inline titles under thumbnails** (View → Metadata → Titles). Hover a cell, click the title field, and type **[docs]** (same Apple page). This is a lightweight inline-edit pattern for the grid.
- **Favourite** is a single key (`.`). **Hide** `Cmd+L`. **Delete** `Delete` (removes from album only when inside an album) **[docs]** ([shortcuts](https://support.apple.com/guide/photos/pht9b4411b24/mac)).
- **Edit mode** (`Return`) swaps the toolbar to Adjust (`A`) / Filters / Crop (`C`) tabs, with "Done" to return. Holding `M` shows the original **[docs]**. The "hold a key to peek" pattern is reusable (e.g. hold to see the full-size file or the original upload).

### 4.4 What it teaches

- **Restraint:** very little chrome, a tight grid gutter, no visible cell borders. Selection is shown with an accent-coloured outline and checkmark **[assumption]**.
- **Spatial continuity** (zoom from cell, return to cell) is what makes grid ↔ detail feel like one place.
- **Context-sensitive Delete** (remove from album vs delete from library) maps directly to FileBird: *remove from folder* vs *delete from Media Library*.

---

## 5. Brief notes: Adobe Bridge, Photo Mechanic, darktable

### 5.1 Adobe Bridge

- **Workspaces as presets** of panel arrangements: *Essentials* (all panels), *Filmstrip* (horizontal thumbnail row + large Preview panel), *Light Table* (content grid only), *Metadata*, *Keywords*. Switch via the header dropdown or `Ctrl+Alt/Shift+1…9` **[docs]** ([Customize the workspace](https://helpx.adobe.com/bridge/desktop/workspaces-and-panels/customize-the-workspace.html); [Bridge workspace](https://helpx.adobe.com/bridge/using/adobe-bridge-workspace.html)).
- The "Filmstrip" workspace is essentially our detail mode: preview on top, strip below, folders left, metadata right.
- **Review mode** (header button) is a full-screen carousel for fast culling. **Spacebar** opens a full-screen preview of the selected file **[assumption]**.
- **Lesson:** named layout presets ("Browse", "Detail", "Edit metadata") are a cheap way to give users configurable layouts without exposing panel mechanics.

### 5.2 Photo Mechanic (Camera Bits)

- Known for **speed**. It uses the embedded previews already present in the files instead of rendering its own **[observed in tutorials]** ([ExpertPhotography review](https://expertphotography.com/photo-mechanic-workflow/)). The web equivalent: always show the closest WP-generated thumbnail size first, then swap in larger sizes progressively.
- **Contact sheet cell**: filename under the thumbnail, up to three extra label lines, plus colour class, tag checkbox and stars, all **editable directly on the cell**. Hovering an unselected cell reveals four corner buttons (rotate ×2, **i** = metadata, magnifier = preview) **[docs]** ([Contact Sheets overview](https://docs.camerabits.com/support/solutions/articles/48000207551)). Selected cells have a configurable highlight colour (yellow by default). The thumbnail-size slider sits above the sheet.
- **Double-click filename to rename inline** **[docs]**.
- **Metadata Info window (`i`)**: edits *one* image, with **"Save & ←/→" to save and move to the adjacent image**. Plain arrows move without saving. A modifier turns OK into *Apply to selected* **[docs]** ([Using the Metadata Info tool](https://docs.camerabits.com/support/solutions/articles/48000341504)).
- **Metadata Template** (batch): fields have checkboxes, so only ticked fields are applied to the selection **[docs]** (same page: "Unlike the Metadata (IPTC) Template, you do not have to check a box to apply information"). It supports **variables** (`{filenamebase}`, date, …) **[docs]** ([Glossary](https://docs.camerabits.com/support/solutions/articles/48001206190-glossary-of-terms)).
- **Lesson for WP:** "Save & next" for unique-per-image fields (alt text) and "apply ticked fields to selection" for shared fields (caption credit, description) are two distinct batch flows. Variables (e.g. alt text seeded from the filename or title) are a power feature.

### 5.3 darktable lighttable

- **Four lighttable modes**: filemanager, zoomable lighttable, culling, full preview **[docs]** ([Lighttable modes](https://docs.darktable.org/usermanual/5.6/en/lighttable/lighttable-modes/)).
- **Filemanager**: thumbnails-per-row set in the bottom panel or with `Ctrl+scroll` over the grid. `Home`/`End`, `PgUp`/`PgDn`. `Space` over a hovered thumbnail toggles it in the selection. **Hovered thumbnail is implicitly the target of keyboard shortcuts** (e.g. pressing a star digit). If it belongs to the selection, the action applies to the whole selection. Dragging thumbnails sets a custom sort order **[docs]** ([Filemanager](https://docs.darktable.org/usermanual/5.6/en/lighttable/lighttable-modes/filemanager/)).
- **Full preview**: **press and hold `W`** for a full-size preview of the hovered image. Release to return. `F` makes it sticky (`F`/`Esc` to leave) **[docs]** ([Full preview](https://docs.darktable.org/usermanual/5.6/en/lighttable/lighttable-modes/full-preview/)). The hold-to-peek pattern is great for quick checks without "entering" detail mode.
- **Culling**: fixed mode (`X`, N images side by side, stepping through) vs dynamic (`Ctrl+X`, all selected). Zoom/pan is **synchronised across all shown images** (add `Shift` to affect one) **[docs]** ([Culling](https://docs.darktable.org/usermanual/5.6/en/lighttable/lighttable-modes/culling/)).
- **`H` shows all shortcuts applicable to the current view** **[docs]** ([Keyboard shortcuts](https://docs.darktable.org/usermanual/4.6/en/overview/user-interface/keyboard-shortcuts/)).
- **Lesson:** "hover = target" is fast for experts but risky for a web app where the pointer may rest anywhere. Use explicit focus/selection instead. Do adopt the context-sensitive shortcut overlay.

---

## 6. Cross-app comparison

| Aspect | Lightroom Classic | Lightroom (cloud) | Capture One | Apple Photos | Photo Mechanic | darktable |
|---|---|---|---|---|---|---|
| Grid ↔ single | `G` / `E` | `G` / `D` | Hide viewer / hide browser | `Space` / `Esc` | Double-click → Preview window | `W` hold / `F` sticky |
| Transition | Instant swap | Instant swap [assumption] | Instant | **Zoom from cell** | New window | Instant |
| Filmstrip | Always (all views), resizable, double-click edge toggles sizes | Detail only, `/` toggles | Browser in filmstrip mode, auto size | Under open photo, `⌥S` | — | Separate panel |
| Right panel model | Stack of collapsible panels, solo mode | **One panel slot + icon rail** | Tool tabs, customisable | Floating Info window | Separate Info window | Stack of modules |
| Batch metadata | Target/Selected + Auto Sync (confusing) | Type with N selected → all | Edit-all-selected toggle | Type with N selected → all | Save & next; template with field ticks | Selection-based |
| Grid density | Slider, `+`/`-` | Slider | Slider (not in filmstrip) | Slider, `⌘+`/`⌘-` | Slider | Per-row count, `Ctrl+scroll` |
| Cell info | `J` cycles 3 styles | `O` cycles overlays | Configurable labels | Optional titles | Labels + editable controls | Overlay modes, `I` |
| Shortcut help | Help → Library Shortcuts | `Shift+?` (web) | Remappable | Menus | Menus | `H` |

---

## 7. Visual style: why neutral, dark and quiet

- **Surround changes perception.** A coloured or very bright/dark surround shifts how colour, saturation and brightness are perceived. darktable's colour-assessment mode exists because "the image can end up being too dark, and overly-processed in terms of contrast and color saturation" when viewed against a dark background **[docs]** ([darktable — color assessment](https://www.darktable.org/usermanual/en/module-reference/utility-modules/darkroom/color-assessment/)). Tutorials recommend neutral grey themes for colour judgement **[observed in tutorials]** ([Envato Tuts+ — neutral gray themes](https://photography.tutsplus.com/tutorials/want-better-color-use-neutral-gray-themes-in-adobe-photoshop-and-lightroom--cms-23342)).
- **For a media library** (not colour grading) exact neutrality matters less, but the principle holds: **chrome should be achromatic** so the images are the only colour on screen. That is what makes a grid look "premium".
- **Recommended token direction for the design phase [assumption]:**
  - Background levels: `bg-0` (detail stage, near-black e.g. `#111`), `bg-1` (grid canvas, `#1a1a1a`), `bg-2` (panels, `#222`), `bg-3` (raised/hover, `#2c2c2c`). Keep chroma ≈ 0, or a barely perceptible cool tint at most.
  - Text: labels at ~55–60% luminance, values at ~85–90%. Small (11–12 px) uppercase or small-caps section headers with letter-spacing, as Lightroom does.
  - **One accent** for selection/focus/primary action only. Colour labels and status (missing alt text = amber, error = red) are the only other colours.
  - Selection on dark grids: an accent outline (2 px, inset) plus a check badge, not a filled tint that would colour-shift the thumbnail.
  - Optional "stage" colour setting (black / dark grey / mid grey) for the detail view, like Lightroom's Lights-Out colour.
- The current app uses a "cyberpunk" theme (see `README.md` screenshot). Saturated neon chrome conflicts with "images are the only colour". See Open questions.

---

## 8. Patterns to adopt (ranked)

| # | Pattern | Seen in | Why | WordPress media-manager mapping |
|---|---|---|---|---|
| 1 | **One collection state shared by grid, detail and filmstrip** (source/folder + filter + sort + selection + focused item) | All | The foundation of "seamless". Switching views never loses place, order or selection | A single client store. The filmstrip is the grid's ordered list windowed around the focused item. The URL encodes folder, filter, sort and `?item=ID` so reload and back/forward work |
| 2 | **Spatial zoom transition grid → detail → grid**, returning to and scrolling to the last-viewed cell | Apple Photos | Turns a view change into a continuous motion and keeps the user oriented | View Transitions API or FLIP. Respect `prefers-reduced-motion` (cross-fade instead) |
| 3 | **Single-key mode switching**: `G`/`Esc` grid, `Enter`/`Space`/`E` detail, `←`/`→` prev/next | LrC, LR, Photos | Universal, learnable in seconds | Same keys. Double-click also opens. `Esc` closes the innermost layer first (field → panel → detail) |
| 4 | **Stable chrome around a changing centre**: left folder column and right panel stay in place across grid/detail | LrC, Bridge | Only one thing changes at a time, which feels calm | FileBird tree persists in both modes. Right panel content updates to the focused/selected item(s) |
| 5 | **Right panel = one slot + icon rail** (Info · Edit · Usage/Actions), click the active icon or press its key to collapse | LR (cloud) | Simpler than stacked collapsible panels, and each panel gets full height | `I` info/metadata (title, alt, caption, description), `E` edit image (crop/rotate via WP image editor, if in scope), `K`/other for "used in" / attachment details. Width drag-resizable and persisted |
| 6 | **Batch editing that is explicit and uniform**: with N selected, the panel header says "Editing 12 items". Mixed fields show a "Mixed" placeholder and are left untouched unless edited. Every action follows the same rule | Photos, LR (cloud), PM template; *anti-model*: LrC Target/Auto Sync | Avoids LrC's well-documented confusion | Alt/caption/description/title fields. A "Mixed (12)" placeholder. Edit → applies to all, with an undo toast. Optional per-field "append vs replace" for description |
| 7 | **"Save & next" for per-item fields** + auto-advance | PM Info window, LrC Caps Lock auto-advance | Alt text is unique per image. The fastest flow is type → `Enter` → next image with the field still focused | In detail mode with the alt field focused, `Enter` saves and goes to the next item (`Shift+Enter` = previous), with the focus kept in the field. A filter "Missing alt text" + this flow = an accessibility pass |
| 8 | **Filmstrip only in detail mode**, scroll-synced (focused item kept centred/visible), resizable height with a double-click-to-toggle size, `/` or `F6` to hide | LR (cloud), LrC, Capture One | Gives neighbour context without duplicating the grid. Auto-sized thumbnails from the strip height (C1) keep it simple | Same virtualised thumbnail component as the grid with `rows=1`. Click = focus, `Ctrl/Shift+click` = adjust selection |
| 9 | **Quiet cells at rest, controls on hover**; cycle cell info density with one key | LrC (`J`, "show clickable items on mouse over"), LR `O`, PM hover buttons | Keeps the grid beautiful while keeping actions one click away | Hover: quick actions (open, select checkbox, copy URL, more ⋯). `J`/`O` cycles none → filename → filename + dimensions/size + alt-status |
| 10 | **Status badges on thumbnails** | LrC badges | Surfaces problems at a glance | "Missing alt text" (amber dot), "unattached", "large file", type icon for non-images. Clicking a badge opens the right panel at the relevant field |
| 11 | **Density control**: slider + `+`/`-` (and `Ctrl+scroll`/pinch) + justified vs square grid toggle | All; LR photo/square grid | Users have different screens and tasks | Persist per user. Square grid suits mixed media, justified suits photo browsing |
| 12 | **Panel toggles**: `Tab` both sides, `Shift+Tab` all chrome (and the filmstrip), per-side keys, edge-click to collapse, drag-resize, persisted | LrC | Lets users choose between "focus" and "work" without settings dialogs | `[` left, `]` right (web-safe instead of F7/F8), `Tab` both, `Shift+Tab` everything. Persist in `localStorage` per mode (grid vs detail) |
| 13 | **Non-blocking feedback**: transient toast over the image for keyboard actions ("Moved to *Trip*", "Alt text saved") with Undo | LrC | Confirms invisible keyboard actions without modal interruptions | Short toast near the bottom of the stage. Optimistic update + undo for destructive actions |
| 14 | **Shortcut overlay**: `?` shows the shortcuts for the *current* mode | LR web (`Shift+?`), darktable (`H`) | Discoverability without clutter | Modal sheet listing grid/detail/panel shortcuts |
| 15 | **Hold-to-peek** full-size preview from the grid | darktable (`W`), Photos (hold `M`) | Quick check without changing mode | Hold `Space` (or `W`) over the focused cell for a full-screen peek. Release to return |
| 16 | **Context-sensitive delete**: inside a folder, `Delete` = remove from folder; `Shift+Delete` = delete from library (with confirm) | Photos (album vs library) | Prevents destroying a file when you meant to un-file it | FileBird "remove from folder" vs WP "delete permanently" |
| 17 | **Info overlay in detail** (`I`-style cycling of filename / dimensions / alt text drawn on the stage) | LrC Loupe info | Lets users see key info with panels hidden | Fading overlay, top-left of stage |
| 18 | **Named layout presets** ("Browse", "Review", "Edit metadata") | Bridge workspaces, Capture One workspaces | Configurability without exposing panel mechanics | Later iteration. Could be just 2–3 built-in presets |

---

## 9. Patterns to avoid (or defer)

| Pattern | Seen in | Why not for a WP media manager |
|---|---|---|
| Develop/editing modules, Quick Develop, sliders for exposure, presets/styles | LrC, C1, darktable | WordPress stores derivatives, not edit stacks. At most offer WP's own crop/rotate/scale, or "open in WP editor". |
| Module picker / multiple top-level "rooms" | LrC (Library/Develop/Map/…) | One room only: the library. Upload can be an overlay or drawer within it. |
| Target Photo vs Selected Photos + Auto Sync toggles | LrC | Documented user confusion. Use one uniform rule ("edits apply to everything selected, shown clearly"). |
| Primary-variant-only edits with a hidden toggle | C1 | Same problem. A modifier-dependent target is invisible. |
| Hover-as-target for keyboard shortcuts | darktable | Unpredictable in a browser (the pointer rests anywhere, touch devices). Use focus/selection. |
| Auto-show panels on edge hover as default | LrC | Accidental pop-outs. Offer as opt-in at most. |
| Floating tool palettes, drag-tools-between-tabs, fully custom workspaces | C1 | High complexity, low value for 4–5 metadata fields. |
| Full IPTC/EXIF field zoo, metadata-preset dropdown of field sets | LrC, PM | WP has title, alt, caption, description (+ folder). Show EXIF read-only in a collapsible "File details" section. |
| Five view modes (Grid/Loupe/Compare/Survey/Lights-out) up front | LrC | Start with Grid + Detail. Compare (two items side by side) and Survey (multi-selection overview) are candidates for later. |
| F-key shortcuts (F5–F8, F11) | LrC | Browsers, OSes and laptops intercept F-keys. Use `[`, `]`, `Tab`, `/`. |
| Filmstrip visible in grid mode | LrC | Redundant with the grid. Only show it in detail. |
| Catalog, import and "previous import" source concepts | LrC | WP is the source of truth. "Recently uploaded" can be a sort/filter instead. |
| Opening detail in a modal or new page | WP Media Library (attachment-details modal) | Explicitly against the owner's vision. Also breaks back/forward unless the URL is synced. |

---

## 10. Proposed keyboard map (draft)

Principles: single letters for frequent actions, no F-keys, `Esc` always backs out one layer, and no shortcuts fire while a text field has focus (except `Esc`, `Enter`/`Shift+Enter` in the save-and-next flow, and `Mod+S`). `Mod` = `Cmd` on macOS, `Ctrl` elsewhere.

### Global / navigation

| Key | Grid | Detail |
|---|---|---|
| `←` `→` `↑` `↓` | Move focus in the grid (`Shift+arrows` extend the selection) | `←`/`→` previous/next item in the current sort order |
| `Home` / `End` | First/last item | First/last item |
| `PgUp` / `PgDn` | Scroll a page | — |
| `Enter` / `Space` / `E` | Open the focused item in detail | (`Space` = zoom fit ↔ 100%, see below) |
| `G` / `Esc` | — | Back to grid (focus lands on the item last viewed) |
| `Z` | — | Toggle fit ↔ 100% (also click the image) |
| Hold `W` | Peek full-size at the focused item | — |
| `?` | Shortcut overlay for the current mode | same |
| `Mod+F` or `/`* | Focus search/filter | same |

\* If `/` is used for search, the filmstrip toggle needs another key (e.g. `F`). Decide in design.

### Panels and chrome

| Key | Action |
|---|---|
| `[` | Toggle left (folders) column |
| `]` | Toggle right panel (last used tab) |
| `Tab` | Toggle both side panels (only when focus isn't in a form control) |
| `Shift+Tab` | Toggle all chrome (sides + toolbar + filmstrip) = "focus mode" |
| `I` | Right panel → Info/metadata tab (press again to close) |
| `F` (or `/`) | Toggle filmstrip (detail mode) |
| `O` / `J` | Cycle thumbnail overlay: none → name → name + details |
| `L` | Cycle stage dimming (detail): normal → dim → black (optional) |
| `+` / `-` (or `=`/`-`) | Grid thumbnail size up/down |

### Selection

| Key | Action |
|---|---|
| `Mod+A` | Select all (in the current filtered view) |
| `Mod+Shift+A` / `Esc` | Deselect all (`Esc` in the grid, when nothing else is open) |
| `X` or `Space`† | Toggle the focused item in the selection |
| `Shift+click` / `Mod+click` | Range / toggle |

† `Space` can either open detail (Photos) or toggle selection (darktable, Finder-like checkboxes). Pick one. See Open questions.

### Editing and actions

| Key | Action |
|---|---|
| `Enter` (in alt/caption field) | Save and go to the next item, keeping the same field focused |
| `Shift+Enter` (in field) | Save and go to the previous item |
| `Mod+Enter` | Save the field and stay |
| `Esc` (in field) | Revert the unsaved edit and blur |
| `A` | Jump to the alt text field (opens Info if closed) |
| `C` | Copy the file URL of the focused item |
| `M` | Move selection to folder… (FileBird picker / command palette) |
| `Delete` / `Backspace` | Inside a folder: remove from folder. Elsewhere: delete (confirm) |
| `Shift+Delete` | Delete permanently (confirm) |
| `Mod+Z` / `Mod+Shift+Z` | Undo / redo the last metadata/move action |
| `Mod+K` | Command palette (all actions, folders, search) |
| `U` | Upload (open the drop zone / file picker) |

Optional, if ratings/labels are ever added (WP has no native field for them): `0–5` rating, `6–9` labels, `Caps Lock` auto-advance. Probably out of scope.

---

## 11. Open questions for the design phase

1. **Filmstrip navigation scope.** When several items are selected and the user enters detail, do `←`/`→` move through the *whole filtered collection* (simple, like Photos) or *only the selection* (like LrC Loupe)? Recommendation: the whole collection, with selected items marked in the strip.
2. **Batch-edit semantics.** With N items selected, does editing a field replace it on all of them (Photos/LR cloud), or do we offer per-field "append/replace" and a Sync-style "copy these fields from the focused item" action? How do we show "Mixed" values, and is there undo for a batch?
3. **What does `Space` do?** Open detail (Photos, Bridge) or toggle selection (darktable, checkbox grids)? It can't be both.
4. **Detail-mode selection.** Is detail always "one focused item" (simple), or can a multi-selection be edited from detail via the filmstrip (`Mod+click` in the strip)?
5. **Right-panel tabs.** Which tabs: Info (title/alt/caption/description), File details (EXIF, sizes, URL, dimensions), Usage ("used in posts"), Edit image (WP crop/rotate)? Does the panel show in grid mode for the selection too (LR cloud), or only in detail?
6. **Grid layout default.** Justified (true aspect ratio, prettier for photos) vs square (uniform, better for mixed media and predictable keyboard navigation)? Offer both, but which is the default?
7. **Transition budget.** Zoom transition duration and easing (e.g. 200–280 ms), reduced-motion fallback, and behaviour when the source cell is scrolled off-screen (fall back to cross-fade?).
8. **Stage background.** Fixed near-black, or user-selectable (black / dark grey / mid grey) like Lightroom's Lights Out colour? Is a light theme needed at all?
9. **Theme direction.** The current app has a cyberpunk theme. Does the media manager keep a branded accent within a neutral grey system, or move to fully neutral chrome?
10. **Panel persistence scope.** Remember panel visibility and width per mode (grid vs detail), per device (`localStorage`) or per user (server)?
11. **Hover-reveal vs touch.** How do hover-only cell actions translate to tablets (long-press, always-visible checkbox)?
12. **Compare / Survey.** Is a two-up compare (e.g. to pick between near-duplicates, which the uploader already detects) worth a later iteration?
13. **Keyboard conflicts.** Browser and screen-reader shortcuts (`Tab` for focus traversal is an accessibility essential). Should `Tab`-to-toggle-panels exist at all, or use only `[`/`]`/`\`? Accessibility likely wins: keep `Tab` for focus order.
14. **Upload integration.** Upload as a drawer/overlay over the grid (drop anywhere), with new items appearing in place and in the filmstrip, rather than a separate page.

---

## Sources

**Adobe Lightroom Classic**
- Keyboard shortcuts — https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/keyboard-shortcuts.html
- Workspace basics — https://helpx.adobe.com/lightroom-classic/desktop/workspace/workspace-basics.html
- Set Library view options — https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/setting-library-view-options.html
- View photos — https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/view-photos.html
- Advanced metadata actions — https://helpx.adobe.com/lightroom-classic/help/advanced-metadata-actions.html
- Use keywords — https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/keywords.html
- Community: metadata panel targeting one or many images — https://community.adobe.com/t5/lightroom-classic-discussions/p-changes-to-metadata-panel-for-targeting-one-or-many-images/m-p/12478251
- Community: lights out — https://community.adobe.com/t5/lightroom-classic-discussions/photo-gets-black-using-dim-lights-out-mode/td-p/13015417
- Fstoppers — Keyboard shortcuts that actually speed up Lightroom Classic — https://fstoppers.com/lightroom/keyboard-shortcuts-actually-speed-lightroom-classic-718346
- Dummies — Lightroom Classic cheat sheet — https://www.dummies.com/article/technology/software/adobe-products/lightroom/adobe-photoshop-lightroom-classic-for-dummies-cheat-sheet-261807/
- jkost.com — grid cell styles tip — https://jkost.com/blog/?p=15474
- jkost.com — Working with keywords — https://jkost.com/blog/2020/03/working-with-keywords-in-lightroom-classic.html
- Photofocus — hiding and showing Lightroom panels — https://photofocus.com/software/hiding-showing-lightroom-panels/
- Lightroom Killer Tips — interface — https://lightroomkillertips.com/?p=13700
- Have Camera Will Travel — change colour behind image — https://havecamerawilltravel.com/lightroom/lightroom-classic-change-color-behind-image/

**Adobe Lightroom (cloud)**
- Lightroom keyboard shortcuts — https://helpx.adobe.com/lightroom-cc/using/keyboard-shortcuts.html
- Lightroom web keyboard shortcuts — https://helpx.adobe.com/lightroom/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html
- Lightroom web — tour the workspace — https://helpx.adobe.com/lightroom/web/get-set-up/learn-the-basics/tour-the-workspace.html
- Community: IPTC in Info panel — https://community.adobe.com/t5/lightroom-ecosystem-cloud-based-ideas/p-iptc-information-in-info-panel/idc-p/13985648

**Capture One**
- Workspace layouts — https://support.captureone.com/hc/en-us/articles/360002470117-Workspace-layouts
- The Browser modes — https://support.captureone.com/hc/en-us/articles/360002469797-The-Browser-modes
- Thumbnails — https://support.captureone.com/hc/en-us/articles/360002474238-Thumbnails
- Primary and selected variants — https://support.captureone.com/hc/en-us/articles/360002481917-Primary-and-selected-variants
- Selecting only the primary variant — https://support.captureone.com/hc/en-us/articles/360002485998
- Editing primary / all selected variants — https://support.captureone.com/hc/en-us/articles/360003099397-Editing-primary-all-selected-variants
- creativeLIVE — customizing workspace and shortcuts — https://site.creativelive.com/class/get-the-most-out-of-your-photos-with-capture-one-pro-12-david-grover/lessons/customizing-your-workspace-and-keyboard-shortcuts

**Apple Photos**
- Keyboard shortcuts and gestures — https://support.apple.com/guide/photos/pht9b4411b24/mac
- Add titles, captions and more — https://support.apple.com/guide/photos/phta4e5a733f/mac
- Apple Community — batch titles/captions — https://discussions.apple.com/thread/255675482
- UIKit zoom transition — https://developer.apple.com/documentation/uikit/uiviewcontroller/transition/zoom(options:sourceviewprovider:)
- WWDC24 — Enhance your UI animations and transitions — https://developer.apple.com/videos/play/wwdc2024/10145/

**Adobe Bridge**
- Customize the workspace — https://helpx.adobe.com/bridge/desktop/workspaces-and-panels/customize-the-workspace.html
- Adobe Bridge workspace — https://helpx.adobe.com/bridge/using/adobe-bridge-workspace.html

**Photo Mechanic (Camera Bits)**
- Contact Sheets: an overview — https://docs.camerabits.com/support/solutions/articles/48000207551
- Using the Metadata Info tool (IPTC) — https://docs.camerabits.com/support/solutions/articles/48000341504
- Colour class ratings — https://docs.camerabits.com/support/solutions/articles/48001142942
- Glossary of terms — https://docs.camerabits.com/support/solutions/articles/48001206190-glossary-of-terms
- ExpertPhotography — Photo Mechanic review — https://expertphotography.com/photo-mechanic-workflow/

**darktable**
- Lighttable modes — https://docs.darktable.org/usermanual/5.6/en/lighttable/lighttable-modes/
- Filemanager — https://docs.darktable.org/usermanual/5.6/en/lighttable/lighttable-modes/filemanager/
- Full preview — https://docs.darktable.org/usermanual/5.6/en/lighttable/lighttable-modes/full-preview/
- Culling — https://docs.darktable.org/usermanual/5.6/en/lighttable/lighttable-modes/culling/
- Keyboard shortcuts — https://docs.darktable.org/usermanual/4.6/en/overview/user-interface/keyboard-shortcuts/
- Color assessment — https://www.darktable.org/usermanual/en/module-reference/utility-modules/darkroom/color-assessment/

**Visual style**
- Envato Tuts+ — neutral gray themes in Photoshop and Lightroom — https://photography.tutsplus.com/tutorials/want-better-color-use-neutral-gray-themes-in-adobe-photoshop-and-lightroom--cms-23342
