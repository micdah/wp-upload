# Spec: upload, delete and trash, system states, shortcuts, small screens

Stage 4, area C. This covers screens S12–S17 of the [brief](../brief.md): upload, delete and trash,
system states, the plugin-missing and role-limited states, the shortcut sheet and command palette, and
the tablet and phone fallbacks.

| Part | Where |
|---|---|
| Code | `prototype/js/features/system.js`, which loads `system-upload.js`, `system-delete.js`, `system-states.js`, `system-commands.js`, `system-phone.js` and `system-shared.js` |
| Styles | `prototype/css/features/system.css` |
| Screenshots | `screenshots/system-*-dark.jpg` and `system-*-light.jpg`, produced by `scripts/shots/system.mjs` |
| Checks | `checks()` in `scripts/shots/system.mjs` |

Try it with `?scenario=` set to `trash`, `offline`, `author`, `loading`, `empty` or `no-plugin`, or drop
files on the prototype.

## 1. Upload (S12)

### Entry points

- **Drop anywhere.** Dragging files over any part of the window shows a full-window `.drop-overlay`
  that names where the files will go: "Drop to upload to “Spring campaign”", or "to “All files”". The hint
  line below gives the allowed types and the size limit.
  - Only drags that carry files trigger it. Dragging tiles to folders does not.
  - The app always claims file drags, so the browser never opens a dropped file in place of the app.
- **The `upload` action.** The toolbar button, the empty-state buttons and the palette all open the
  native multi-file picker. The picker is limited to the allowed extensions.
- **`U`** opens the same picker.

### Destination

- Inside a FileBird folder, files go into that folder and its count goes up straight away.
- In All files or Uncategorized, files go to Uncategorized.

### Lifecycle

Each file gets a tile at the top of the grid at once (newest first, in the order the files were
picked), and a row in the tray. The tile shows the real picture from an object URL for images, or the
type card for other files. Its box is reserved from the image's real dimensions, read within 200 ms, so
the grid doesn't jump.

| Phase | Tile | Tray row |
|---|---|---|
| Queued | Dimmed, ring at 0 % | "Waiting…" |
| Uploading (3 at a time) | Dimmed, accent ring with % | Progress bar and % |
| Processing | Less dimmed, spinning arc, "Processing" badge | "Processing · generating thumbnail sizes" with an indeterminate bar. After 8 s it reads "Still processing — busy sites can take a few minutes" |
| Done | The accent ring flashes once (as when returning from detail), then the normal tile | Check icon and size. The name links to the tile |
| Failed (transient) | Danger ring, "Failed" badge, Retry button on the tile | Red reason and a **Retry** button |
| Rejected (type or size) | No tile | Red reason ("`.exe` files aren’t allowed on this site", "Larger than the site’s 64 MB limit") and a remove button. There is no Retry, because retrying can't help |

**Processing is a real phase.** WordPress generates sub-sizes after the bytes arrive, and under parallel
load this can take minutes. The tile stays usable while it processes: it can be selected and its fields
edited. Only image-edit actions wait for the phase to end.

### Tray

The `.tray` sits bottom right:

- **Header:** "Uploading 3 of 5", then "Processing 2 of 5", then "Done · 5 uploaded", or "4 uploaded ·
  2 failed". Below it: the destination and the total size.
- **Progress:** a hairline under the header shows overall progress.
- **Collapse:** the chevron collapses the tray to its header. On phones the tray starts collapsed and
  spans the width.
- **Row order:** failures first, because they need action. Then the newest batch, in the order the files
  were picked.
- **Hiding:**
  - when every file succeeds, the tray hides itself 4 s after the last one finishes, but never while it
    is hovered or has focus;
  - if anything failed it stays, and the close button clears the failures.
- **Announcements:** start, failure and overlay text go to the polite live region.

The prototype simulates one transient failure: the third file of the first batch of three or more drops
at 62 %, and Retry succeeds. `window.__mmUpload.freeze()/step(ms)/resume()` drive the simulated clock
for screenshots.

### States that block uploads

- **Offline:** the overlay turns amber ("Uploads are paused while WordPress is unreachable"), the drop
  is ignored, and buttons are disabled.
- **Plugin missing:** the drop is swallowed. The onboarding screen points to the basic uploader.

## 2. Delete, trash and download (S13)

`Delete` is context-sensitive (brief §7, D8).

| Context | `Delete` (Mac: `⌘⌫`) | `Shift+Delete` (Mac: `⇧⌘⌫`) |
|---|---|---|
| Inside a folder | **Remove from folder.** Items go to Uncategorized; the toast offers Undo; no confirm | Delete from library (below) |
| All files or Uncategorized | Delete from library | Delete from library |
| Trash view | Delete the selected trash items permanently (with confirm) | — |

**Delete from library:**

- **`MEDIA_TRASH` on** (`scenario=trash`): items move to the Trash at once. The toast reads "Moved N
  items to Trash" with **Undo** and stays 8 s.
- **`MEDIA_TRASH` off:** a confirm dialog opens, with:
  - thumbnails of up to 5 items;
  - the title "Delete N items permanently?" or "Delete “title” permanently?";
  - why it can't be undone;
  - a **where-used notice**: "Used in 9 places. These will show a broken image or link, and lose their
    featured image", followed by up to 4 posts (type, featured flag, and file when several items are
    involved) and "and N more". Items used nowhere get a neutral "Not used in any post or page we know
    of";
  - for 25 or more items, **type-to-confirm**: the Delete button enables only once the count is typed.

  Focus starts on Cancel (or on the count field), and Esc cancels. After the delete, the toast reads
  "Deleted N items permanently", with no Undo.

**Mouse:** the Delete button in the selection bar or inspector, inside a folder, opens a small menu with
both choices and their keys: "Remove from “Spring campaign”" (Del) and "Delete permanently…" or "Move to
Trash" (Shift+Del). Outside a folder it goes straight to delete from library.

**After any removal:**

- focus moves to the item that took the first removed item's place (Finder-style), and the selection
  clears;
- in detail mode, the next item shows, and when nothing is left the view returns to the grid;
- folder counts update.

### Trash view (`scenario=trash`)

**Opening it:**

- a **Trash** row under Uncategorized in the folder column shows a count;
- the palette has "Go to Trash".

**What it shows:**

- the Trash view covers the centre like detail mode, and the toolbar and panels stay;
- tiles are square and desaturated until hovered or selected. Each has a "N days left" badge, which
  turns red at 3 days or less;
- an info notice explains the 30-day purge (`EMPTY_TRASH_DAYS`).

**Selecting:** click, `Space` or `Enter` toggles a tile. The bar then shows "N selected · Restore ·
Delete permanently", next to Select all and Empty trash.

**Actions:**

- **Restore** puts the items back in their folders and their old positions, selects them, and shows a
  toast;
- **Delete permanently** and **Empty trash** use the confirm above, with "removed from the server"
  wording;
- **Esc** clears the trash selection first, then leaves the Trash view. Clicking any folder also leaves
  it.

### Download

- **One item:** a toast reads "Downloading “file.jpg” · 2.4 MB", and the app links to the original file.
- **Several items:** ZIP is not in v1 (brief §3), and the toast says so honestly: "ZIP download isn’t
  available yet. Download the N files one by one? Your browser may ask to allow multiple downloads",
  with a **Download N** action.

## 3. System states (S14, S15)

| Scenario | Design |
|---|---|
| `no-plugin` | A full-screen onboarding card replaces the app (the app is made inert). See below |
| `offline` | An amber banner above the filter row: "Can’t reach WordPress. You’re browsing the copy loaded earlier; uploads and edits are paused until the connection is back", then "Retrying in 15 s" and **Retry now**. The wait backs off 15 → 30 → 60 s. The cached grid, detail mode, search and filters keep working. Everything with `data-mm-action` that mutates (Upload, Move, Edit, Delete, New folder) is disabled, with the reason as its tooltip. Inspector fields become read-only. Uploads and drops are refused with a toast |
| `author` | A subtle neutral banner: "You’re signed in as an Author. You can upload, and edit or delete media you uploaded. Other media is read-only — ask an Editor for more access". It can be dismissed for the session. Selecting someone else's item shows "Read-only — uploaded by …" at the top of the inspector, read-only fields and no Delete. Deleting a mixed selection skips the foreign items and says so in a toast (D9) |
| `loading` | A 2 px accent hairline slides along the top of the centre. The grid skeleton is core. The folder tree, filter chips and inspector get skeletons in their own shapes, never stale counts and never spinners |
| `empty` | The core empty state. Empty states that offer Upload become a dashed drop zone, and folder counts reset to 0 |

**Plugin-missing onboarding:**

- **What and why:** the plug icon and the brand, the title "Install the companion plugin to use the
  media manager", and one sentence saying why it's needed and that it wasn't found on the site;
- **What the plugin adds:** four items: folders, where it's used, trash and restore, regenerate and
  replace;
- **Three numbered steps:**
  1. download `wp-upload-companion.php`;
  2. put it in `wp-content/mu-plugins/` or install it as a plugin, which needs an Administrator;
  3. check again;
- **Actions:**
  - **Check again** (primary). It shows "Checking…", then "Checked at 14:05 · still not found. Is it in
    mu-plugins, or activated?";
  - **Use the basic uploader instead**, a link to the existing upload page, which works without the
    plugin (D1b).

  The title receives focus on load.

## 4. Shortcut sheet and command palette (S16)

### Shortcut sheet (`?`)

- **Built from `BINDINGS` when it opens**, so keys added by any feature appear automatically.
- **Layout:**
  - groups in a fixed order (Navigate, View, Select, Panels, Files, Edit, Folders, General), with any
    other group after them;
  - each row lists one action with all its chords ("Move focus: ← or → or ↑ or ↓");
  - "(detail)" marks keys that only work in detail mode;
  - a Mouse group lists click, Ctrl/⌘-click, Shift-click, double-click and drop.
- **Key labels:**
  - the modifier shows as Ctrl on Windows and Linux, ⌘ on Mac;
  - named keys show as ← → ↑ ↓, Esc, Del, Space and Menu.
- **Footer:** "Shortcuts follow the character you type, so they work on US and Danish keyboards, and
  none needs AltGr. Single keys pause while you type in a field; Esc leaves the field."
- **Modal behaviour:** a modal dialog with a focus trap and Esc to close. Focus returns to where it was.
  Keys pressed inside never reach the global keymap.

### Command palette (`Ctrl/Cmd+K`)

- **Placement:** a Spotlight-style field near the top.
- **Sources:**
  - **Actions:**
    - Upload and the shortcut sheet;
    - Download and Delete, when something is selected;
    - Go to Trash;
    - every keymap binding that makes sense out of context (panels, layout, density, select all,
      other features' N/R/M/E/A…);
    - Switch theme, the type and missing-alt filters, the sort orders, and Clear filters;
  - **Go to folder:** every folder, with its parent path as a hint;
  - **Media**, while typing: title, with the file name and folder as a hint and a thumbnail.
- **Matching:**
  - fuzzy subsequence matching; exact substrings and word starts rank first, and matches are
    highlighted;
  - per-group caps: Actions 8, Folders 5, Media 6;
  - with no query, it shows common actions and top folders;
  - with no match: "No matches for “…”".
- **Keys:**
  - `↑`/`↓` (and Tab) move;
  - `Enter` runs, `Esc` closes, and `Ctrl/Cmd+K` again closes it.
- **Running a command:**
  - the palette closes first, so the command sees the app as the user left it;
  - opening a media item clears folders and filters that hide it, then opens detail mode.
- **ARIA:** a combobox input with `aria-activedescendant` over a listbox.

### Undo (`Ctrl/Cmd+Z`)

`Ctrl/Cmd+Z` presses **Undo** on the newest toast that has one: remove from folder, trash, other
features' moves and batch edits. With none, the toast says "Nothing to undo". In text fields the
browser's own undo applies. `Ctrl/Cmd+Shift+Z` (redo) does nothing.

## 5. Tablet and phone (S17)

**Tablet (600–899 px):**

- The toolbar drops the wordmark and density slider, and search becomes an icon that expands over the
  bar. A close button, or blurring an empty field, collapses it.
- The folder drawer and inspector sheet (core) get a tap-to-close scrim, and picking a folder closes
  the drawer.
- An **Info** button appears in the detail bar.

**Phone (< 600 px):**

- **Toolbar** (one row): brand mark, breadcrumb, then search, Upload (icon only, still the one primary),
  folders and a **More** menu. The menu holds sort (radio), layout, larger and smaller thumbnails,
  Show/Hide info and theme.
- **Selection bar:** actions become icon buttons, and their labels stay as accessible names.
- **Filter chips** scroll sideways, and the summary is dropped.
- **No inspector rail.** The inspector is a **bottom sheet** (72 dvh) with a grab handle and tabs
  along the top.
- **Detail is full screen**, with a 64 px filmstrip and no arrows or zoom button:
  - **swiping** left or right on the stage steps between items. The picture follows the finger, with
    resistance at the ends, and commits past 64 px or on a fast flick. A zoomed image pans instead;
  - **Info** opens the bottom sheet over detail.
- **Tray and toasts** span the width.
- **Sheet and palette** use one column.

## 6. Keys added

All keys are layout-safe (`assertKeymapIsLayoutSafe`) and match `event.key`.

| Key | Action | Mode |
|---|---|---|
| `U` | Upload files | any |
| `Delete` (Mac `⌘⌫`) | Remove from folder in a folder, otherwise delete | any |
| `Shift+Delete` (Mac `⇧⌘⌫`) | Delete from library (Trash or confirm) | any |
| `?` | Shortcut sheet | any |
| `Ctrl/Cmd+K` | Command palette | any |
| `Ctrl/Cmd+Z` | Undo the newest undoable toast | any |

## 7. Edge cases

- **Multiple drops:** dropping while uploads run adds a new batch, and the tray merges them, newest
  batch first.
- **Rejected files:** rejected files never create tiles. Removing a failed upload removes its
  placeholder tile and restores the folder count.
- **Filters hiding uploads:** if the active filters hide uploaded files (e.g. the Video filter), the
  tray still shows them. Its "show" link only works when the tile is visible. Production should offer
  "Clear filters to show" there.
- **Other sort orders:** with a sort other than newest first, new tiles land where the sort puts them;
  the tray is the stable place to watch them.
- **Delete with nothing targeted:** pressing Delete with nothing selected or focused only announces
  "Select media to delete first".
- **Mixed Author selection:** see the `author` row in §3.
- **Undo after navigating:** undoing a folder removal after switching folders still restores the
  items; they just aren't visible there.
- **Trash and filters:** Trash ignores search and filters (it is a separate view), and its count lives
  in the folder column.

## 8. Companion plugin and API needs

| Need | Why |
|---|---|
| **Plugin detection:** a REST namespace such as `wp-upload/v1` on `GET /wp-json/` | Onboarding versus app; "Check again" re-runs the probe |
| **Capabilities:** `users/me?context=edit` (roles, `upload_files`, `edit_others_posts`, `delete_others_posts`) plus per-item `_links…targetHints.allow` | Author read-only states, disabled Delete, the skip toast (D9) |
| **Trash detection:** `MEDIA_TRASH` and `EMPTY_TRASH_DAYS` exposed by the plugin | Choosing Trash versus the confirm; "N days left" |
| **Trash list and restore:** list `status=trash` attachments (with `trashed_at`), restore (`wp_untrash_post`), delete with `force=true`, empty trash | The Trash view. Core REST has no restore for attachments |
| **Where-used:** `GET …/media/{id}/usage` returning `[{id, type, title, context: 'content' \| 'featured' \| 'gallery' \| 'meta'}]`, batchable for N ids | The delete confirm's notice and "featured image" flags |
| **Upload limits:** `wp_max_upload_size()` and `get_allowed_mime_types()` | Client-side rejection before upload ("not allowed", "too large") |
| **Processing status:** whether sub-sizes are done (`media_details.sizes` filled, or a plugin status field), polled after upload | The "Processing" phase, which can take minutes under load |
| **Health:** the proxy's health endpoint | Offline banner retries |

## 9. Requests to core

1. **Upload tiles in core.** `tileHtml` (grid and filmstrip), the detail stage and the inspector preview
   should honour `item.previewUrl` and an `item.upload = { phase, progress, error }` state. System now
   patches tiles through MutationObservers on `#grid`, `#detail` and `#inspector`, which works but is
   fragile.
2. **Keymap:**
   - export `runAction(name)`. The palette currently dispatches synthetic `keydown` events;
   - suspend global bindings while any `aria-modal` dialog is open, or while `#app` is inert.
     `ui.confirmDialog` currently lets single keys (e.g. `F`) through behind it. System's own modals
     stop propagation;
   - grid `ArrowUp`/`ArrowDown` still run while the onboarding screen covers the app.
3. **A `trash` place in the state and URL** (`?folder=trash`), so the Trash view is deep-linkable and
   Back leaves it. It is an overlay in `#center` today.
4. **A toast undo registry.** `showToast` could mark undoable toasts (e.g. `data-undo`) or keep a stack,
   so `Ctrl/Cmd+Z` doesn't rely on the button label "Undo".
5. **A capability gate for mutations.** Something like `can(action, item)` from D9 and the offline
   state, used by every view. System's offline lock only catches controls with `data-mm-action`.
6. **Rich `confirmDialog`.** Accept HTML content (lists, thumbnails, type-to-confirm), so the delete
   confirm can use the shared dialog. System has its own copy with the same classes.
7. **Re-render the inspector on `library-changed`.** The summary counts go stale after uploads and
   deletes; system works around this with an extra `update`.
8. **Boot order for `no-plugin`.** In production, check for the plugin before rendering the app,
   instead of rendering it and covering it.
