# 00 — Synthesis: what's possible, what's missing, what to decide

Phase 1 research for the media-manager idea: turning wp-upload into a modern alternative to the WordPress
Media Library, with a large grid, an optional resizable FileBird folder column and a Lightroom-style detail
mode (filmstrip and toggleable side panels). This doc condenses tracks A–G into one capability matrix, the
architectural forks, UX principles for the design phase and the decisions that are needed.

Baseline versions: WordPress 7.1.5, FileBird Lite 6.5.9, wp-upload `origin/master` @ `cfd647b`.
Status update (2026-11-22): the three issues found in the app and the stack upgrade (D5) are fixed on
`master` (#46, #47, #48), and this branch includes them (`master` @ `75e3b24`). See
[Issues spotted](#issues-spotted-in-the-current-app-resolved) and the D5 row.
All API claims are from reading source code, not from a live site. See [Verification](#verification-done-during-synthesis).

---

## TL;DR

1. **It is feasible.** Browsing, filtering, searching, previewing, metadata editing, deleting and uploading
   all work through core REST and the existing server proxy. All the UX ingredients (shared-element
   transitions, virtualised grids, filmstrip, resizable panels) are supported in today's browsers.
2. **FileBird is the weak link.** Its public API can list folders, create folders and assign files. It
   can't rename, delete or move folders, can't tell us which folder a file is in, and **`/wp/v2/media`
   can't be filtered by folder**. FileBird's internal `filebird/v1` routes probably work with our
   Application Password, but they are undocumented. A **~20-line companion mu-plugin** would make folders
   first-class in REST.
3. **Core REST has hard gaps:**
   - no batch for media;
   - delete is permanent unless `MEDIA_TRASH` is set;
   - image edits always create a *new* attachment;
   - no replace-file, restore-original or regenerate;
   - no "where is this used?";
   - no sorting or filtering by size or dimensions.

   Each gap is closed by either a **server-side index in our proxy** or the **companion plugin**.
4. **The stack needed a step 0 — now done (#48).** Most of the libraries the UX needs (React `<ViewTransition>`, Mantine 9
   Tree with drag-and-drop and lazy loading, several drag-and-drop and selection libraries) need
   **React 19**. wp-upload was on React 18 + Mantine 8 at research time; since #48 it is on React 19.3.1 +
   Mantine 9.8.2 + Vite 8.3.8.
5. **The visual direction changes.** Every reference app keeps its chrome neutral grey so that the images
   are the only colour on screen. The current cyberpunk theme (blue-tinted darks, neon glow) would tint how
   photos look. Neon can survive as the *accent* for focus and selection only.
6. **No existing web app combines all of it** (a detail view you can link to, a filmstrip in grid order,
   toggleable panels and a folder column). Immich, Google Photos, Eagle and Lightroom each provide pieces.
   That is the opportunity.

---

> **Decisions D1–D11 were recorded on 2026-11-22.** See [Decisions](#decisions-recorded-2026-11-22).
> In short: the companion plugin is always required, the proxy stays thin, FileBird's internal routes
> are not used, and Pro features are shown only when Pro is detected.

---

## Capability matrix

Legend:

- **WP UI**: the built-in Media Library (doc 03). **FB UI**: FileBird's own interface (doc 04).
- **API** values:
  - ✅ core REST or FileBird public API covers it;
  - 🟡 possible but needs extra work in our proxy;
  - 🔶 only through FileBird's internal `filebird/v1` routes (undocumented; **not used**, D2);
  - 🧩 needs the companion mu-plugin;
  - ❌ not possible.
- **Scope** (recorded 2026-11-22, see [Design-phase scope](#design-phase-scope-and-conventions-recorded-2026-11-22)):
  **v1** = the design phase designs it for the first version; **later** = deferred; **out** = not planned.
  The table reflects the decisions: where the plugin is the chosen path, API shows 🧩 even if a
  workaround existed.

### Browse, filter, search

| Capability | WP UI | FB UI | API | How / workaround | Scope |
|---|---|---|---|---|---|
| Paged grid of all media with total count | ✅ | ✅ | ✅ | `/wp/v2/media`, `per_page` ≤ 100, `X-WP-Total`; `HEAD` for counts (01 §1.4) | v1 |
| Filter by type (image/video/audio/document) | ✅ | ✅ | ✅ | `media_type`/`mime_type` (arrays since 6.9). Video and audio come from `mime_type` (01 §1.1) | v1 |
| Filter by date range | month only | — | ✅ | `after`/`before`, `modified_*` | v1 |
| List of months that have media (for the date dropdown) | ✅ | — | 🧩 | Plugin route listing year/months with counts | v1 |
| Unattached / attached filter | ✅ | — | ✅ | `parent=0` | v1 |
| "Mine" filter | ✅ | — | ✅* | *Always the one Application Password user. Low value | out — always the one WP user |
| Search title, caption, description, file name | ✅ | ✅ | ✅ | REST adds filename matching when `search` is set (verified, see below) | v1 |
| Search alt text or EXIF keywords | ❌ | ❌ | 🧩 | Plugin search parameter | v1 |
| Sort by date, title, modified, author, id | list view only | Pro | ✅ | `orderby` enum (01 §1.1) | v1 |
| Sort or filter by size, dimensions, file name, type | ❌ | Pro (some) | 🧩 | Plugin adds `orderby`/filter params to `/wp/v2/media` (SQL on postmeta) | v1 |
| "Missing alt text" filter | ❌ | ❌ | 🧩 | Plugin filter param; thumbnail badge in the grid | v1 |
| Justified (aspect-preserving) grid | ❌ | ❌ | 🧩 | Plugin returns a compact id/width/height list for the filtered set, so layout is known up front (D4) | v1 default; square = toggle |

### Folders (FileBird, optional)

| Capability | WP UI | FB UI | API | How / workaround | Scope |
|---|---|---|---|---|---|
| Folder tree with counts | — | ✅ | ✅ | Public `GET /folders`, or the plugin (preferred, one surface). Recursive counts computed client- or plugin-side | v1 |
| All Files / Uncategorized pseudo-folders | — | ✅ | 🧩 | Plugin: `/wp/v2/media?fbv=0` for Uncategorized, `fbv` omitted for All Files | v1 |
| Files in a folder, paged and sorted | — | ✅ | 🧩 | Plugin: native `/wp/v2/media?fbv=<id>` (paging, sort, search) | v1 |
| Which folder a file is in (detail panel) | — | ✅ | 🧩 | Plugin REST field on each media item | v1 |
| Create folder (nested) | — | ✅ | ✅ | Plugin wrapping FileBird's functions (public API remains for the upload-only flow). Duplicate names auto-rename since 6.5.2 | v1 |
| Rename, delete, move or reorder folders | — | ✅ | 🧩 | Plugin wraps FileBird's PHP functions. FileBird's internal `filebird/v1` routes are **not** used (D2) | v1 |
| Move files to a folder (bulk) | — | ✅ | 🧩 | Plugin bulk-assign route with capability checks | v1 |
| Upload straight into a folder | — | ✅ | ✅ | Works today (upload, then assign). `POST /wp/v2/media?fbv=<id>` may do it in one call (verify in dev stack) | v1 (exists) |
| Folder colours, sort folders by name | — | Pro | 🧩 | Plugin, **only when FileBird Pro is detected** (D3). On Lite: hidden; existing colours shown read-only | v1, Pro only |
| Download folder as ZIP | — | Pro | 🟡 | Our server could stream a zip; deferred. Folder ZIP is a FileBird Pro feature (D3 spirit) | later / out |
| Custom file order within a folder; multiple folders per file | — | ❌ | ❌ | Not possible on FileBird's data model | out |
| Per-user folder mode | — | ✅ | ⚠️ | Unsupported; the plugin reports the setting and the app shows a warning (D10) | unsupported |

### Detail mode, metadata, actions

| Capability | WP UI | FB UI | API | How / workaround | Scope |
|---|---|---|---|---|---|
| Responsive preview (srcset from sub-sizes) | ✅ | — | ✅ | `media_details.sizes`; original = `source_url` + `original_image` | v1 |
| Video, audio, PDF previews | ✅ | — | ✅ | Native players; PDF preview sub-sizes | v1 |
| Prev/next in grid order + filmstrip | Alt+←/→ | — | ✅ | Client-side from the paged list; always walks the whole collection, not just the selection | v1 |
| Edit title, alt, caption, description | ✅ autosave | — | ✅ | `POST /wp/v2/media/{id}` | v1 |
| Batch metadata edit (N items) | ❌ | ❌ | 🟡/🧩 | Proxy fan-out with limited concurrency, or a plugin bulk route (decide in implementation) | v1 |
| "Save & next" alt-text flow | ❌ | ❌ | ✅ | Pure UX on top of single updates | v1 |
| EXIF / file details panel | partial | — | ✅ | `media_details.image_meta` subset, `filesize`, `filename` (7.0+) | v1 |
| Attach to / detach from post | ✅ | — | ✅ | `post` field | v1 |
| Copy URL, download, open in wp-admin | ✅ | — | ✅ | Trivial (single-file download; multi-file ZIP is later/out) | v1 |
| Delete permanently | ✅ | — | ✅ | `DELETE ?force=true` behind a confirm that shows where-used data (D8) | v1 |
| Trash / restore | if `MEDIA_TRASH` | — | ✅/🧩 | Detect `MEDIA_TRASH`: trash + undo + Trash view, restore via plugin; otherwise permanent delete (D8) | v1 |
| Crop, rotate, flip | ✅ in place | — | 🧩 | **In place via the plugin** (D7), same ID/URL; core `/edit` (copy) not used | v1 |
| Scale, restore original, apply to thumbnail only | ✅ | — | 🧩 | Not in REST | v1 |
| Regenerate thumbnails | ❌ (plugin) | — | 🧩 | `post-process` only creates *missing* sizes | v1 |
| Replace file, keep URL | ❌ | — | 🧩 | Long-standing core gap (Trac #20602) | v1 |
| "Where is this used?" | partial | — | 🧩 | Plugin index; also powers the delete warning | v1 |
| Per-item permission hints | ✅ | — | ✅ | `_links.self.targetHints.allow` + `users/me` capabilities (D9) | v1 |
| Change detection / sync | — | — | 🟡 | No ETags. `modified_after` misses deletes, regenerations and folder moves → periodic ID sweep | v1 |

**Reading the matrix:** with the companion plugin always required (D1b), almost every gap is in reach,
and nearly everything is **v1**. Only these are deferred or excluded:

- the "Mine" filter (it always means the one WP user);
- ZIP downloads (later or out);
- custom per-folder file order and multiple folders per file (FileBird's data model doesn't allow them);
- per-user folder mode (unsupported, with a warning).

The core upload feature keeps working without the plugin.

---

## Architectural forks (decide before or early in design)

### Fork 1 — How do we close the API gaps?

| Option | Unlocks | Cost / risk |
|---|---|---|
| **a. Core REST + FileBird public API only** | Parity for browse and edit; folder tree read, create and assign | No folder rename, delete or move; folder listing via ID lists; no Uncategorized list |
| **b. a + FileBird internal `filebird/v1` via app password** | Full folder CRUD and bulk assign | Undocumented, changed in recent security releases. Needs a live test. Still no `?fbv=` on `/wp/v2/media` |
| **c. a + companion mu-plugin** (namespace e.g. `wp-upload/v1`) | `?fbv=` on `/wp/v2/media` (native paging, sort and search incl. Uncategorized), folder REST field, clean folder CRUD over FileBird's own functions, optional: size/dimension orderby, missing-alt filter, month list, used-in, regenerate, replace, restore | Users must install a file into `wp-content/mu-plugins`. We own a PHP artifact (tests, versioning) |

Recommendation: **design for c, degrade to b, then to a.** The app detects capabilities from the
`/wp-json/` namespace index and hides or disables what's missing. FileBird stays optional either way.

> **Decided (D1, D1b, D2):** option **c**, and stricter than recommended. The companion plugin is a
> **hard requirement** of the media manager, whether or not FileBird is used. FileBird's internal
> `filebird/v1` routes are **not** used (option b dropped). FileBird itself stays optional. The plugin
> wraps FileBird's own functions when FileBird is active.

### Fork 2 — Thin live proxy vs server-side index

The research points to a **lightweight index in the proxy** with these columns: id, dates, mime, size,
width, height, alt-present and folder. It is built by crawling (100 items per request) and kept fresh with
`modified_after` plus periodic ID sweeps. The index enables:

- a justified grid (dimensions up front);
- sorting and filtering by size or dimensions and "missing alt";
- an instant scrubber, select-all across pages and "folder of file";

all **without** the plugin. The cost is sync complexity, an initial crawl and somewhere to store it (the
container is stateless today). If the plugin is accepted (Fork 1c), much of this moves into SQL on the WP
side and the index can stay small or become a cache.

> **Decided (D4):** **thin proxy.** Filtering, sorting, dimension listing, missing-alt and folder lookups
> are done in the companion plugin's SQL. The Node server keeps only short-TTL caching and stays
> stateless.

### Fork 3 — Frontend platform

- Upgrade to **React 19.3 + Mantine 9** first (doc 07 §Summary). Mantine 8 is no longer updated.
  **Done in #48** (React 19.3.1, Mantine 9.8.2, Vite 8.3.8, React Compiler not enabled).
- Libraries that come up repeatedly: TanStack Virtual for the grid, filmstrip and tree; TanStack Query for
  paged lists, item cache and mutations; Pragmatic drag-and-drop or Headless Tree for drag-and-drop; Mantine
  Spotlight for a command palette.
- **Detail mode should be an overlay above a grid that stays mounted and is marked `inert`.** Scroll,
  virtualiser state and selection then survive switching for free, and the return animation always has a
  target.
- State lives in **URL query parameters** (`?folder=…&sort=…&item=123`), not paths. A path like
  `/item/123` would break the relative asset URLs that let the app run under a sub-path.
- Making that choice is out of scope for this phase. It only needs settling before implementation, not
  before design.

> **Decided (D5):** do the React 19.3 + Mantine 9 upgrade **on `master` first**, as a separate change, so
> the current app benefits too. Then rebase `feature/media-manager` onto it. Picking the remaining
> libraries is still an implementation-planning task.

---

## Contradictions between tracks (resolved)

| Topic | Tracks said | Resolution |
|---|---|---|
| Does REST `search` match file names? | 03: no; 01: yes | **Yes.** `class-wp-rest-attachments-controller.php:388-391` adds `wp_allow_query_attachment_by_filename` when `s` is set. Doc 03 corrected. |
| Detail mode as "its own route" (06) vs "overlay over the grid" (07) | — | Compatible. Detail state lives in the URL (`?item=`, Back works), but is *rendered* as an overlay above the mounted grid. |
| Justified grid by default (06) vs square first (07) | — | Justified is the target look. Whether it ships first depends on Fork 2 (an index gives dimensions up front). Design both; square stays a density/layout option for mixed media. |
| `Delete` key: "trash" (06) vs context-sensitive (05) | — | Adopt 05's rule. Inside a folder, `Delete` = remove from folder. `Shift+Delete` = delete from library (with confirm, since WP delete is permanent). |
| File sort by size listed as FileBird-parity "must" (04) | — | Not possible in core REST. It moves to **H**, gated on Fork 2 or the plugin. |
| WordPress delete without `MEDIA_TRASH` (07 cited from memory) | — | Confirmed in source: `class-wp-rest-posts-controller.php:1102, 1150-1153` returns 501 `rest_trash_not_supported` unless `force=true`. |

---

## UX principles for the design phase

Distilled from docs 05, 06 and 07. Ranked by how much they contribute to "seamless, pretty, engaging".

1. **One collection, many views.** Grid, detail and filmstrip are views of one ordered, filtered list with
   one selection and one focused item. Switching never loses position, order or selection. (All reference
   apps)
2. **Spatial continuity.** The thumbnail grows into the detail hero image and shrinks back into its cell.
   When you return, the grid scrolls to the last-viewed item and briefly highlights it. Reduced-motion
   users get a cross-fade instead. (Apple Photos, Google Photos)
3. **Stable chrome around a changing centre.** The left folder column and right panel stay put in both
   modes. Only the stage changes.
4. **Right panel = one slot plus an icon rail.** Info/metadata, Edit image, Details/usage. Click the
   active icon to collapse. The width can be dragged and is remembered. (Lightroom cloud; avoid Lightroom
   Classic's stacked solo panels.)
5. **Selection-aware inspector.** Nothing selected shows the folder summary. One item shows editable
   fields. Several items show "Editing 12 items", with differing values marked "Mixed" and left untouched
   unless edited. (Eagle; avoid Lightroom Classic's Target/Auto Sync.)
6. **Autosave inline, quietly.** Fields save on blur or `Ctrl/⌘+Enter` with an inline "Saved ✓" and no
   Save buttons. "Save & next" (`Enter` in the alt field moves to the next item with focus kept) plus a
   "Missing alt" filter turns accessibility into a quick pass.
7. **Images are the only colour.** A near-black neutral canvas (#0A0A0A–#121212) with surfaces one or two
   steps lighter. One accent, lighter and desaturated in dark mode, used for focus and selection. Tight
   2–4 px grid gaps against generous 16–24 px panel padding.
8. **Quiet tiles, controls on hover.** A hover-revealed check circle on a soft gradient. Once anything is
   selected, clicks toggle. Shift-click selects a range. The top bar turns into "✕ N selected · actions".
   Selected tiles shrink to about 85 % with an accent overlay. (Google Photos, Immich)
9. **No layout shift, no spinners.** Boxes are reserved from known dimensions, filled with a placeholder
   colour or hash that fades in over about 100 ms. Skeletons are shaped like the content. Empty states
   are illustrated.
10. **Drop anywhere to upload.** A full-window drop overlay. New items appear in place as tiles with
    progress rings, plus a compact upload tray. The upload queue becomes part of the library, not a
    separate page.
11. **Keyboard-first, discoverable, layout-safe.** Every shortcut must work natively on **US and Danish**
    keyboards (see [conventions](#design-phase-scope-and-conventions-recorded-2026-11-22)).
    - `G`/`Esc` for grid; `Enter` for detail; `Space` for a quick peek; `←`/`→` for previous/next.
    - Separate letter keys toggle the left and right panels (proposed `F` folders, `I` info). `Tab` and
      `Shift+Tab` remain normal focus navigation.
    - `?` shows a shortcut sheet; `Mod+K` opens a command palette.
    - `Esc` steps back one layer at a time: field, then panel, then detail.
12. **Short, meaningful motion.** About 100 ms for fades, 150 ms for panels and 200–250 ms for overlays.
    Ease-out on enter, ease-in on exit.

**Avoid:**

- modal or tabbed asset dialogs;
- explicit Apply/Close edit dialogs;
- masonry as the default for a sorted library;
- square crops as the *only* option;
- F-key shortcuts;
- edge-hover auto-show panels;
- develop/editing modules and a full IPTC field set;
- a toast for every save;
- more than about two density controls in the main toolbar.

---

## Decisions (recorded 2026-11-22)

| # | Question | Decision | Consequences |
|---|---|---|---|
| D1 | Is a companion mu-plugin acceptable? | **Yes, required whenever FileBird support is on** | Folder-filtered `/wp/v2/media?fbv=`, Uncategorized listing, "folder of file" and folder CRUD all come from the plugin. No workaround code paths for missing folder APIs. |
| D1b | Is the plugin also needed when FileBird is off? | **Always required.** The media manager needs the companion plugin regardless of FileBird | One capability set and no degraded modes. Regenerate, replace, restore original, used-in, size/dimension sort, missing-alt filter and month list are all in scope through the plugin. The app checks for the plugin's REST namespace and explains how to install it when missing. **Confirmed:** the existing core upload feature must keep working without the plugin, for users who can't or won't install it. |
| D2 | Use FileBird's internal `filebird/v1` routes? | **No** | The plugin calls FileBird's PHP functions or tables directly. The existing public-API calls (upload + assign) can move into the plugin over time. |
| D3 | Expose FileBird Pro-gated features (colours, folder sort)? | **Only when FileBird Pro is detected** | The plugin reports whether Pro is active. Colours and folder sorting are offered only then, implemented through the plugin, since D2 rules out `filebird/v1`. On Lite they are hidden; existing colours can be shown read-only. How to detect Pro is an implementation detail to settle. |
| D4 | Server-side index vs thin proxy | **Thin proxy; plugin-side SQL** | The Node server stays stateless with short-TTL caching only. The plugin exposes dimensions in list responses so the justified grid can be laid out up front. |
| D5 | React 19.3 + Mantine 9 upgrade | **Upgrade on `master` first** as a separate change, then update the feature branch | **Done:** [#48](https://github.com/micdah/wp-upload/pull/48) merged to `master` and merged into this branch. See "Notes from the upgrade" below. |
| D6 | Visual direction | **Explore in the design phase** | Phase 2 produces 2–3 visual directions (e.g. neutral + neon accent, fully neutral, adapted cyberpunk) and picks one there. The research favours neutral chrome for image fidelity. |
| D7 | Image edit semantics | **In place, through the plugin** (wp-admin parity) | Same ID and URLs. Restore original, scale and "apply to all / thumbnail / all except thumbnail" are provided by the plugin. Core `/edit` (save as copy) is not used. |
| D8 | Delete semantics | **Detect and adapt** | `MEDIA_TRASH` on: trash with an undo toast, a Trash view, and restore through the plugin. Off: permanent delete behind a confirm dialog that warns about usage, e.g. featured images, using the plugin's used-in data. |
| D9 | Required WP role | **Editor or higher; detect and adapt** | Document Editor as the minimum. Read real capabilities from `users/me?context=edit` and per-item `targetHints`, and disable actions the user can't perform. Plugin settings, if any, may need Administrator. |
| D10 | FileBird per-user folder mode | **Unsupported, with a visible warning** | The plugin reports the setting and the app shows a clear notice. Only shared mode is supported. |
| D11 | Live test environment | **A Docker Compose dev stack** | WordPress 7.1 + MariaDB + FileBird Lite, with the companion plugin mounted. Used for development, the live checks below and integration tests. A seed script for large libraries was not chosen for now. *Superseded by D18 in the [implementation plan](../implementation-plan.md) §5: a `large` 50k seed is part of the local Docker test mode.* |
| D1c | Keep the old upload page? (recorded during implementation planning) | **No — remove it.** Overrides D1b's "the upload page keeps working without the plugin" | The media manager plus the companion plugin becomes the only UI. Without the plugin, the app shows the onboarding screen. The old page stays on the branch until the media manager's upload and onboarding land, then is deleted. See [implementation-plan.md](../implementation-plan.md) §0 (also D12–D18) |

### Follow-up work implied by the decisions

- **On `master`, separate from this branch — done:**
  - ~~the React 19.3 + Mantine 9 upgrade (D5)~~ → #48;
  - ~~the three issues listed under "Issues spotted in the current app"~~ → #46, #47.
- **On `feature/media-manager`, before or alongside design:** the Docker Compose WordPress dev stack
  (D11), then the live checks below. Checks that only concerned FileBird's internal routes are moot after
  D2.
- **Phase 2 (design):**
  - 2–3 visual directions (D6);
  - interaction design that assumes the full plugin-backed capability set (D1b), including trash vs
    permanent-delete flows (D8);
  - in-place image editing UI (D7);
  - capability-disabled states (D9);
  - the "plugin missing" onboarding screen.
- **Companion plugin spec**, a new artifact: REST namespace; `fbv` and dimension/size/missing-alt
  parameters on `/wp/v2/media`; folder CRUD; folder-of-file field; Pro and per-user-mode detection;
  in-place edit, restore, regenerate, replace and used-in; versioning, and how the app checks
  compatibility.

---

## Needs live verification (source-read only)

- ~~`filebird/v1` internal routes accept Application Password auth~~ — moot after D2.
- `POST /wp/v2/media?fbv=<id>` auto-assigns the folder during upload.
- Per-user folder mode behaviour for app-password callers.
- `POST /wp/v2/media?_method=GET` with a large JSON `include` passes the reverse proxy or WAF.
- WP 7.1 client-side processing routes (`/sideload`, `/finalize`) and `image_sizes` in the index behind a
  TLS-terminating proxy (`is_ssl()`).
- Performance of FileBird's Uncategorized and count queries, and of REST search, at 50k+ attachments.

## Issues spotted in the current app (resolved)

These concerned `master` and were fixed there in separate sessions (2026-11-22). The original findings are
kept below for the record.

| Issue | Fixed in | Outcome |
|---|---|---|
| 1 + 3 | [#46](https://github.com/micdah/wp-upload/pull/46) | Uploads are now **streamed multipart** (filename in the form-data part, no PHP memory issue). multer reads UTF-8 filenames (`defParamCharset: 'utf8'`). Uploads use `maxRedirects: 0`, and 3xx responses map to a new `wp_redirect` error code. |
| 2 | [#47](https://github.com/micdah/wp-upload/pull/47) | `unwrap()` reads `data.mess`. Folder names are HTML-entity-decoded. The server rejects names FileBird would store as empty (400), exhausted duplicate names (409) and missing parent folders (404). `assignToFolder()` checks the folder exists first. **Verified live** on a WordPress Playground site with FileBird 6.5.9. |

### Notes from the upgrade (#48) for media-manager implementation

- Mantine 9's `Tree` re-initialises its expanded state whenever `data` changes identity, so the tree data
  must be memoised (see `FolderPicker`).
- Vite 8's default build targets are Safari/iOS 16.4+, Chrome 111+ and Firefox 114+ (`build.target` not
  pinned). These are compatible with the View Transitions plan.
- The JS bundle is now about 522 kB, above Vite's 500 kB warning. The media manager should be
  code-split.
- WordPress Playground (`@wp-playground/cli`) worked for live verification without Docker (#47). It
  is a lightweight complement to the Docker Compose stack (D11). *Superseded by D18: Playground is not
  part of the test path.*

### Original findings

1. **Upload filenames are probably mangled.** `server/src/lib/wpUpload.ts:94` sends
   `filename="${encodeURIComponent(name)}"`. WordPress does not decode this
   (`get_filename_from_disposition`, `class-wp-rest-attachments-controller.php:2038+`), so `my photo.jpg`
   likely lands as `my20photo.jpg` after sanitising. Source-verified, not live-tested.
2. **FileBird error messages are dropped.** `server/src/lib/filebird.ts` `unwrap()` misses FileBird's
   `data.mess` error field. The `createFolder` duplicate-name comment is also outdated, since FileBird
   6.5.2+ auto-renames.
3. **Large uploads may hit PHP memory limits.** Raw-body uploads are read fully into PHP memory;
   multipart avoids this for very large files (01 §3.1).

## Verification done during synthesis

Checked directly against the downloaded sources:

- media `allow_batch = false`: `class-wp-rest-attachments-controller.php:35`;
- trash → 501 without `MEDIA_TRASH`: `class-wp-rest-posts-controller.php:1102, 1150-1153`;
- `/edit` inserts a new attachment: `class-wp-rest-attachments-controller.php:1290-1306`;
- `filename`/`filesize` fields: lines 1549-1554;
- `orderby` enum: `class-wp-rest-posts-controller.php:3068+`;
- REST filename search: lines 388-391;
- FileBird `filebird/v1` permission callback = `current_user_can('upload_files')`:
  `includes/Rest/FolderApi.php:108-109`;
- no `rest_attachment_query` hook in FileBird;
- `add_attachment` reads `$_REQUEST['fbv']`: `includes/Classes/Core.php:207+`;
- the `Content-Disposition` filename is not decoded by WP.

## Next phase (design) — inputs ready

- Parity checklists: doc 03 (core) and doc 04 (FileBird).
- Ranked patterns: doc 05 §8 and doc 06 §5. Keyboard map draft: doc 05 §10.
- Visual-style observations: doc 06 §7 and doc 05 §7.
- Feasibility and effort table: doc 07.
- The open UX questions from the research are now settled: see
  [Design-phase scope and conventions](#design-phase-scope-and-conventions-recorded-2026-11-22).
- Doc 05 §10's keyboard draft uses `[`, `]` and `\`. Those break on Danish layouts and must be revised
  in design.

## Design-phase scope and conventions (recorded 2026-11-22)

### v1 scope

**In v1**, on top of core parity (grid, filters, search, folders, metadata editing, delete/trash,
crop/rotate/flip, upload):

| Group | Included |
|---|---|
| Batch editing and alt text | Batch metadata edit across N items ("Mixed" values), a "missing alt" filter and thumbnail badge, and the "Save & next" alt-text flow |
| Usage and file details | A "where is this used" index (it also powers the delete warning), and a read-only EXIF / file-details section |
| Image maintenance | Replace file (keeps URL and ID), regenerate thumbnails, restore original, scale, in-place crop/rotate/flip (D7) |
| Advanced sort and search | Sort/filter by size, dimensions, file name and type; alt-text/EXIF search; a month list for the date filter |
| FileBird Pro only (D3) | Folder colours and folder sorting, offered only when Pro is detected |

**Later or out:**

- ZIP downloads, both selection and folder (later/out);
- the "Mine" filter (out);
- per-folder custom file order and multiple folders per file (out: FileBird's data model);
- per-user folder mode (unsupported, with a warning).

### Interaction conventions

| Topic | Decision |
|---|---|
| Default grid | **Justified** (aspect-preserving) by default, with **square** as a layout toggle (better for mixed media and documents) |
| `Space` in the grid | **Quick peek** of the focused item (Quick Look style). `Enter` opens detail mode. `X` or `Ctrl/Cmd+click` toggles selection |
| `←`/`→` and the filmstrip in detail | Always walk the **whole current collection** (folder + filters + sort). The selection is kept and shown in the filmstrip |
| Panel toggles | **Separate keys** for the left (folders) and right (inspector) panels; proposed `F` and `I`. `Tab`/`Shift+Tab` stay as accessible focus navigation |
| Keyboard layouts | **All shortcuts must work natively on US and Danish (DK) keyboards.** Match on `event.key` (the typed character), not `event.code`. Use letters, digits and `,` `.` `-` `+` `?`. **Never** use `[ ] { } \ \| @ $ ~`, which need AltGr on DK. Modifier combos (`Ctrl/Cmd+K`) are fine with letters. Design must check the final keymap on both layouts |
| Themes | **Dark and light from the start**, both first-class, following the system preference with a manual override. The detail-mode stage can stay dark in both, as in Google Photos and Immich |
| Visual direction | Explore 2–3 directions in design (D6) |
| Devices | **Responsive, desktop-first.** Desktop and tablet are designed fully. Phones get a usable fallback (one panel at a time, swipe in detail, bottom sheets) without full polish. ~~The upload page stays mobile-friendly~~ *(superseded by D1c: the media manager's phone layout carries phone uploads)* |
