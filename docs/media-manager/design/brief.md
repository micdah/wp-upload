# Design brief — wp-upload media manager

The single page the design phase works from. It condenses the Phase 1 research
([`../research/00-synthesis.md`](../research/00-synthesis.md)) into what a designer needs: goals,
principles, scope, layout anatomy, screens and states, content and keyboard rules.

## 1. Goal

A modern, sleek alternative to the WordPress Media Library. Opening, previewing, inspecting, editing and
organising media should feel **seamless, pretty and engaging**: closer to Lightroom, Apple Photos or
Immich than to wp-admin.

Two modes share one collection:

- **Grid:** a large media grid with an optional folder column (FileBird) on the left.
- **Detail:** a big preview with a filmstrip of neighbours along the bottom, in grid order. It replaces
  the grid in place. There is no modal and no page change.

Toggleable panels sit on the right (inspector) and left (folders). They stay put while the centre
switches between grid and detail.

## 2. Principles (ranked)

1. **One collection, many views.** Grid, detail and filmstrip are views of one ordered, filtered list
   with one selection and one focused item. Switching never loses position, order or selection.
2. **Spatial continuity.** The clicked thumbnail grows into the detail image and shrinks back into its
   cell. On return, the grid scrolls to the last-viewed item and briefly highlights it. Under reduced
   motion this becomes a cross-fade.
3. **Stable chrome, changing centre.** The toolbar, folder column and inspector stay in place in both
   modes. Only the centre stage changes.
4. **Images are the colour.** Chrome is neutral, with no tinted surfaces behind photos. A single accent is
   used for focus, selection and primary actions.
5. **Quiet at rest, rich on intent.** Tiles show only the image until hovered, focused or selected.
   Controls are revealed, not shouted.
6. **Edit inline, save quietly.** Fields autosave on blur or `Ctrl/Cmd+Enter`, with an inline "Saved".
   There are no Save buttons and no modal edit dialogs. "Save & next" covers alt-text passes.
7. **No layout shift, no spinners.** Boxes are reserved from known dimensions and filled with a
   placeholder colour that fades into the image. Skeletons match the shape of the content.
8. **Keyboard-first and discoverable.** Every action has a key, and `?` shows them all. Keys work on US
   and Danish layouts.
9. **Short, meaningful motion.** About 100 ms for fades, 150 ms for panels, 200–250 ms for overlays and
   the grid↔detail morph. Ease-out on enter, ease-in on exit.

## 3. Scope (v1)

**Core parity:**

- browse, filter, search and sort;
- FileBird folders (optional);
- metadata editing (title, alt, caption, description);
- attach and detach;
- copy URL, download;
- delete and trash;
- in-place crop, rotate and flip;
- upload, including into a folder.

**v1 extras:**

- batch metadata edit with "Mixed" values, a "missing alt" filter and badge, "Save & next";
- "where is this used", and an EXIF / file-details section;
- replace file, regenerate thumbnails, restore original, scale;
- sort and filter by size, dimensions, file name and type; alt-text and EXIF search; a month list;
- FileBird folder colours and folder sorting, **only when FileBird Pro is detected**.

**Not in v1:**

- ZIP downloads;
- the "Mine" filter;
- custom per-folder file order and multiple folders per file;
- FileBird per-user folder mode (unsupported, shown as a warning).

The media manager requires the companion WordPress plugin, and shows a "plugin missing" screen when it is
absent. ~~The existing upload page keeps working without the plugin.~~ *Amended (D1c, [implementation
plan](../implementation-plan.md) §0): the old upload page is removed; the plugin is required.*

## 4. Layout anatomy (desktop ≥ 1200 px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Toolbar (48)  brand · breadcrumb · search · filters · sort · layout · upload │
├───────────────┬──────────────────────────────────────────────┬───────────────┤
│ Folders       │  Grid mode: filter chips row (36)             │ Rail │ Panel  │
│ (280, drag    │  ┌──────────────────────────────────────────┐ │ (48) │ (312)  │
│  220–480,     │  │ justified grid, gaps 2–4 px              │ │      │        │
│  collapsible) │  │                                          │ │ Info │ fields │
│               │  └──────────────────────────────────────────┘ │ Edit │        │
│ All files     │                                               │ Used │        │
│ Uncategorized │  Detail mode (same area):                     │      │        │
│ ▸ Brand   24  │  ┌─ top bar: ← back · title · 12 / 340 · ⋯ ─┐ │      │        │
│ ▾ Blog   118  │  │                stage                     │ │      │        │
│    2025   80  │  │        (image, contain, zoomable)        │ │      │        │
│               │  ├──────────────────────────────────────────┤ │      │        │
│               │  │ filmstrip (96, resizable 64–160)         │ │      │        │
└───────────────┴──┴──────────────────────────────────────────┴─┴──────┴────────┘
```

| Region | Default | Range | Notes |
|---|---|---|---|
| Toolbar | 48 px high | — | Becomes the **selection bar** when ≥ 1 item is selected: "✕ N selected · Move · Edit · Delete" |
| Folder column | 280 px | drag 220–480 px; collapsible to 0 | Only when FileBird is enabled. Width is remembered. Constant width when the window resizes |
| Inspector | 48 px icon rail + 312 px panel (360 total) | panel drag 272–432 px; collapsible to the rail | Panels: **Info** (metadata), **Edit** (image edit), **Usage** (where used, attach) |
| Filmstrip | 96 px | drag 64–160 px; hideable | Detail mode only. Keeps the current item centred |
| Grid gap | 2–4 px (direction-specific) | — | Images form one surface. Panels use 16–24 px padding |
| Justified row height | 200 px at default density | 5 densities: 120 / 160 / 200 / 260 / 340 | The square layout uses the same densities as cell size |

**Breakpoints:**

| Width | Layout |
|---|---|
| ≥ 1200 px | Everything visible |
| 900–1199 px | The inspector collapses to its rail by default |
| 600–899 px (tablet) | The folder column becomes an overlay drawer. The inspector becomes an overlay sheet from the right |
| < 600 px (phone, fallback) | One panel at a time. Detail is full-screen with swipe and a bottom sheet for info. The toolbar wraps into two rows |

## 5. Screens and states inventory

| # | Screen / state | Stage |
|---|---|---|
| S1 | Grid: justified and square, density, hover / focus / selected tiles, badges (missing alt, type, uploading, error) | 1–2 |
| S2 | Selection: single, multi, range, select-all-in-view; selection bar | 1–2 |
| S3 | Folder column: tree, counts, All files, Uncategorized, expand/collapse, resize/collapse | 1–2 |
| S4 | Inspector: nothing selected (folder summary), one item (fields + file details), N items ("Editing N items", Mixed) | 1–2 (basic), 4 |
| S5 | Detail mode: stage, top bar, prev/next, filmstrip, info overlay, zoom; video, audio, PDF and SVG variants | 1–2 (basic), 4 |
| S6 | Grid ↔ detail transition (shared element) and the reduced-motion variant | 1 |
| S7 | Quick peek (`Space`) | 4 |
| S8 | Search, filter chips, sort menu, month list, missing-alt filter, size/dimension filters | 4 |
| S9 | Folder operations: create, inline rename, delete confirm, drag to folder, "Move to…" picker, Pro colours, per-user warning | 4 |
| S10 | Batch edit and "Save & next" alt-text flow | 4 |
| S11 | Image edit in place: crop with ratios, rotate, flip, scale, restore original, apply-to; replace file; regenerate | 4 |
| S12 | Upload: full-window drop overlay, upload tray, new tiles with progress | 4 |
| S13 | Delete: trash + undo toast, permanent-delete confirm with where-used, Trash view | 4 |
| S14 | System states: loading skeleton, empty library, empty folder, no results, errors, connection lost | 4 |
| S15 | Plugin missing onboarding; capability-limited (role) states | 4 |
| S16 | Shortcut sheet (`?`), command palette (`Ctrl/Cmd+K`) | 4 |
| S17 | Tablet and phone fallbacks | 4 |

Every screen is designed in **dark and light**.

## 6. Content model (what a tile or inspector can show)

From WordPress REST plus the companion plugin:

- **Core fields:** id, title, alt text, caption, description, file name, MIME type and derived kind
  (image / video / audio / document / archive / svg), file size, width and height, upload date and
  modified date, author.
- **Relations and derived data:** "uploaded to" post, folder, sub-sizes, EXIF subset (camera, lens,
  focal length, aperture, shutter, ISO, date taken), "used in" (posts/pages), per-item permissions.

**Copy tone:** plain, short, sentence case. Verbs on buttons ("Move to folder", "Delete permanently").
Counts use tabular figures. File names are truncated in the middle so the extension stays visible.

## 7. Keyboard rules

- Shortcuts must work **natively on US and Danish keyboards**. Handlers match `event.key`, the typed
  character, never `event.code`.
- Allowed: letters, digits, `,` `.` `-` `+` `?`, `Enter`, `Esc`, arrows, `Space`, `Tab`, `Delete`,
  `Home`/`End`, `PageUp`/`PageDown`, and Ctrl/Cmd + letter.
- Forbidden: `[ ] { } \ | @ $ ~`, which need AltGr on Danish keyboards. F-keys are also out.
- Text inputs swallow single-key shortcuts. Only `Esc` and `Ctrl/Cmd+Enter` act from a field.
- Initial map, finalised in `interaction-spec.md`:

| Key | Action |
|---|---|
| Arrows | Move focus |
| `Shift` + arrows | Extend selection |
| `Enter` / double-click | Open detail |
| `Esc` | Back one layer: field → panel → detail → clear selection |
| `G` | Grid |
| `←` / `→` (detail) | Previous / next |
| `Space` | Quick peek |
| `X` / `Ctrl/Cmd`+click | Toggle selection |
| `Ctrl/Cmd+A` | Select all |
| `F` | Toggle folder column |
| `I` | Toggle inspector |
| `+` / `-` | Density |
| `L` | Justified/square layout |
| `?` | Shortcut sheet |
| `Ctrl/Cmd+K` | Command palette |
| `Delete` | Remove from folder (in a folder), otherwise trash or delete with confirm |

## 8. Visual directions to explore (Stage 2)

All three share the markup and layout above and differ only in skin (tokens + CSS). Each needs dark and
light themes, WCAG AA text contrast, and a **neutral image stage**.

| Direction | Idea | Type | Colour |
|---|---|---|---|
| **Neutral + neon** | Today's brand, distilled: neutral chrome, neon as signal | A modern sans for UI, Orbitron reserved for the wordmark | Near-black / near-white neutrals; cyan neon (`#00e5ff` family) only for focus, selection, primary actions and the brand mark |
| **Pro tool** | Lightroom / Immich calm; the tool disappears | Humanist sans (e.g. Inter), dense and small | True greys; one restrained accent (blue or indigo, lighter and desaturated in dark) |
| **Adapted cyberpunk** | Keep the current identity, tamed for imagery | Rajdhani UI + Orbitron headings | Cyber chrome (toolbar, panels' edges, glow on focus) while the stage and tile surroundings stay neutral |
