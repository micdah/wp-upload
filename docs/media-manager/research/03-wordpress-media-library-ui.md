# 03 — Inventory of the built-in WordPress Media Library UI

Track C of the media-manager research. Status: research only, no code.
Baseline: **WordPress 7.1.5** source, plus wordpress.org docs, Make/Core posts and Gutenberg issues (as of Nov 2026).

Confidence markers:
- **[source]**: verified in the 7.1.5 source tree. Paths are relative to the `wordpress/` root.
- **[docs]**: taken from official documentation, Make posts or Gutenberg issues.
- **[assumption]**: inferred, or general knowledge not re-verified here.

---

## Summary

- The wp-admin Media Library (`upload.php`) has two modes. The **grid** is a Backbone/underscore single-page app that loads data via `admin-ajax.php?action=query-attachments` in pages of 80, with infinite scroll on by default since 7.1. The **list** is a classic server-rendered `WP_List_Table` with paging, sortable columns and bulk actions. The UI has barely changed since 4.0. 7.0 only reskinned it, and 7.1 changed the infinite-scroll default. **[source]**
- The **Attachment details modal** (grid) is the main editing surface. It has a large preview, prev/next navigation (**Alt+←/→**), and inline fields (alt, title, caption, description, plus artist/album for audio) that **autosave on `change`**. It also shows read-only metadata, a copy-URL button, and links to view, edit more details, download and delete/trash. **[source]**
- The **Image editor** (`image-edit.php` + `image-edit.js`, jQuery and imgAreaSelect) supports crop (with ratio, pixel-size and start-coordinate fields), rotate 90/180, flip, scale-down, and undo/redo (also Ctrl+Z/Ctrl+Y). You can apply changes to *all sizes / thumbnail only / all except thumbnail* and restore the original. Edits keep the attachment ID but write new `-e{timestamp}` files. **[source]**
- The REST `POST /wp/v2/media/{id}/edit` endpoint is **not** equivalent. It creates a **new attachment** from crop/rotate/flip modifiers, and has no "restore original" or "apply to thumbnail only". This matters for us because we only use REST. **[source]**
- **Bulk operations are minimal.** The only bulk action is delete or trash (plus "Attach" in the list's *Unattached* view). There is no bulk metadata editing, no move/organise, and no bulk download. Organisation (folders, tags) is entirely plugin territory (FileBird etc.). **[source]**
- **Core is moving to React/DataViews, but not yet in the admin library.**
  - The 7.1 core bundle already ships a DataViews-based `MediaUploadModal` (grid/table layouts, filters, upload) in `@wordpress/media-utils`. It is gated behind `window.__experimentalDataViewsMediaModal`, a Gutenberg experiment. **[source]**
  - A new block-level **Media Editor modal** (crop/rotate/flip/zoom plus a details sidebar) became the default in Gutenberg 23.3. **[docs]**
  - A DataViews **Media screen** replacing `upload.php` is still R&D (gutenberg#55238, #72735). It is not slated for a release. **[docs]**
- **7.1 adds client-side media processing.** wasm-vips resizes and converts images, and decodes HEIC, in the browser. It ships with new REST routes `/sideload`, `/finalize` and `/post-process`, a `generate_sub_sizes=false` flag, and `convert_format`. It is only enabled in secure contexts and is primarily wired into the block editor. **[source]**
- **Most-cited pain points:**
  - No folders or tags.
  - No "replace file, keep URL" (Trac #20602, open since 2012).
  - Weak bulk editing (alt text especially).
  - The grid can't sort and has only coarse filters.
  - Only one "Uploaded to" parent, and no "where is this used".
  - Native `confirm()` dialogs.
  - Slow on large libraries.
  - Search below 2 characters is ignored. Both admin-ajax and REST `/wp/v2/media?search=` also match the stored file path (corrected during synthesis; see `01-wordpress-rest-api.md` §1.2).
  - Hidden keyboard shortcuts.

  **[source]/[docs]**

---

## 1. Grid mode — `wp-admin/upload.php` (default mode)

| Feature | Where | Details | Notes / pain points |
|---|---|---|---|
| Mode switch | grid / list | `?mode=grid\|list`. The choice is persisted per user in the `media_library_mode` user option. Grid is the default. **[source]** `wp-admin/upload.php:131-138` | Two separate code paths (JS app vs PHP table), so features differ between modes. |
| JS requirement | grid | Without JS, a notice says "grid requires JavaScript, switch to list view". **[source]** `upload.php:235-245` | — |
| Thumbnail tiles | grid | `tmpl-attachment`: square tile, CSS-cropped and centred. Uses the `medium` size, falling back to large, thumbnail, then full. Has an orientation class (`landscape`/`portrait`). Non-images show a poster image if one exists, else a MIME icon, plus the filename. Uploading items show a progress bar inside the tile. **[source]** `wp-includes/media-template.php:605-672`, `wp-includes/js/media-views.js:3273-3293` | Fixed square crop, no aspect-ratio-preserving (justified/masonry) layout. No size slider. Images show no filename or label. |
| Column count | grid | Columns = `round(containerWidth / idealColumnWidth)`, max 12. `idealColumnWidth` defaults to 170px. Recomputed on resize (debounced 50ms). **[source]** `media-views.js:4149-4155, 4027` | No user-controllable thumbnail size. |
| Paging / infinite scroll | grid | Pages of **80** items (`posts_per_page: 80`) via `admin-ajax.php?action=query-attachments`. **Since 7.1 infinite scroll is the default.** Users can opt out under *Profile → "Disable infinite scrolling in the Media Library grid view"*, and the `media_library_infinite_scrolling` filter overrides both. With it off, a **"Load more"** button appears with a "Showing X of Y media items" count and a **"Jump to first loaded item"** button that receives focus. **[source]** `wp-includes/js/media-models.js:1143`, `wp-includes/media.php:5062-5080`, `wp-admin/user-edit.php:380-384`, `media-views.js:4891-4990` | Infinite scroll was off from 5.8 to 7.0 for a11y reasons and is back in 7.1 with an opt-out. There is no "jump to date" and no scroll position restore after a reload. **[docs]** |
| Type filter | grid | Dropdown: *All media items*, then one entry per available MIME group (Images, Audio, Video, Documents, Spreadsheets, Archives…), then *Unattached*, *Mine*, and *Trash* (only if `MEDIA_TRASH` is defined). **[source]** `media-views.js:2680-2745` | Single-select only. You can't combine "Images + Unattached" or "Mine + Video". |
| Date filter | grid | "All dates" plus one entry per month that has uploads. The list of months can be overridden with the `media_library_months_with_files` filter (the query is slow on big sites). **[source]** `media-views.js:2780-2800`, `wp-includes/media.php:5027-5045` | Month granularity only, no date range. |
| Search | grid | `<input type=search>`, debounced **500 ms**, fires only at **≥ 2 characters**, updates live. Admin-ajax enables `wp_allow_query_attachment_by_filename`, so search also matches **file names**, not just title/caption/description. The URL becomes `upload.php?search=term`. **[source]** `media-views.js:8737-8766`, `wp-admin/includes/ajax-actions.php:3108-3110`, `wp-includes/js/media-grid.js:53-58` | **Correction (synthesis check):** REST `/wp/v2/media?search=` *does* enable filename matching. The attachments controller adds `wp_allow_query_attachment_by_filename` whenever `s` is set (`class-wp-rest-attachments-controller.php:388-391`). Alt text and EXIF are still not searched. **[source]** |
| Sorting | grid | **None in the UI.** Always newest first (`orderby=date DESC`). **[source]** `media-views.js:2680-2690` | Common complaint: no sort by name, size or type. |
| Deep links | grid | Backbone router: `?item=ID` opens the details modal, `?item=ID&mode=edit` opens the image editor, `?search=q` runs a search. **[source]** `media-grid.js:53-58, 577, 603` | Filters are not reflected in the URL. |
| Bulk select mode | grid | A **"Bulk select"** toggle switches tiles to toggle-select mode, and **Esc** leaves it. Selection: click to toggle, **Shift+click selects a range**, Ctrl/Cmd+click toggles. Enter or Space on a focused tile toggles or opens it. **[source]** `media-grid.js:896-910`, `media-views.js:3070-3125` | No "select all", no select-by-filter, no selection count in the grid toolbar. |
| Bulk delete / trash | grid | In select mode: **"Delete permanently"**. If `MEDIA_TRASH` is set, the buttons are **"Move to Trash"** + "Delete permanently", and in the Trash view **"Restore"**. Uses native `window.confirm()`. Sends **one AJAX request per item** (`model.destroy()` / `model.save()`). **[source]** `media-views.js:4631-4720`, `wp-includes/media.php:5177-5183` | The only bulk action in grid. No progress indicator, no undo (unless MEDIA_TRASH). `confirm()` dialogs. |
| Upload: "Add Media File" button | grid | Toggles an **inline uploader panel** ("Drop files to upload / or / Select Files", max upload size, suggested dimensions) above the grid. **[source]** `upload.php:216`, `media-template.php:233-326`, `media-grid.js` `addNewClickHandler` | — |
| Upload: drag & drop anywhere | grid | A full-window drop zone, "Drop files to upload" (`tmpl-uploader-window`). Plupload does the upload. New items appear at the top with a progress bar. **[source]** `media-template.php:219-224` | — |
| Upload status / errors | grid | `tmpl-uploader-status`: "Uploading", a progress bar, "n / total – filename", an error list and a "Dismiss errors" button. Errors are shown in a sidebar that appears only when errors exist. **[source]** `media-template.php:348-368`, `media-grid.js` `sidebarVisibility` | Per-file progress only inside tiles. No queue view, no retry. |
| Upload restrictions | grid/modal | "Your browser cannot upload files", "Upload Limit Exceeded" (multisite quota), max file size. HEIC: if the server can't convert, an error is shown (6.7+). **[source]** `media-template.php:243-262`, `wp-includes/media.php:4552-4553, 5870-5880` | — |
| Empty / no results | grid | "No media files found." When searching, a11y speak announces "No media found. Try a different search." Result counts are announced via `wp.a11y.speak`. **[source]** `media-views.js:4482-4513, 4875` | Minimal visual empty state. |
| Sticky toolbar | grid | In select mode the toolbar becomes `fixed` when scrolled past (`fixPosition`). **[source]** `media-grid.js:912-930` | — |
| Help tabs | grid | Overview / Attachment Details help (mentions Alt+arrow navigation). **[source]** `upload.php:176-202` | Keyboard shortcuts are otherwise undiscoverable. |
| Admin notices | both | "Media file updated/attached/detached/permanently deleted/moved to Trash (Undo)/restored". **[source]** `upload.php:16-129` | Trash "Undo" link only works with MEDIA_TRASH. |

## 2. List mode — `upload.php?mode=list` (`WP_Media_List_Table`)

| Feature | Where | Details | Notes / pain points |
|---|---|---|---|
| Columns | list | Checkbox. **File** (60×60 thumb, title linked to the Edit screen, media states, filename below). **Author** (link filters by author). Taxonomy columns (any taxonomy registered for attachments with `show_admin_column`). **Uploaded to** (parent title + date, with Attach/Detach links). **Comments** (only if supported). **Date** (relative "x ago" if < 24h, else Y/m/d). **[source]** `wp-admin/includes/class-wp-media-list-table.php:364-412, 473-660` | No file size, dimensions, MIME or alt-text column in core. Plugins add columns via `manage_media_columns`. |
| Sorting | list | Sortable: File (title), Author, Uploaded to (parent), Comments, Date (default DESC). **[source]** `class-wp-media-list-table.php:429-435` | No sort by size or type. |
| Row actions (hover) | list | **Edit** · **Delete Permanently** (or **Trash/Restore** with MEDIA_TRASH) · **View** · **Copy URL** (with "Copied!") · **Download file** · **Attach** (unattached only). **[source]** `class-wp-media-list-table.php:802-920` | Hover-revealed. |
| Bulk actions | list | **Delete permanently**, or with MEDIA_TRASH: **Move to Trash** / **Restore** + **Delete permanently** in Trash. **Attach** in the *Unattached* view. *Empty Trash* button. Extensible via `bulk_actions-upload` / `handle_bulk_actions-upload`. **[source]** `class-wp-media-list-table.php:203-221, 231-254`, `upload.php:256-350` | Server round-trip and full reload. |
| Filters | list | Same type dropdown (All / MIME groups / Unattached / Mine / Trash), month dropdown, "Filter" submit button. `restrict_manage_posts` hook (FileBird and others inject their folder dropdown here). **[source]** `class-wp-media-list-table.php:148-197, 231-254, 301-358` | Not live. Needs a click on "Filter". |
| Search | list | "Search Media" input + submit (filename-aware). **[source]** `class-wp-media-list-table.php:341-356`, `wp-admin/includes/post.php:1395` | — |
| Pagination | list | Standard WP pagination (first/prev/page box/next/last). Per page is set via Screen Options (default 20). **[source]** `upload.php:364` (`add_screen_option('per_page')`); default 20 **[assumption]** | — |
| Screen options | list | Show/hide columns, items per page. **[source]/[docs]** | — |
| Attach dialog | list | "Find Posts or Pages" modal (`find_posts_div()`): search content and attach. **[source]** `upload.php:460` | The only core UI to attach existing media to a post. One parent per attachment. |
| Shift-click checkbox range | list | Standard list-table behaviour (Shift+click on a header checkbox inverts the selection, per the docs). **[docs]** | — |

## 3. Attachment details modal (grid → click a tile)

Frame: `MediaFrame.EditAttachments` with template `tmpl-edit-attachment-frame`, body `tmpl-attachment-details-two-column`. **[source]** `media-template.php:370-603`, `media-grid.js` (EditAttachments)

| Feature | Where | Details | Notes / pain points |
|---|---|---|---|
| Layout | modal | Two columns: preview (left) and info + settings (right). Header has ‹ › buttons and a close (×) button. Title "Attachment details". **[source]** `media-template.php:370-380` | Fixed layout, no resizable or toggleable panels. On narrow screens the columns stack **[assumption]**. |
| Preview | modal | Images use **`sizes.full.url`** (falls back to large, then icon). Audio uses a MediaElement `<audio>` player. Video uses `<video controls preload=metadata>` with a poster if present. PDF shows the generated preview image plus a "Document Preview" label. Other files show a MIME icon. **[source]** `media-template.php:395-440` | Loads the full-size image (can be several MB). No zoom/pan, no 1:1, no compare. |
| Prev / next | modal | Buttons, plus **Alt+← / Alt+→**. Plain arrows were dropped to avoid clashing with screen readers. Disabled while focus is in an input/textarea/select. On navigate, a11y speak says "Viewing media item: %s" and the URL updates to `?item=ID`. **[source]** `media-grid.js:690-717, 466` | wordpress.org docs still say plain ←/→. Only navigates within *loaded* items. |
| "Edit Image" button | modal | For images where the user can save: opens the image editor inside the modal (`?item=ID&mode=edit`). **[source]** `media-template.php:442-446`, `media-grid.js:603` | — |
| Save status | modal | `role=status` "Saved." with a spinner. **[source]** `media-template.php:451-455` | — |
| Read-only metadata | modal | Uploaded on · Uploaded by (linked) · Uploaded to (linked) · File name · File type (MIME) · File size · Dimensions (images) · **Original image** link (if `-scaled`) · Length (audio/video) · Bitrate (audio) · **Used as** (media states, e.g. Site Icon, Header image) · `compat.meta` (plugin-provided). **[source]** `media-template.php:456-525` | No EXIF/IPTC display (camera, lens, ISO, exposure, GPS), no registered sub-sizes list, no "used in posts" list. |
| Editable fields | modal | **Alternative Text** (images, with W3C decision-tree help link) · **Title** · **Artist** / **Album** (audio) · **Caption** (labelled "Image Caption", or "Short Description" for non-images) · **Description**. Fields are `readonly` without edit capability. Extra plugin fields go in `.attachment-compat` (`attachment_fields_to_edit`). **[source]** `media-template.php:527-570` | Plain textareas, no rich text, no spell/AI assist, no character guidance. |
| Autosave | modal | `change [data-setting]` triggers `updateSetting()`, then `model.save(setting, value)` via admin-ajax `save-attachment`. Saving happens on **blur/change**, not on each keystroke. Concurrent requests are aggregated for the "Saved." indicator. Compat fields are saved via `saveCompat`. **[source]** `media-views.js:3305-3345, 2548` | No explicit Save, no undo, no dirty indicator. Navigating away mid-typing relies on the `change` event firing. |
| File URL + copy | modal | Read-only URL input + "Copy URL to clipboard" (Clipboard.js) + "Copied!" and a11y speak "The file URL has been copied to your clipboard". **[source]** `media-template.php:571-578`, `media-views.js:3568` | — |
| Action links | modal | **View attachment page** (or "View media file" if attachment pages are disabled, the default for new sites since 6.4 **[assumption]**) · **Edit more details** (→ `post.php?post=ID&action=edit`) · **Download file** (`download` attr) · **Delete permanently** (`confirm()`) or **Move to Trash / Restore from Trash** with MEDIA_TRASH. **[source]** `media-template.php:581-602`, `media-views.js:3656-3730` | — |
| Focus mgmt | modal | Tab is constrained in the modal. Shift+Tab from the first tabbable is handled. Focus returns to the tile on close. Esc closes. **[source]** `media-views.js:3754-3770, 5764-5840` | — |

## 4. Edit Media screen — `post.php?post=ID&action=edit` (attachment)

| Feature | Where | Details | Notes / pain points |
|---|---|---|---|
| Title + permalink | edit screen | Standard post title field. **[source]** `wp-admin/edit-form-advanced.php` | — |
| Preview + "Edit Image" | edit screen | Image preview (with an "Edit Image" button that opens the inline image editor), or an audio/video shortcode player. **[source]** `wp-admin/includes/media.php:3139-3230` | — |
| Fields | edit screen | Alternative Text · Caption ("Image Caption"/"Short Description") · **Description** in `wp_editor` with Quicktags (TinyMCE off unless the `activate_tinymce_for_media_description` filter is used). Audio/video note "Displayed on attachment pages". Compat fields via `get_compat_media_markup`. **[source]** `media.php:3250-3325` | Requires an explicit **Update** (no autosave). |
| Save meta box | edit screen | "Uploaded on", "Uploaded by", "Uploaded to", File URL + Copy, Download file, File name, File type, File size, Dimensions, Length/Bitrate (audio/video, extendable via `media_submitbox_misc_sections`). **Update** button + **Delete permanently / Move to Trash**. **[source]** `media.php:3333-3480`, `wp-admin/includes/meta-boxes.php:420-480` | — |
| Other meta boxes | edit screen | Slug, Author, Discussion/Comments, taxonomy boxes if registered, featured image for audio/video if supported. **[source]** `edit-form-advanced.php:80-85` | — |

## 5. Image editor — `wp-admin/includes/image-edit.php` + `wp-admin/js/image-edit.js`

Used in both the grid modal (`EditImage.Details`) and the Edit Media screen. Server-side processing via `admin-ajax.php?action=image-editor`, with previews streamed from the server. **[source]**

| Feature | Details | Notes / pain points |
|---|---|---|
| Toolbar | **Crop** · **Image Rotation** popup (Rotate 90° left, 90° right, 180°) · **Flip** popup (vertical/horizontal) · **Undo** · **Redo** · **Cancel Editing** · **Save Edits**. "Image rotation is not supported by your web host" if GD/Imagick can't do it. **[source]** `image-edit.php:60-101` | Every operation is a server round-trip to regenerate the preview. |
| Crop | imgAreaSelect drag selection. Shift-drag keeps the aspect ratio. Numeric fields: **Aspect ratio** (w:h), **Selection** (w×h px), **Starting coordinates** (x,y). "Apply Crop". Minimum selection = thumbnail size. **[source]** `image-edit.php:198-280`, `image-edit.js:941-1030, 1358-1470` | No preset ratios (1:1, 4:3, 16:9), no rule-of-thirds overlay, no straighten. |
| Scale | "Scale Image": original dimensions, new width/height (linked proportionally), **down-scale only** ("Images cannot be scaled to a size larger than the original"). Help text recommends scaling before crop. **[source]** `image-edit.php:126-170, 951` | — |
| Undo / redo | Buttons + **Ctrl+Z / Ctrl+Y** (keypress). The history is the list of operations replayed server-side. **[source]** `image-edit.js:155-170` | — |
| Apply changes to | Radio: **All image sizes** / **Thumbnail** / **All sizes except thumbnail**, with a "Current thumbnail" preview. **[source]** `image-edit.php:288-322` | Unique WP concept. Lets you art-direct the thumbnail crop. |
| Restore original | "Restore original image": discards edits and restores from `_wp_attachment_backup_sizes` ("Previously edited copies of the image will not be deleted"). **[source]** `image-edit.php:178-190`, `image-edit.php:815-905` | Leaves orphaned `-e…` files unless `IMAGE_EDIT_OVERWRITE` is set. |
| File naming | Saved edits write `name-e{timestamp}.ext` plus new sub-sizes. Backups are stored as `full-orig` / `full-{suffix}`. The attachment **ID stays the same**, the URL changes. **[source]** `image-edit.php:1000-1100` | URLs embedded in posts keep pointing at old files (still present). |
| Unsaved-changes guard | "There are unsaved changes that will be lost…" confirm. **[source]** `image-edit.php:334` | — |
| Big images / `-scaled` | On upload, images larger than **2560px** (`big_image_size_threshold`) are downscaled to `name-scaled.ext`, which becomes the "full" size. The original is kept and exposed as `original_image` ("Original image:" link in the modal). **[source]** `wp-admin/includes/image.php:285-345`, `media-template.php:494-500` | Our full-size preview / lightbox should decide between `-scaled` and the original. |
| EXIF orientation | Rotated on upload (`wp_image_maybe_exif_rotate`). The REST `/edit` endpoint applies EXIF orientation since 7.1. **[source]** REST controller `:1081` | — |
| REST equivalent | `POST /wp/v2/media/{id}/edit` with `src` + `modifiers[]` (crop / rotate / flip since 6.9) → **creates a NEW attachment**. No scale, no "thumbnail only", no restore. **[source]** `wp-includes/rest-api/endpoints/class-wp-rest-attachments-controller.php:104-112, 1076-1100, 2269-2300` | **Parity gap for a REST-only app.** In-place editing needs either (a) accepting the new-attachment semantics, (b) client-side processing + upload/replace, or (c) a helper plugin. |

## 6. Media modal in the block editor (brief, different use case)

| Feature | Where | Details | Notes |
|---|---|---|---|
| Legacy `wp.media` frame (default) | block editor modal | Tabs: "Upload files" / "Media Library". Same AttachmentsBrowser as the grid, with filters (All / Uploaded to this post / Images / Unattached / Mine), date filter, search, a details sidebar (`tmpl-attachment-details`) and **Attachment Display Settings** (alignment, link to, size: Thumbnail/Medium/Large/Full with dimensions). Select / Insert button, multi-select for gallery, "Edit Selection", drag-to-reorder gallery, "Reverse order". Featured image uses the same frame in single-select mode. **[source]** `media-template.php:674-1067`, `media-views.js:150-275` | Selection and insert only. Not a management UI. |
| DataViews `MediaUploadModal` (experimental) | block editor modal | Shipped in core 7.1 `@wordpress/media-utils` but only active when `window.__experimentalDataViewsMediaModal` is set (Gutenberg plugin experiment). DataViews grid/table layouts, filter builder ("Add filter", date operators such as "Last 7 days"), sort, density, "Preview size", search, select all, drop-to-upload with snackbars. Fields: Title, Alt text, Caption, Description, Date added/modified, Author, Attached to, File name/size/type, Dimensions. **[source]** `wp-includes/js/dist/media-utils.js:28389` (component), `wp-includes/js/dist/editor.js:89836`, `wp-includes/js/dist/block-editor.js:51683` (gate) | Gutenberg#73085: "still an experiment and hasn't been slated for any particular WP release". To-do: media-type filters (blocked on REST), multi-select UX, metadata sidebar. **[docs]** |
| Media Editor modal | block editor | Replaces the inline Image block cropper (Gutenberg 23.3, PR #78653, default, no flag). Freeform and aspect-ratio crop, fine and snap rotation, flip, zoom/pan, magnified crop canvas, pixel-snapping handles, details tab (author, attached to, alt, caption). **Block-level crop** (does not regenerate the attachment's sub-sizes). **[docs]** | The intended foundation for a future Media Library editor. Restore original and manual pixel crop are out of scope for now. |

## 7. Media types, a11y, mobile, newer features

| Feature | Where | Details | Notes |
|---|---|---|---|
| Audio | modal/edit | MediaElement.js player. Artist/Album editable. Length and bitrate (+ VBR/CBR) shown. Duration and ID3 come from server-side getID3 on upload. **[source]** `media-template.php:409-414, 503-519, 532-544` | No waveform. |
| Video | modal/edit | `<video controls preload=metadata>` with a poster if a featured image is set (needs theme support for `attachment:video` thumbnails). Length shown. **[source]** `media-template.php:415-434`, `edit-form-advanced.php:80-85` | Grid tiles show a generic icon unless a poster exists. No frame-grab poster in core. |
| PDF | grid/modal | On upload, if Imagick/Ghostscript is available, a first-page preview `name-pdf.jpg` plus fallback sizes (thumbnail, medium, large) are generated and used as the tile and preview ("Document Preview"). **[source]** `wp-admin/includes/image.php:669-710`, `media-template.php:444-446` | Depends on server Imagick. No multi-page viewer. |
| Other docs/archives | grid/modal | MIME icon + filename. **[source]** | — |
| HEIC / AVIF / WebP | upload | HEIC converted to JPEG server-side if the editor supports it (6.7). AVIF supported (6.5). 7.1 client-side processing can decode HEIC in the browser. **[source]** `wp-admin/includes/image.php:573-586`, `wp-includes/js/dist/upload-media.js` | — |
| Client-side media processing (7.1) | block editor uploads | `wp_is_client_side_media_processing_enabled()` (secure context only, filter `wp_client_side_media_processing_enabled`). Uses wasm-vips (`script-modules/vips`, ~13 MB worker) for resize, format conversion (`convert_format`), rotation and thumbnail generation in the browser. Sub-sizes go via `POST /wp/v2/media/{id}/sideload`, then `/finalize`. `generate_sub_sizes=false` on create. There is also a `video-conversion` script module. Requires cross-origin isolation (COOP/COEP or Document-Isolation-Policy on Chromium ≥137). **[source]** `wp-includes/media.php:6580-6612`, REST controller `:84-200, 440-530`, `wp-includes/js/dist/script-modules/{vips,video-conversion}` | **Highly relevant to us.** The same REST routes let an external client generate sub-sizes itself (fast uploads, no server thumbnailing bottleneck). Track this with the REST-API research track. |
| a11y | all | `wp.a11y.speak` for result counts, load-more hints, copy URL, item navigation. Screen-reader labels on all icon buttons. `role=dialog`. Arrow-key **roving focus in the grid** (←→↑↓ move by row/column). Alt+arrows in the modal. W3C alt-text decision-tree link. **[source]** `media-views.js:4080-4125, 4482-4513, 3568`, `media-grid.js:466, 690-717` | Good baseline to match. |
| Mobile | grid/modal | Column count adapts to width (min 1). On small screens the media frame menu collapses behind a "Menu" toggle. The modal is full-screen on small viewports. Upload uses the native file picker (camera roll). **[source]** `media-template.php:180-200` (menu toggle); full-screen modal **[assumption]** | No touch gestures (swipe prev/next, pinch zoom). Hover-only row actions in the list are awkward on touch. |
| 7.0 admin refresh | both | 7.0 reskinned admin chrome. Trac #65697 (7.1) fixes inconsistent top-bar spacing between list and grid. There was no functional redesign of `upload.php`. **[docs]** | — |
| REST media filters (6.9) | REST | `media_type` / `mime_type` accept arrays. **[source]** REST controller `:351-380` | Lets us build multi-type filters that core's UI can't do. |

---

## Pain points & opportunities

| # | Pain point (core) | Evidence | Opportunity for wp-upload |
|---|---|---|---|
| 1 | **No folders / tags / collections.** Users rely on 30+ folder plugins. | Plugin ecosystem. Make/Core 2023 media post. Gutenberg#55238 i2 / #79779 **[docs]** | Optional FileBird sidebar. Abstract it so core taxonomies can plug in later. |
| 2 | **No "replace file, keep URL".** | Trac #20602 (2012, still open), #43426 **[docs]** | Investigate feasibility via REST (likely needs helper plugin). At minimum, "upload new version + swap references" workflow. |
| 3 | **Bulk ops = delete only.** No bulk alt text, caption, title, attach or move. | `class-wp-media-list-table.php:203-221`, `media-views.js:4631` **[source]** | Multi-select + batch edit panel (Lightroom "sync metadata"). Batch via REST `batch/v1` where possible. |
| 4 | **Grid can't sort.** Filters are single-select and month-granular. | `media-views.js:2680-2800` **[source]** | Sort by date/name/size/dimensions/type. Combinable filters (type × attached × author × date range × folder × "missing alt"). |
| 5 | **Missing alt text is invisible.** | No column/filter in core **[source]** | Badge on tiles + "Missing alt" filter (a11y win, common plugin feature). |
| 6 | **Preview loads full-size image, no zoom.** No EXIF display. | `media-template.php:399-402` **[source]** | Progressive loading (medium → large → full/original), zoom/pan, EXIF/IPTC panel (Lightroom-style info panel). |
| 7 | **Only one "Uploaded to" parent, no usage tracking.** | List table, Make 2023 comments **[docs]** | "Used in" lookup (search post content for the URL/ID), possibly cached. |
| 8 | **Native `confirm()` dialogs, no undo** (unless MEDIA_TRASH). One request per deleted item, no progress. | `media-views.js:3661, 4647-4720` **[source]** | Custom confirm with counts, progress for bulk ops, soft-delete/undo where possible. |
| 9 | **Hidden / changed keyboard shortcuts** (Alt+arrows; docs say plain arrows). | `media-grid.js:690-717` vs docs **[source]/[docs]** | First-class shortcuts (←/→ in loupe, G/E/D views like Lightroom, `?` cheat sheet), a11y-safe (only when focus is not in a field). |
| 10 | **Image editor is server-round-trip, no presets, dated UI.** REST edit creates new attachments. | `image-edit.php`, REST `:1086` **[source]** | Client-side preview (canvas). Preset ratios. Decide semantics (new attachment vs replace). Reuse ideas from the Gutenberg Media Editor modal. |
| 11 | **Search quirks**: ≥ 2 characters, 500ms debounce; no alt-text/EXIF search (REST does match file paths — corrected during synthesis). | `media-views.js:8758-8766`, `ajax-actions.php:3108` **[source]** | Alt-text search via helper or client-side index. Instant search on a cached index. |
| 12 | **Performance on large libraries**: month-dropdown query, 80-per-page AJAX, square-crop tiles of `medium` images. | `media.php:5027-5045`, `media-models.js:1143` **[source]** | Virtualised grid, smaller `thumbnail`/`medium` srcset per tile size, prefetch neighbours in detail view. |
| 13 | **Fixed square tiles, no thumbnail-size control.** | `tmpl-attachment`, `idealColumnWidth=170` **[source]** | Size slider + square/aspect (justified) toggle. |
| 14 | **No bulk download (zip)**. | Gutenberg#55238 comments **[docs]** | Client-side zip of selected originals. |
| 15 | **Upload feedback is minimal** (no queue, no retry, no per-file status list). | `tmpl-uploader-status` **[source]** | We already have an upload flow. Integrate a persistent upload queue panel. |

## Parity checklist for wp-upload's media manager

### Must-have (parity with core)
- [ ] Grid of all attachments, newest first, with paging/infinite scroll and a total count ("Showing X of Y").
- [ ] Filter by media type (Images, Audio, Video, Documents, Spreadsheets, Archives), **Unattached**, **Mine**, month/date. Trash view if the site uses `MEDIA_TRASH`.
- [ ] Search (title/caption/description and file name — REST supports all four).
- [ ] Multi-select with click, Shift-range and Ctrl/Cmd-toggle. Esc to clear.
- [ ] Bulk delete permanently (and Trash/Restore if MEDIA_TRASH) with confirmation.
- [ ] Upload: button + drag-and-drop anywhere, per-file progress, error list. Max upload size hint.
- [ ] Detail view:
  - [ ] Preview for image, audio player, video player, PDF preview image, icon fallback.
  - [ ] Prev/next with keyboard. Deep link to an item.
  - [ ] Edit alt (images), title, caption, description, artist/album (audio). Autosave with visible "Saved" state.
  - [ ] Read-only metadata: uploaded on/by, uploaded to (link), file name, MIME type, file size, dimensions, original image (`-scaled`), length, bitrate.
  - [ ] File URL + copy to clipboard. View attachment/media page. Open in wp-admin ("Edit more details"). Download. Delete/trash.
- [ ] Attach / detach to a post ("Uploaded to"). Core does this via the list view (via REST: `post` field on the media item).
- [ ] List/table view with columns (thumb, file/title, author, uploaded to, date) and sortable headers. Per-page setting.
- [ ] Image editing at least: crop (free + ratio), rotate 90/180, flip. Define semantics vs REST `/edit` (new attachment) and document it.
- [ ] A11y baseline: screen-reader announcements for result counts/navigation/copy, focus trap and restore in modals, arrow-key grid navigation, labelled icon buttons.
- [ ] Responsive layout (usable on a phone: single/two-column grid, full-screen detail).

### Nice-to-have (beyond core: "much nicer experience")
- [ ] FileBird folder sidebar (optional), drag tiles onto folders.
- [ ] Lightroom-style detail ("loupe") mode: filmstrip, toggleable left/right panels, zoom/pan, 1:1, neighbour prefetch.
- [ ] Thumbnail size slider. Square vs aspect-ratio (justified) grid. Virtualised scrolling.
- [ ] Sorting (name, size, dimensions, type, date). Combinable filters. Date range. "Missing alt text" filter. Filters reflected in the URL.
- [ ] Batch metadata edit (alt/caption/title/description) and "copy metadata from…".
- [ ] EXIF/IPTC/GPS panel. Registered sub-sizes list with dimensions and links.
- [ ] "Used in" (posts referencing the attachment).
- [ ] Bulk download as zip.
- [ ] Better image editor: preset ratios, straighten, live client-side preview, "apply to thumbnail only" and restore original (likely requires a helper plugin; REST lacks both).
- [ ] Client-side sub-size generation using the 7.1 `/sideload` + `/finalize` routes (faster uploads on slow hosts; see `project_wp_processing_latency`).
- [ ] Replace file keeping the URL (needs server support; investigate).
- [ ] Keyboard shortcut cheat sheet, swipe navigation on touch, undo for metadata edits.

---

## Sources

### WordPress 7.1.5 source (paths relative to `wordpress/`)
- `wp-admin/upload.php:16-129` (notices), `:131-138` (mode persistence), `:140-251` (grid bootstrap and help tabs), `:256-350` (list bulk actions), `:364` (per_page screen option), `:460` (find posts dialog)
- `wp-admin/includes/class-wp-media-list-table.php:148-197` (type filter views), `:203-221` (bulk actions), `:231-254` (month dropdown, `restrict_manage_posts`, Empty Trash), `:301-358` (filter bar + search), `:364-412` (columns), `:429-435` (sortable), `:473-530` (File column), `:608-660` (Uploaded to / Attach / Detach), `:802-920` (row actions)
- `wp-includes/media-template.php:155-176` (alt-text help), `:180-200` (media frame + mobile menu toggle), `:203-216` (modal), `:219-326` (uploaders), `:328-346` (view switcher), `:348-368` (upload status), `:370-380` (edit-attachment frame), `:381-603` (two-column details), `:605-672` (grid tile), `:674-823` (sidebar details), `:825-951` (selection, display settings)
- `wp-includes/js/media-grid.js:53-58` (routes), `:466` (a11y speak on view), `:577, :603` (item URLs), `:690-717` (Alt+arrow nav), `:896-930` (select mode Esc, sticky toolbar), `:230-260` (DeleteSelected button)
- `wp-includes/js/media-views.js:2680-2800` (filters, DateFilter), `:3070-3125` (selection with shift/ctrl), `:3273-3293` (thumbnail size choice), `:3305-3345` (autosave), `:3568` (copy speak), `:3656-3730` (delete/trash/untrash), `:4080-4125` (grid arrow nav), `:4149-4155` (columns), `:4482-4513` (a11y result counts), `:4631-4720` (bulk delete/trash), `:4891-4990` (load more), `:8737-8766` (search debounce)
- `wp-includes/js/media-models.js:1143` (80 per page)
- `wp-includes/media.php:5027-5045` (months filter), `:5062-5080` (infinite scroll default 7.1), `:5177-5199` (l10n strings), `:4552`, `:5870-5880` (HEIC error), `:6580-6612` (client-side processing gate)
- `wp-admin/user-edit.php:380-384`, `wp-admin/includes/user.php:144` (infinite-scroll opt-out)
- `wp-admin/includes/ajax-actions.php:3060-3110` (query-attachments, filename search)
- `wp-admin/includes/media.php:3139-3330` (Edit Media form), `:3333-3480` (submitbox metadata); `wp-admin/includes/meta-boxes.php:420-480`
- `wp-admin/includes/image-edit.php:60-101` (toolbar), `:126-170` (scale), `:178-190` (restore), `:198-280` (crop), `:288-322` (apply-to target), `:334` (unsaved guard), `:815-905` (restore), `:920-1170` (save, `-e` suffix, backups)
- `wp-admin/js/image-edit.js:155-170` (Ctrl+Z/Y), `:941-1030` (imgAreaSelect), `:1358-1470` (numeric selection, ratio)
- `wp-admin/includes/image.php:285-345` (`big_image_size_threshold`, `-scaled`), `:573-586` (HEIC), `:669-710` (PDF previews)
- `wp-includes/rest-api/endpoints/class-wp-rest-attachments-controller.php:84-200` (post-process, edit, sideload, finalize routes), `:351-380` (array media_type), `:440-530` (generate_sub_sizes), `:1076-1100` (edit creates new attachment), `:2269-2300` (edit args)
- `wp-includes/js/dist/media-utils.js:28389` (MediaUploadModal), `wp-includes/js/dist/editor.js:89836`, `wp-includes/js/dist/block-editor.js:51683` (`__experimentalDataViewsMediaModal` gate), `wp-includes/js/dist/upload-media.js`, `wp-includes/js/dist/script-modules/vips/`, `.../video-conversion/`

### Web
- Media Library screen docs: https://wordpress.org/documentation/article/media-library-screen/
- Edit Media docs: https://wordpress.org/documentation/article/edit-media/
- Infinite scrolling default dev note (7.1): https://make.wordpress.org/core/2026/07/23/media-library-infinite-scrolling-is-now-enabled-by-default-with-a-per-user-opt-out/
- Client-side media processing in 7.1: https://make.wordpress.org/core/2026/07/22/client-side-media-processing-in-wordpress-7-1/ and https://developer.wordpress.org/block-editor/explanations/architecture/client-side-media-architecture/
- WordPress 7.1 Field Guide: https://make.wordpress.org/core/wordpress-7-1-field-guide/
- Media Editor Modal call for testing: https://make.wordpress.org/core/2026/05/21/media-editor-modal-call-for-testing/
- What's new in Gutenberg 23.3: https://make.wordpress.org/core/2026/06/03/whats-new-in-gutenberg-23-3-03-jun/
- Gutenberg 23.5 (crop improvements): https://make.wordpress.org/core/2026/07/01/whats-new-in-gutenberg-23-5-july-1-2026/
- Phase 3 Media Library tracking: https://github.com/WordPress/gutenberg/issues/55238
- DataViews-powered media library: https://github.com/WordPress/gutenberg/issues/72735
- Media interaction in upload/selection modal: https://github.com/WordPress/gutenberg/issues/73085
- Media Editor Modal tracking (7.1): https://github.com/WordPress/gutenberg/issues/73771
- Media editor default PR: https://github.com/WordPress/gutenberg/pull/78653
- Make/Core "Media Library" (Phase 3 goals, 2023): https://make.wordpress.org/core/2023/07/07/media-library/
- DataViews, DataForm et al. in WP 7.0: https://make.wordpress.org/core/2026/03/04/dataviews-dataform-et-al-in-wordpress-7-0/
- Trac #20602 Replace media: https://core.trac.wordpress.org/ticket/20602 ; #43426: https://core.trac.wordpress.org/ticket/43426
- Trac #65697 (7.0 top-bar spacing): https://core.trac.wordpress.org/ticket/65697
- Folder-plugin landscape (pain point evidence): https://wordpress.org/plugins/catfolders/ , https://wordpress.org/plugins/media-library-plus/ , https://wordpress.org/plugins/enhanced-media-library/
