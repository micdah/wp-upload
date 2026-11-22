# 04 — FileBird UI inventory (track D)

Research for turning wp-upload into a full media-library replacement with a FileBird folder column. This file covers FileBird's **UI/UX and feature set**. The REST API is covered in depth by another track, so backend calls are only named here where they explain a UI feature.

Baseline: **FileBird Lite 6.5.9** source (React 18 + Zustand + rc-tree + Radix UI, built with Vite), plus the wordpress.org listing, the ninjateam GitBook docs, and the review pages.

Confidence tags:
- **[source]**: read in the 6.5.9 free code.
- **[docs]**: taken from the vendor docs, the wordpress.org listing or the changelog.
- **[assumption]**: inferred, not verified.

---

## Summary

- **A small, polished feature set.** FileBird puts a single-root folder tree in a resizable left sidebar (300–650 px, collapsible) inside the WP media library grid, list view and media modal. It adds:
  - two pseudo-folders: **All Files** (id `-1`) and **Uncategorized** (id `0`);
  - a right-click context menu, drag-and-drop for folders and files, and a folder search box;
  - per-folder file counts, either direct or including subfolders;
  - a breadcrumb, an upload progress panel, and a "Move N items" flow for touch devices.
- **Folders are virtual.** Each file sits in **at most one folder per owner**, and assigning a file replaces its previous folder. Deleting a folder deletes its **whole subtree**, and the files fall back to *Uncategorized*. No media is ever deleted.
- **The Free/Pro line is drawn in the UI, not on the server.**
  - Free gets unlimited folders, nesting, DnD, cut/paste, rename, bulk delete, search, counters, startup folder, per-user folders, CSV export/import, backups and importers.
  - Pro gets folder colors, sort folders and sort files from the menu, Download-as-ZIP, the Windows 11 and Dropbox themes, page-builder and modal integrations, and multi-level post-type folders.
  - In Lite, several Pro items are simply disabled menu entries with a PRO badge. The `update-folder-color` and `get-folders?orderby=` endpoints are **not license-checked server-side** [source]. A REST client like ours could offer folder colors and folder sorting "for free", but this is a gray area; see Opportunities.
- **The UX is mostly good but dated in places.**
  - No multi-folder membership.
  - No "expand/collapse all".
  - No keyboard shortcuts beyond an ARIA tree with arrow keys, F2-less rename (double-click is used instead) and Shift+F10 for the context menu.
  - No undo; files cannot be dragged to reorder.
  - The tree is not virtualized, and reviewers complain about performance with many folders.
  - Users also complain about upsell nags and "crippled free version".
- **Competitors** have features worth taking:
  - multiple folders per file (Premio Folders, HappyFiles, WP Media Folder);
  - shortcuts and custom file order (Real Media Library);
  - sticky/starred/locked folders, duplicate and undo (Premio);
  - dynamic folders and type/size/date filters (WP Media Folder, Premio Pro);
  - replace-media (Premio, WP Media Folder).

---

## 1. Folder sidebar

| Feature | Free/Pro | Details | Notes |
|---|---|---|---|
| Tree rendering | Free | `rc-tree` with `role="tree"`/`treeitem`, a chevron switcher icon, a folder icon and a name (truncated with an ellipsis and a tooltip on overflow). Expanding and collapsing are animated (height motion). Custom drop-indicator line. **[source]** `main.tsx` | Not virtualized: rc-tree `virtual` is unused **[source]**. A review is titled "Not good when have many folders" **[docs]**. |
| Pseudo-folders | Free | **All Files** (`-1`, "allFoldersIcon") and **Uncategorized** (`0`, "unFoldersIcon") are rendered as a separate list above the tree, each with its own count (`allAttachmentsCount`, `unAttachmentsCount`). Both are drop targets: dropping on Uncategorized removes a file from its folder. All Files is *not* a valid move target ("All Files is not a folder"). **[source]** | Our app needs both. Uncategorized is computed server-side as `NOT IN` the files that have folder rows. |
| Per-node expand/collapse | Free | Chevron click, or ArrowRight/ArrowLeft (RTL-aware). Expanded keys live in a Zustand store. **[source]** | — |
| Expand/collapse **all** | — | **Not present.** No string or code for it. While a search is active, the tree auto-expands to show every match. **[source]** | Easy win for us. |
| File counts | Free | A count badge on every folder and pseudo-folder. Two modes, chosen per user in the toolbar ⋯ menu → **Count** and in Settings → Folder counter:<br>• `counter_file_in_folder`: direct files only (default);<br>• `counter_file_in_folder_and_sub`: recursive sum over all descendants.<br>Trashed posts and some third-party hidden attachments are excluded. **[source]** `Model/Folder.php::countAttachments`, `getNestedCountAttachments` | The server returns `display` (per mode) and `actual` (direct) maps, so both are available. Counts are refreshed from the response of every assign/delete call. |
| Folder colors | **Pro** | Context menu → **Change Color** opens a palette submenu plus a HEX input. Colors are stored in a single option `fbv_folder_colors[id]` and only tint the folder icon. In Lite the menu item is disabled with a PRO badge. **[source]**/**[docs]** | The endpoint `POST update-folder-color` has **no license check** **[source]**. Each theme has a default icon color: default `#8f8f8f`, windows `#F3C73E`, dropbox `#88C1FC`. |
| Folder icons | — | One fixed folder glyph per theme, with no custom icons or emoji. **[source]** | Opportunity. |
| Search/filter folders | Free | Search input at the top of the sidebar ("Enter folder name..."), debounced 1 s, with a clear "×". By default it filters the tree client-side and auto-expands matches. An optional setting, "Enable searching for folder names using API", makes `get-folders?search=` do it server-side for large trees. **[source]** | — |
| Sidebar resize | Free | A drag handle on the right edge, min **300 px**, max **650 px**. The width is persisted in `localStorage['filebird-sidebar-width']`. On resize-stop the WP grid re-flows its columns (`attachments.setColumns()`). **[source]** In the media *modal* the sidebar is a fixed width and cannot be resized **[source]**. | This matches our planned constant-width, drag-resizable column. Smooth resizing was added in 6.2.3 **[docs]**. |
| Sidebar collapse | Free | A button on the handle (tooltip "Collapse"/"Expand", `aria-expanded`, `aria-controls="filebird-tree"`) toggles the width between 0 and the stored width, with a 0.2 s width transition. **[source]** | — |
| Sticky behaviour | Free | The sidebar sits beside the WP grid, and its tree scrolls independently. **[assumption]** based on the CSS layout; not verified in a browser. | We should make the folder column sticky with its own scroll. |
| Toolbar | Free | Two buttons:<br>• **New Folder** (primary button);<br>• a **⋯ menu**, sub-items listed below. **[source]** | — |
| ⋯ menu | Free, with Pro items | • **Sort Folders** (Pro, disabled in Lite)<br>• **Sort Files** (Pro, disabled)<br>• **Count** (Free)<br>• **Bulk Select**<br>• **Settings**<br>• **Display/Hide folder ID** **[source]** | — |
| Themes | **Pro** (preview only in Lite) | **Default**, **Windows** (Windows 11 look) and **Dropbox**. These change icon sizes, hover and selected backgrounds, button style and icon color. Saved per user (`fbv_theme` user meta). In Lite the picker previews a theme but saving needs a license. **[source]** `admin.tsx` (`needActive`) / **[docs]** | No "Google Drive" theme exists, although FileBird Cloud (a separate add-on) can *connect* Google Drive. |
| Display folder ID | Free | Toggles a `#123` prefix on each node, for use with the shortcode, API and gallery. **[source]** | Useful for power users. |
| Breadcrumb | Free | Setting "Show breadcrumb" injects `#fbv-breadcrumb` under the WP media toolbar on `upload.php` and shows the path of the selected folder. **[source]** | — |
| Startup folder | Free | Setting "Select a default startup folder": All Files, Uncategorized, a specific folder, or **Previous folder selected** (remember the last one, stored in `fbv_folder_startup`). **[source]** | We would store this in localStorage/settings. |
| Empty state | Free | "Add your first folder" with an "Add Folder" call to action. Admin notice "Create your first folder for media library now." **[source]** | — |
| RTL | Free | Fully mirrored, including the arrow keys. **[source]** | — |
| Accessibility | Free | WCAG pass in 6.4.9 and 6.5.9 **[docs]**:<br>• tree keyboard navigation (↑ ↓ Home End ← → Enter Space);<br>• Shift+F10 / ContextMenu key opens the menu;<br>• focus is restored after dialogs;<br>• aria-labels throughout. **[source]** | — |

## 2. Folder operations

| Feature | Free/Pro | Details | Notes |
|---|---|---|---|
| Create | Free | **New Folder** in the toolbar creates the folder under the *selected* folder (or the root). The context menu's **New Folder** creates a child. An inline input appears in the tree ("Folder name..."): Enter saves, Esc cancels. A duplicate name in the same parent is auto-suffixed (6.5.2+, `findUniqueFolderName`). Max 200 characters. **[source]**/**[docs]** | `POST new-folder {name, parent}` |
| Bulk-create folders | **Pro** | Listed in the comparison table **[docs]**. The free code has no UI for it. HappyFiles uses comma-separated names for the same thing. | Cheap win: "a, b, c" creates three folders. |
| Rename | Free | Context menu → **Rename**, or **double-click** (6.5.0+), opens an inline edit. Enter saves, Esc cancels. Only one folder can be edited at a time ("You are editing another folder! Please complete the task first!"). **[source]**/**[docs]** | `POST update-folder`. No F2 shortcut. |
| Delete | Free | Context menu → **Delete** opens a confirm popover: "Are you sure you want to delete this folder? Those files will be moved to **Uncategorized** folder." Deletion is **recursive**: the whole subtree goes, along with its relation rows and colors. Files are never deleted. If the selected folder was deleted, the view switches to Uncategorized. **[source]** `Folder::_delete` | `POST delete-folder {ids[]}` |
| Bulk delete folders | Free | ⋯ → **Bulk Select** turns on tree checkboxes (`checkStrictly`, so parent and child are independent) and shows a delete action. **[source]**/**[docs]** | Delete is the only bulk action. |
| Move/reparent with DnD | Free | Drag a folder onto another folder to nest it, or between nodes to reorder (rc-tree drop indicator). Dragging a folder into its own descendant is rejected server-side (`isSelfOrDescendant`). **[source]**/**[docs]** | `POST update-folder-ord {id, parent, …}` |
| Reorder (custom order) | Free | Drag between siblings. The order is persisted in the `ord` column. **[source]** | Manual order is the default. |
| Sort folders | **Pro** in the UI | Name ascending, name descending, or **Default** (reset to manual `ord`). Natural sort. Persisted per user (`fbv_folder_sort`). In Lite the menu item is disabled. **[source]** | The server honours `get-folders?orderby=name&order=asc` with **no license check** **[source]**. "Two ways to sort folders" **[docs]**. |
| Context menu | Free, with Pro items | • **New Folder**<br>• (separator)<br>• **Rename**<br>• **Cut**<br>• **Paste** (disabled if nothing has been cut, or if you are on the folder that was cut)<br>• **Delete**<br>• **Change Color ▸** (Pro)<br>• **Download** (Pro; ZIP) **[source]** | Cut/Paste exists only in media mode, not for post types. |
| Cut/Paste | Free | Cut marks a folder; Paste on a target reparents it as that target's child (`f(target, cut, 0, 0)`). Copying is not possible. **[source]** | Keyboard-free alternative to DnD. |
| Duplicate folder | — | Not in FileBird. Premio Pro has it **[docs]**. | Not very meaningful when a file can only be in one folder. |
| Multi-select folders | Free (delete only) | Bulk Select checkboxes; see above. **[source]** | — |
| Keyboard shortcuts | Partial | Tree navigation keys, Enter or Space to select, Shift+F10 for the menu, Enter/Esc while editing. **No** shortcuts for Delete, F2, Ctrl+X/V or creating a folder. **[source]** | Premio advertises keyboard shortcuts for create, rename, duplicate and reorder **[docs]**. |
| Undo | — | None. Backups give a coarse restore (see §4). **[source]** | Premio has undo **[docs]**. |
| Download folder as ZIP | **Pro** | Context menu → **Download** shows "Generating download link..." and then opens the ZIP, which includes subfolders. **[source]**/**[docs]** | We could build the ZIP ourselves on the server, by fetching the files from WP. |

## 3. Media ↔ folder

| Feature | Free/Pro | Details | Notes |
|---|---|---|---|
| Drag one or many files to a folder | Free | In grid mode, a jQuery-UI draggable sits on each attachment. With several items selected (WP bulk-select mode) they are all dragged. The drag helper reads "**Move N items**" and the drop target highlights. Pseudo-folder Uncategorized also accepts drops. List mode (`upload.php?mode=list`) has a drag handle per row, and checked rows are dragged together. **[source]** | `POST assign-folder {folder, ids[]}`, which replaces the file's existing folder. |
| "Move N items" flow (touch) | Free | Added in 6.5.8 for touch devices **[docs]**:<br>• a floating pill button appears when items are selected;<br>• tapping it enters *move mode*, where tree DnD is disabled and tapping a folder picks the target;<br>• a bottom bar shows **Cancel** and **Move here**, plus hints such as "Select a destination folder", "Already in this folder" or "All Files is not a folder". **[source]** | A good pattern to copy for keyboard and mobile users as well. |
| Bulk move from the WP bulk-select toolbar | Free | Uses WP's own bulk-select mode together with drag or the Move flow. There is no "Move to…" dropdown in the WP toolbar. **[source]** | Premio has a dropdown "move to folder" **[docs]**. |
| Remove from folder | Free | Drag the file to **Uncategorized**, or set its folder to Uncategorized in the details pane. **[source]** | — |
| Show a file's folder | Free | The attachment details sidebar and modal have a "**FileBird folder:**" read-only field ("Click on the folder name to move this file to another folder"). Clicking it opens a folder picker. **[source]** `Core::attachment_fields_to_edit` | The file-location feature in the docs **[docs]**. Our details panel should show the folder and allow changing it. |
| Upload into the current folder | Free | Uploads made in the media library go into the **selected folder**: `multipart_params.fbv` is set on the plupload `BeforeUpload`. The Upload New Media page (`media-new.php`) has a "Choose folder:" selector with All Files, Uncategorized, **Most recent folder** and a flat tree (6.4.2+ auto-selects the previous folder). **[source]**/**[docs]** | Our uploader already has a FileBird folder picker. |
| Upload a local folder tree | Free | Dragging a **directory** from the OS into the grid recreates its subfolder structure. `fbv=<parentId>/<sub>/<sub>` triggers `newOrGet` per path segment (filter `fbv_auto_create_folders`). Grid mode only. **[source]**/**[docs]** | Strong feature for our uploader: `webkitGetAsEntry` with a path, then create the folders and assign. |
| Upload progress panel | Free | A floating panel with a title bar ("Uploaded: x / y", "Less than a min"), per-file rows with spinners, "Total size", and minimize/maximize. **[source]** | Our uploader already exceeds this. |
| Edited images inherit the folder | Free | Images saved from the WP image editor as a new attachment keep the folder. **[source]** | — |
| Sort files (global per user) | **Pro** in the UI | ⋯ → **Sort Files** offers ascending/descending for **Name** (title), **Date**, **Modified**, **Author**, **Title** and **Size** (`fb_filesize`), plus a **Default** reset. Settings has "**Auto sort files by:**" for the default. The choice is stored per user (`_njt_fbv_default_sort_files`), **not per folder**. **[source]** | "10 ways to sort files" **[docs]** is 5 fields × 2 directions. |
| Sort by size | Free (data) / Pro (menu) | `fb_filesize` post meta is written on upload. Settings → Tools → "Generate attachment size" backfills existing files. List mode gets a sortable **File Size** column in Free. **[source]** | We can sort by size client-side from `media_details.filesize`. |
| Per-folder sort | — | Not present; the sort is global per user. **[source]** | Real Media Library has per-folder order and drag-to-reorder files **[docs]**. |
| Count updates | Free | Every assign, delete or upload response returns fresh `attachmentsCount` {display, actual}, and the store updates in place without a full reload. **[source]** | — |
| Multiple folders per file | — | **Impossible by design**: one folder per file per owner. **[source]** `Folder::assignFolder` | Competitors support it. We are bound by FileBird's data model if we keep using it. |

## 4. Integration points and settings

| Feature | Free/Pro | Details | Notes |
|---|---|---|---|
| WP Media Library grid | Free | Sidebar plus drag and drop; WP infinite scrolling is forced on (`media_library_infinite_scrolling`). **[source]** | — |
| WP Media Library list mode | Free | A `<select id="filter-by-fbv">` dropdown filter (All Folders, Uncategorized, a flat list), the sidebar, drag handles per row, and a File Size column. **[source]** | — |
| Media modal (block editor) | Free | The sidebar is shown in the "Insert media" modal at a fixed width. **[source]**/**[docs]** | — |
| Page builders | **Pro** (except Gutenberg and free Elementor) | Elementor Pro, Divi 4/5, Beaver, Brizy, Bricks, Oxygen, Avada/Fusion, Thrive, Cornerstone, Tatsu, Themify, Dokan, WPBakery and others. In Lite an upsell "Unlock new features" dialog appears inside the builders. **[source]** `Support/PageBuilders.php` / **[docs]** | Not relevant to our standalone app. |
| FileBird Gallery block | Free | Gutenberg block "FileBird Gallery":<br>• choose folder(s) and sort order;<br>• layout Grid, Masonry or Flex, with columns, "Space Around Image", "Image Min Width" and "Crop Images";<br>• captions, Link To (None/Media File/Attachment Page), and a PhotoSwipe lightbox. **[source]** `blocks/filebird-gallery` | Not needed for us. |
| Document Library | Add-on | A separate plugin (front-end file browser). **[docs]** | Out of scope. |
| Folders for posts/pages/CPTs | Free (one level) / Pro (nested) | A separate tree on `edit.php` screens. Free is limited to one level since 6.5.3 **[docs]**. **[source]** `Addons/PostType` | Out of scope. |
| Per-user folders | Free | Setting "Each user has his own folders?". Every folder query is scoped by `created_by = current_user`, so each user sees only their own tree and counts. The import offers "Common folders", "All folders" or a specific user's tree. **[source]** `ModuleUser` | **Important for us**: we authenticate as one application-password user, so in this mode we only ever see *that* user's tree. |
| Role restrictions | Free | All folder endpoints need `upload_files`; settings and import need `manage_options`. There is no per-role or per-folder ACL. **[source]** | — |
| Import from other plugins | Free | Enhanced Media Library, WP Media Folder, Media Library Folders (Max Foundry), Real Media Library, HappyFiles, Premio Folders and Wicked Folders. A notice "You have some folders created by other media plugins. Would you like to import them?" points to Settings → Import. **[source]** `Controller/Import/*` / **[docs]** | — |
| Export/Import CSV | Free | Export the folder structure plus attachment ids as CSV, with `site` and `color` columns. The import wizard detects the source site and asks:<br>• "This site" (restore the folders *and* the file assignments) or "Another site" (folders only);<br>• Merge ("Keep them") or Replace. **[source]** | — |
| Backups | Free (6.5.9) | Automatic snapshot about every 12 h, before every plugin update and before each import or restore. Keeps the 29 most recent. Supports Backup Now, Restore, and Download as CSV. **[source]** | A nice safety net. Our destructive actions should be backup-aware or undoable. |
| REST API key | Free | Generates a bearer key for the public `filebird/public/v1` API. **[source]** | See the API track. |
| SVG upload | Free | Setting "Allow built-in SVG upload & sanitization". **[source]** | — |
| Cache optimization | Free | Setting "Enable cache optimization". **[source]** | — |
| Clear all data | Free | Deletes every folder; backups are kept. **[source]** | — |
| WPML/Polylang | **Pro** | Per-language folder counts, plus "Sync WPML". **[source]**/**[docs]** | — |
| Settings page layout | — | `admin.php?page=filebird-settings`, with tabs Settings, Tools, Backup & Import, Activation and Document Library. An in-sidebar **Settings** modal (⋯ → Settings) holds the per-user options: startup folder, auto-sort files, theme and breadcrumb. **[source]** | — |

## 5. Free vs Pro

### What Free gets **[docs]**/**[source]**

- Unlimited folders and subfolders. A 10-folder limit string still exists in i18n, but the folder-limit code is gone in 6.x **[source]**.
- DnD, cut/paste, rename and double-click rename.
- Bulk delete, search, counters (both modes), folder ID display and breadcrumb.
- Startup folder, per-user folders, importers, CSV import/export, backups, API key, gallery block, SVG upload and the touch "Move" flow.

### Pro-only

| Pro feature | How Lite handles it |
|---|---|
| Folder colors | UI-disabled in Lite; the server endpoint is ungated **[source]** |
| Sort folders | UI-disabled in Lite; the server honours `orderby` **[source]** |
| Sort files | UI-disabled in Lite; WP's own `orderby` still works |
| Download folder as ZIP | — |
| Themes (Windows 11, Dropbox) | Preview only in Lite |
| Bulk-create folders | — |
| Nested post-type folders | — |
| WooCommerce, classic editor, ACF, 20+ page builders, gallery plugins, Dokan | — |
| WPML/Polylang | — |
| Premium support | — |

### Pricing (ninjateam.org, 2026)

| Billing | 1 site | 5 sites | Unlimited sites |
|---|---|---|---|
| Yearly | $39 | $99 | $199 |
| Lifetime | $99 | $199 | $499 |

30-day refund. **[docs]**

### Upsell surfaces in Lite **[source]**

- PRO badges on disabled menu items.
- An "Unlock new features" or "Do more with FileBird PRO" dialog in page builders ("Turn off for 7 days").
- A review-request nag and a deactivation feedback survey.

## 6. Visual design notes

- **Look.** Native WP admin look in the default theme:
  - primary blue `#2271b1`;
  - grey folder icons `#8f8f8f`;
  - selected row with a light-blue background and `#135e96` text;
  - 32 px row height (`fb-h-8`), a 20 px icon, and the count badge right-aligned.

  **[source]** Tailwind classes in `main.tsx`.
- **Themes.** Windows and Dropbox change the icons (yellow `#F3C73E` and blue `#88C1FC` folders), use square buttons (Dropbox `#0360fe`), and use tighter 17 px icons. **[source]**
- **Components.** Radix-UI context menus, dropdowns and popovers, react-hot-toast style toasts ("Successfully moved", "Successfully deleted!"), and inline confirm popovers rather than modals for delete. **[source]**
- **Search box.** Sits at the top of the tree, with a magnifier icon and a clear button. **[source]**
- **Screenshot captions on wordpress.org:** "Bulk select and move files to a folder", "Sort files to find unused images", "Upload files to a specific folder". **[docs]**

## Competitor standouts

| Plugin | Standout features worth considering |
|---|---|
| **Real Media Library** (devowl) | • Folder *types*: Folder, Collection, Gallery.<br>• **Shortcuts**: Shift+drag puts the same file in another folder with no copy.<br>• **Custom file order**: drag to reorder files inside a folder.<br>• Upload modal with speed and remaining time.<br>• A toolbar instead of only a context menu.<br>• Physical folders via an add-on. **[docs]** |
| **Folders by Premio** | • **Multiple folders per item**.<br>• Keyboard shortcuts for create, rename, duplicate and reorder.<br>• **Undo**.<br>• Replace media, with optional link update.<br>• A dropdown "move to folder" without dragging.<br>• Pro adds **sticky/pinned**, **starred** and **locked** folders, **duplicate folder**, **dynamic folders** (by author, date, size or type), hover details and folder upload. **[docs]** |
| **HappyFiles** (Pro only now) | • **Multiple folders per file**; right-clicking a file lists its folders and opens any of them.<br>• Comma-separated bulk folder creation.<br>• Resizable/hideable sidebar that remembers its size.<br>• SVG support.<br>• Galleries from folders. **[docs]** |
| **WP Media Folder** (JoomUnited) | • **Filters** by type, dimensions, weight and date, plus a remembered sort.<br>• Custom media ordering.<br>• Multiple folders per file.<br>• Two-way cloud sync (Google Drive, Dropbox, OneDrive).<br>• Replace and duplicate media.<br>• Remote video (YouTube, Vimeo) as media.<br>• Hover-enlarge preview. **[docs]** |
| **Media Library Folders** (MaxGalleria) | • **Physical** server folders with link rewriting on move.<br>• Move vs copy.<br>• Rename files.<br>• Regenerate thumbnails.<br>Reviewers call it clunky; a folder must be empty to delete it. **[docs]** |

## Pain points & opportunities

From reviews (wordpress.org, 1–3★ titles) **[docs]** and from code reading **[source]**:

1. **Upsell friction.** Users complain the free version is "useless without PRO", and dislike the ads and "non-stop nags for reviews". *Opportunity:* our app has no tiers. We can show colors and sort folders because the free endpoints accept them. Caveat: this deliberately sidesteps FileBird's UI gating. Pro users are unaffected, and we should decide whether to expose this; recommend making it opt-in or labelling it "works with FileBird data".
2. **Performance with many folders.** Users report it is "clunky (slow)" and "not good when have many folders". The tree is not virtualized, and the whole tree and all counts are fetched in one call. *Opportunity:* a virtualized tree, optimistic updates, and debounced count refresh.
3. **No batch operations beyond delete.** A user complains of "No Batch Options". *Opportunity:* multi-select folders for move, delete and color; a "Move to…" picker for files; and a keyboard-driven move.
4. **Folders "disappear".** Common causes are per-user mode or WPML language scoping. *Opportunity:* show clearly which tree we are viewing (shared vs. user X) and warn when user mode is on.
5. **No undo.** Recursive delete is a single confirm popover, so one mis-click removes a whole subtree. *Opportunity:* show the subtree size in the confirm (for example "Delete 4 folders, 312 files become Uncategorized"), offer undo through a toast, and point to FileBird's backups.
6. **No expand/collapse-all, no F2/Delete/Ctrl+X shortcuts, no per-folder sort, no drag-to-reorder files.** These are cheap UX wins.
7. **Discoverability of drop-a-directory upload.** It is grid-only and lightly documented. *Opportunity:* make it first-class in our uploader, with the structure preview shown before upload.
8. **Settings in the main menu.** Users dislike the admin clutter; this does not apply to our standalone app.

## Parity checklist (for wp-upload)

**Must have (FileBird Free parity)**
- [ ] Two-column layout: a folder column with a constant width, drag-resizable (around 220–650 px), a collapse toggle, and the width remembered.
- [ ] All Files and Uncategorized pseudo-folders with counts. Uncategorized works as a "remove from folder" drop target.
- [ ] Nested tree with expand/collapse, counts per folder, and a direct/recursive count toggle (from `attachmentsCount.display` / `.actual`).
- [ ] Create folders, nested ones included, with inline naming. Rename inline with double-click and a menu entry.
- [ ] Delete with a confirm that explains the recursive subtree delete and that files go to Uncategorized.
- [ ] Reparent and reorder folders by drag and drop, plus cut/paste as a non-DnD alternative.
- [ ] Context menu: New subfolder, Rename, Cut, Paste, Delete. Keyboard access through Shift+F10.
- [ ] Folder search, client-side with auto-expand.
- [ ] Drag one or many selected media onto a folder; "Move N items" helper text.
- [ ] A "Move to…" picker flow for touch and keyboard.
- [ ] Show and change a file's folder in the details panel.
- [ ] Upload into the selected folder (already present in our uploader).
- [ ] Startup folder: last used, All, Uncategorized, or a specific folder.
- [ ] File sorting: name, date, modified, author, size.
- [ ] Breadcrumb for the current folder.
- [ ] Accessible ARIA tree with arrow keys; RTL is not needed.
- [ ] Respect per-user folder mode: tell the user which tree they are seeing.

**Nice to have (Pro parity or better than FileBird)**
- [ ] Folder colors through `update-folder-color` (decision needed, see pain point 1).
- [ ] Sort folders by name or manual order.
- [ ] Download a folder (with subfolders) as a ZIP, built by our server.
- [ ] Drop a local directory tree to recreate its folders and upload into them (FileBird supports `fbv=id/sub/sub`).
- [ ] Bulk-create folders from comma-separated names.
- [ ] Expand/collapse all; keyboard shortcuts (F2, Del, Ctrl+X/V, N for a new folder).
- [ ] Multi-select folders for bulk delete or move.
- [ ] Undo toast for move, rename and delete (re-create on undo, or rely on FileBird's backups).
- [ ] Virtualized tree for large folder counts; optimistic updates.
- [ ] Pinned/starred folders, a recent-folders list (client-side only).
- [ ] Filters by type, date or size, plus a hover/large preview (WP Media Folder style).
- [ ] Theme/skin toggle (light/dark is more relevant to us than Windows/Dropbox).
- [ ] *Not achievable on FileBird's data model:* multiple folders per file, and custom per-folder file order.

## Sources

**FileBird 6.5.9 source** (paths relative to `filebird/`):
- `i18n/languages/filebird.pot`
- `includes/I18n.php` (every UI string key)
- `includes/Classes/Core.php` (enqueue, list filter, upload-to-folder, auto-create subfolders, attachment field)
- `includes/Model/Folder.php` (counting, single-folder assignment, recursive delete, export)
- `includes/Model/UserSettingModel.php`, `includes/Model/SettingModel.php`, `includes/Model/ThemeModel.php`
- `includes/Classes/Tree.php` (folder sort persistence)
- `includes/Controller/FolderController.php` (color endpoint with no license gate)
- `includes/Rest/FolderApi.php`
- `includes/Classes/Modules/ModuleUser.php`
- `includes/Classes/Attachment/AttachmentSize.php`
- `includes/Support/PageBuilders.php`
- `includes/Controller/Import/**`
- `assets/dist/main.tsx-90fdc97c.js` (sidebar, tree, context menu, ⋯ menu, move mode, uploader panel, breadcrumb)
- `assets/dist/admin.tsx-5f63a41d.js` (settings page, themes `needActive`)
- `blocks/filebird-gallery/`

**Web:**
- https://wordpress.org/plugins/filebird/ (features, FAQ, screenshots, changelog)
- https://wordpress.org/support/plugin/filebird/reviews/?filter=1
- https://wordpress.org/support/plugin/filebird/reviews/?filter=3
- https://ninjateam.org/wordpress-media-library-folders/ (Pro features, pricing)
- https://ninjateam.gitbook.io/filebird/llms.txt (docs index)
- https://ninjateam.gitbook.io/filebird/compare-filebird-free-and-pro
- https://ninjateam.gitbook.io/filebird/features/interface/folder-tree-themes
- https://ninjateam.gitbook.io/filebird/features/interface/sidebar
- https://ninjateam.gitbook.io/filebird/features/interface/folder-color
- https://ninjateam.gitbook.io/filebird/features/interface/breadcrumb
- https://ninjateam.gitbook.io/filebird/features/interface/file-count
- https://ninjateam.gitbook.io/filebird/features/filebird-library-left-section/drag-and-drop-function
- https://ninjateam.gitbook.io/filebird/features/filebird-library-left-section/right-click-function
- https://ninjateam.gitbook.io/filebird/features/filebird-library-left-section/bulk-select-folders
- https://ninjateam.gitbook.io/filebird/features/filebird-library-left-section/how-to-upload-folders-and-files
- https://ninjateam.gitbook.io/filebird/features/set-folders-for-different-admin-users
- https://wordpress.org/plugins/folders/ (Premio)
- https://wordpress.org/plugins/real-media-library-lite/
- https://happyfiles.io/
- https://www.joomunited.com/wordpress-products/wp-media-folder
- https://wordpress.org/plugins/media-library-plus/
