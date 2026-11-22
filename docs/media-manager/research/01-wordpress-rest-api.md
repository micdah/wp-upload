# Research track A: WordPress REST API for media

Scope: what core WordPress REST (`/wp/v2/media`, `/batch/v1` and related routes) can and cannot do for a full media-library alternative built on wp-upload: a large grid, a FileBird folder sidebar, and a Lightroom-style detail mode with info and edit panels.

Basis: the WordPress **7.1.5** core source, read only. Paths below are relative to the `wordpress/` root. The official docs are used where they add something. Confidence tags:

- **[source]**: verified in the 7.1.5 code.
- **[docs]**: taken from official documentation or dev notes.
- **[assumption]**: reasoned, but not verified in code or by a test.

Two abbreviations are used for the main files:

- `AC` = `wp-includes/rest-api/endpoints/class-wp-rest-attachments-controller.php`
- `PC` = `wp-includes/rest-api/endpoints/class-wp-rest-posts-controller.php`

---

## Summary

- **Listing is solid; filtering is basic.** `GET /wp/v2/media` returns at most **100 items per page**. It sends `X-WP-Total` and `X-WP-TotalPages` and supports these filters:
  - search over title, caption, description **and the file path**
  - `media_type` and `mime_type`, both accepting arrays since 6.9
  - date ranges on created or modified date
  - author
  - attached or unattached (`parent=0` / `parent_exclude=0`)
  - include and exclude by ID, slug, status
  - any attachment taxonomy that has `show_in_rest`

  It **cannot** filter or sort by file size, dimensions, filename or orientation, and it cannot list the year/month values that exist. **[source]**
- **The item payload is rich.** It includes `media_details` (width, height, filesize, every sub-size with its URL, and `image_meta` with EXIF/IPTC), `alt_text`, raw caption and description (edit context only), `post` (the parent), and author. **7.0 added `filename` and `filesize` fields**; 7.1 added `exif_orientation` and image-encoding hints. The official reference page does not list these yet. **[source]**
- **Writes are limited to metadata.** These fields can be updated: title, caption, description, alt text, parent post, author, date, slug, status, comment status, registered meta and attachment terms. **There is no core way to replace a file.** **[source]**
- **Delete is permanent by default.** `MEDIA_TRASH` defaults to `false`, so `DELETE /wp/v2/media/{id}` without `force=true` returns **501**. With `force=true`, the files and all sub-sizes are deleted. Restoring from trash (when trash is enabled) has no clean REST path. **[source]**
- **Image editing creates a new attachment.** `POST /wp/v2/media/{id}/edit` can crop, rotate and flip, but it always writes a **new attachment** (`*-edited.jpg`, with `post` reset to 0). The original is left untouched. There is no scale/resize and no "restore original". **[source]**
- **Media cannot be batched.** The attachments controller sets `allow_batch = false`. `/batch/v1` only covers posts, pages, terms, users and widgets, takes **at most 25 requests**, and does not allow GET. Bulk actions on media need N parallel single requests from our server. **[source]**
- **"Where is this used?" has no REST answer.** Posts cannot be filtered by `featured_media`. A content search with `search=` is a `LIKE '%…%'` full scan per post type. Only the `post` (uploaded-to) parent is cheap. A companion plugin is the right tool for this. **[source]**
- **Site configuration is mostly invisible over REST.** The REST index lists registered image sizes **only when 7.1 client-side media processing is active** (HTTPS or localhost) and the user can upload. The max upload size and the media settings are not exposed in core REST. **[source]**
- **There is only one WordPress identity.** Every app user acts as the single Application Password user. That user's role decides everything:
  - **Author**: can edit and delete only that user's own media.
  - **Editor or Admin**: can edit and delete all media.

  "Mine" can only mean "uploaded by the app's WP user", and there is no per-app-user attribution without custom meta. **[source]**
- **There is no HTTP caching.** Authenticated responses carry `no-cache` headers and no ETag. Edits made through REST bump `modified`, which allows incremental sync with `modified_after`. **Deletions, sub-size regeneration and FileBird folder moves do not bump it.** **[source]**
- **One upload-related finding:**
  - **Raw-body uploads** (what wp-upload sent at research time; *since #46 it uploads streamed multipart*): WordPress reads the whole request body into PHP memory, so very large files can exceed `memory_limit`. Multipart does not have this problem.
  - **Metadata in the upload request:** title, alt text and the other metadata can go in the same upload request as query-string parameters. **[source]**
- **Possible bug in today's upload (side note, outside this track).** WordPress does not decode a percent-encoded `filename=` in `Content-Disposition`. **[source]** wp-upload sends `encodeURIComponent(name)`. If that reaches WordPress unchanged, `my photo.jpg` would probably be saved as `my20photo.jpg`. This is not tested.

---

## 1. Listing and querying: `GET /wp/v2/media`

### 1.1 Parameters

Parameters come from `WP_REST_Controller::get_collection_params()` (`wp-includes/rest-api/endpoints/class-wp-rest-controller.php:341-368`), then `PC::get_collection_params()` (`PC:2973-3189`), then `AC::get_collection_params()` (`AC:2087-2117`). **[source]**

| Param | Type / values | Maps to (WP_Query) | Notes |
|---|---|---|---|
| `context` | `view` (default), `embed`, `edit` | n/a | `edit` requires `edit_posts` on attachments (PC:160-173) |
| `page` | int ≥ 1, default 1 | `paged` | Out-of-range page → 400 `rest_post_invalid_page_number` (PC:509-515) |
| `per_page` | int **1–100**, default 10 | `posts_per_page` | The hard max is in the schema (controller:352-360) |
| `offset` | int | `offset` | Overrides `page`-based offset |
| `search` | string | `s` | See 1.2 |
| `search_columns` | `post_title`, `post_content`, `post_excerpt` | `search_columns` | Narrows the default columns. The filename match is still added (see 1.2) |
| `search_semantics` | `exact` | `exact` | Drops the `%` wildcards: an exact equality match on the column (PC:349-354, 3046) |
| `orderby` | `author`, `date` (default), `id`, `include`, `modified`, `parent`, `relevance`, `slug`, `include_slugs`, `title` | mapped in PC:1240-1251 | `relevance` requires `search`; `include` requires `include` (PC:217-233). **No orderby for filesize, dimensions, filename or mime type** |
| `order` | `asc`, `desc` (default) | `order` | |
| `media_type` | array of top-level types: `image`, `video`, `audio`, `text`, `application` | `post_mime_type` | Arrays accepted since 6.9. The values come from `get_allowed_mime_types()` for the current user (AC:2190-2205) |
| `mime_type` | array of exact MIME types | `post_mime_type` | Must be an allowed MIME type exactly. **No wildcards** such as `image/*` (AC:376-383). Unknown values are silently dropped |
| `after` / `before` | ISO 8601 | `date_query` on `post_date` | Exclusive bounds (`date_query` default) |
| `modified_after` / `modified_before` | ISO 8601 | `date_query` on `post_modified` | Useful for incremental sync |
| `author` / `author_exclude` | int[] | `author__in` / `author__not_in` | Attachments support `author` (`wp-includes/post.php:119`) |
| `parent` / `parent_exclude` | int[] | `post_parent__in` / `post_parent__not_in` | **`parent=0` gives unattached items; `parent_exclude=0` gives attached ones.** The two are mutually exclusive: WP_Query uses an `elseif` (`wp-includes/class-wp-query.php:2264-2275`) |
| `include` / `exclude` | int[] | `post__in` / `post__not_in` | Combine with `orderby=include` to fetch a known ID set in order |
| `slug` | string[] | `post_name__in` | wp-upload uses this today for duplicate detection |
| `status` | `inherit` (default), `private`, `trash` | `post_status` | Values other than the default require `edit_posts` (PC:3192-3222). `trash` is only populated if `MEDIA_TRASH` is enabled |
| `<tax rest_base>`, `<tax>_exclude`, `tax_relation` | term IDs or `{terms, include_children, operator}` | `tax_query` | Only for taxonomies registered on `attachment` with `show_in_rest` (PC:3232-3330). Core registers none. FileBird does not use a taxonomy (track C) **[assumption]** |
| `_fields` | comma list, nested paths allowed | response filter | Also skips computing top-level fields that were not requested (see §6) |
| `_embed` | bool or list of rels | n/a | For example `_embed=author,wp:attached-to` |

Since 6.9 there is an `https://api.w.org/attached-to` link to the parent post, and it can be embedded (`AC:1692-1712`). **[source]**

### 1.2 What `search` searches

- WP_Query searches `post_title`, `post_excerpt` (the caption) and `post_content` (the description), each with `LIKE '%term%'` (`class-wp-query.php:1433-1540`). **[source]**
- The term is split on spaces, commas and `+`. A leading `-` excludes a term. Terms are ANDed together, and the columns are ORed within a term. **[source]**
- For attachments, REST turns on `wp_allow_query_attachment_by_filename` (AC:390-392). That adds `LEFT JOIN postmeta sq1 ON meta_key='_wp_attached_file'` and ORs `sq1.meta_value LIKE '%term%'` into the search, plus a `GROUP BY ID` (`class-wp-query.php:1525-1527, 2396-2398, 2488-2490`). **So search also matches the stored relative path, such as `2025/05/beach-001.jpg`.** **[source]**
- **Alt text is not searched**, because it is postmeta `_wp_attachment_image_alt`. **EXIF/IPTC keywords are not searched**, because they live in serialized `_wp_attachment_metadata`. **[source]**
- When a search is given without an `orderby`, the default is still `date`, because REST always sets one. `relevance` must be requested explicitly. **[source]** (PC default `date`)

### 1.3 Filters that are not possible in core

| Desired filter | Possible? | Why / workaround |
|---|---|---|
| Year / month (like the admin dropdown) | **Partly** | You can filter a known month with `after=YYYY-MM-01T00:00:00` and `before=<next month>`. You **cannot list which months exist**: the admin runs its own `SELECT DISTINCT YEAR, MONTH` query, and no REST route does this. Options: cheap `HEAD` requests per month (read `X-WP-Total`), or a companion route |
| File size, width/height, megapixels, orientation | **No** | These live in serialized `_wp_attachment_metadata` and cannot be queried. Options: an index in our own server, or a companion plugin that writes scalar meta keys plus a `rest_attachment_query` filter |
| Filename / extension | **Approximate** | `search=.png` LIKE-matches the path. `mime_type` is more exact |
| "Missing alt text" | **No** | Alt text is postmeta that is not exposed as a query param. A companion plugin can add a `meta_query` |
| "Uploaded by app user X" | **No** | All uploads share one WP author (see §8) |
| Unattached | **Yes** | `parent=0` |
| Folder (FileBird) | Not in core | Via the FileBird API, then `include=` (track C) |

### 1.4 Pagination and counting

- `X-WP-Total` and `X-WP-TotalPages` are always set (PC:518-519). `Link: rel=next/prev` headers are also added. **[source]**
- **`HEAD` requests** compute only the IDs and skip meta priming (PC:414-421). This is a cheap way to get counts for badges such as "Unattached (312)" or per-type totals. **[source]**
- Counting uses `SQL_CALC_FOUND_ROWS` / `FOUND_ROWS()` (`class-wp-query.php:3193, 3722`). **[source]**
- **Caveat: in `context=edit`, items the user cannot edit are silently dropped from the page but still counted** (PC:468-477: `check_update_permission` in the loop, then `X-WP-Total` comes from `found_posts`). For an Author-role identity this leaves "holes" in pages. **Use `context=view` for the grid and `context=edit` only for the single-item detail fetch.** **[source]**

---

## 2. Item fields

Built by `PC::prepare_item_for_response` plus `AC::prepare_item_for_response` (AC:1425-1683). Schema at AC:1718-1897. Base post fields come from PC:2403-2800 with the fixed supports list `title, author, comments, revisions, custom-fields, thumbnail` for attachments (PC:2574-2581). **[source]**

| Field | Context | Content |
|---|---|---|
| `id`, `date`, `date_gmt`, `modified`, `modified_gmt`, `slug`, `status`, `type`, `link`, `guid` | view/edit | `guid.raw` is edit only |
| `title` | view/edit/embed | `{raw (edit only), rendered}` |
| `caption` | view/edit/embed | `{raw (edit), rendered}`, which is `post_excerpt` run through `the_excerpt` filters |
| `description` | view/edit | `{raw (edit), rendered}`, which is `post_content` run through **`the_content`** (expensive; see §6) |
| `alt_text` | view/edit/embed | Plain string from `_wp_attachment_image_alt` |
| `author` | view/edit/embed | User ID |
| `post` | view/edit | Parent post ID ("uploaded to"), or `null` |
| `media_type` | view/edit/embed | **Only `image` or `file`.** Video and audio come back as `file`, so the UI must derive the kind from `mime_type` (AC:1459-1461) |
| `mime_type` | view/edit/embed | e.g. `image/jpeg` |
| `source_url` | view/edit/embed | URL of the attached file. **For big images this is the `-scaled` version, not the original upload** |
| `media_details` | view/edit/embed | Raw `wp_get_attachment_metadata()` output, plus a `source_url` per size and a synthetic `sizes.full` (AC:1467-1508). Details below |
| `filename` (7.0+) | view/edit | **Original** file basename. Prefers `wp_get_original_image_path` (AC:2462-2476) |
| `filesize` (7.0+) | view/edit | Bytes, from metadata or `filesize()` on the original (AC:2487-2505) |
| `missing_image_sizes` | edit | Registered sizes with no generated file. PDFs are handled through the fallback sizes (AC:1516-1546) |
| `exif_orientation` (7.1) | edit | 1–8 |
| `image_output_format`, `image_save_progressive`, `image_quality` (7.1) | edit | Encoder hints for client-side processing. **The `image_quality` schema lists every registered size name**, which is a side door to the size names (AC:1849-1874) |
| `featured_media` | view/edit | Poster or cover image for audio/video attachments. Audio cover art embedded in ID3 is extracted automatically (`wp-admin/includes/image.php` around line 600) |
| `comment_status`, `ping_status`, `template`, `meta`, `permalink_template`, `generated_slug`, `class_list` | mixed | `meta` only shows meta registered with `show_in_rest` |
| `_links.self[0].targetHints.allow` (6.7+) | when `_links` is included | **The HTTP methods the current user may use on this item** (GET/POST/PUT/PATCH/DELETE). The UI can use it to grey out edit or delete per item (`wp-includes/rest-api/class-wp-rest-server.php:625-705`) |

### 2.1 `media_details` by type

**Images** (from `wp_create_image_subsizes` / `wp_read_image_metadata`) **[source]**:

- `width`, `height`, `file` (relative path), `filesize`
- `sizes`: `{thumbnail|medium|medium_large|large|1536x1536|2048x2048|<theme sizes>: {file, width, height, mime_type, filesize, source_url}}`
  - REST adds a synthetic `full` entry.
  - **These sizes provide the grid thumbnail and the `srcset` candidates.** There is no ready-made `srcset` string in the REST output; build it from `sizes` **[source]**.
- `image_meta` keys: `aperture`, `credit`, `camera`, `caption`, `created_timestamp`, `copyright`, `focal_length`, `iso`, `shutter_speed`, `title`, `orientation`, `keywords[]`, `alt` (`wp-admin/includes/image.php:845-857`). This is a curated subset. **There is no GPS, lens or exposure-mode data**, unless a plugin adds it through `wp_read_image_metadata`.
- `original_image`: the basename of the untouched upload when the image was scaled down (`big_image_size_threshold`, default **2560 px**) or EXIF-rotated. There is no URL for it. **The original's URL must be built** by swapping the basename of `source_url`. **[source]**
- `parent_image: {attachment_id, file}`: present on images created by `/edit` (AC:1353-1357).
- 7.1 also adds `source_image` (for example a HEIC kept next to its JPEG) and animated-GIF video companions through the sideload/finalize flow (AC:37-72). **[source]**

**PDF:** If Imagick/Ghostscript can render it, WordPress creates a `-pdf.jpg` preview plus `thumbnail`, `medium` and `large` sizes. These show up in `media_details.sizes`, so **PDF thumbnails are available when the host supports it** (`wp-admin/includes/image.php:669-735`). Otherwise `sizes` is empty. **[source]**

**Video / audio:** `wp_read_video_metadata` / `wp_read_audio_metadata` provide `length`, `length_formatted`, `bitrate`, `fileformat`, `dataformat`, `codec`, `sample_rate`, `channels`, `width`/`height` for video, ID3 tags, and `filesize`. **There are no video poster frames**; `featured_media` is set only if one is assigned or ID3 art exists. **[source]** for the reader calls. Exact keys depend on getID3 **[assumption]**.

---

## 3. Writes

### 3.1 Create (upload): `POST /wp/v2/media`

- **Body formats** **[source]**:
  - Multipart, through `$_FILES` (AC:2126-2185).
  - Raw body with `Content-Type` and `Content-Disposition: attachment; filename="…"` (AC:1906-2030). An optional `Content-MD5` check returns 412 on mismatch.
- **The raw body is read fully into PHP memory** (`file_get_contents('php://input')`, `class-wp-rest-server.php:1966-1976`) and then written to a temp file. Large videos therefore cost roughly their file size in PHP memory. Multipart uploads are streamed to a temp file by PHP. **[source]** for the code path; the memory impact is an **[assumption]** that follows from it.
- **The filename is not percent-decoded.** `get_filename_from_disposition` only trims and unquotes (AC:2038-2080), and `filename*=` (RFC 5987) is ignored. `sanitize_file_name` then strips `%` (`wp-includes/formatting.php:2039, 2071`). **[source]**
- **Metadata in the same request.** All schema fields are accepted on create: `title`, `caption`, `description`, `alt_text`, `post`, `author`, `date`, `slug`, `status`, `comment_status`, `meta`, `featured_media` and terms (AC:510-640). With a raw body they can be sent as **query-string params**, because REST merges query and body params **[source]**.
  - Defaults: the title comes from IPTC/EXIF, then from the original filename. The caption and alt text come from IPTC (AC:850-890).
  - Attaching to a post requires `edit_post` on that post (AC:419-426).
- **7.1 create params** (AC:291-345, 519-531). These are always registered, not only when client-side processing is on **[source]**:
  - `generate_sub_sizes=false` skips sub-size generation **and** EXIF rotation **and** big-image scaling. This makes uploads fast, but a later `post-process` call only creates *missing* sizes. It does not scale or rotate the original. **[source]**
  - `convert_format=false` disables output-format conversion, such as automatic JPEG→WebP set by plugins.
  - `url=` makes the server download a public image URL (images only, SSRF-checked, capped at `wp_max_upload_size()`) (AC:654-790).
- **Unsupported image types:** if the server's image editor cannot handle an image MIME type, the upload is refused with `rest_upload_image_type_not_supported`. Exceptions are SVG, still HEIC/HEIF (7.1), and the client-processing case (AC:428-495). **[source]**
- **Failure recovery:** the response always carries an `X-WP-Upload-Attachment-ID` header (AC:617-623). If PHP dies while making sub-sizes, the client should call `post-process` for that ID. This is useful for the existing upload jobs and for the slow-thumbnail problem. **[source]**

### 3.2 Update: `POST|PUT|PATCH /wp/v2/media/{id}`

- **Updatable:** `title`, `caption`, `description`, `alt_text`, `post` (re-attach or detach; parent may not be an attachment or revision, AC:971-978), `author` (needs `edit_others_posts` if it is not yourself, PC:910-916), `date`, `slug`, `status` (see below), `comment_status`, `ping_status`, `meta` (registered keys only), `featured_media`, and attachment taxonomies. **[source]**
- **Read-only:** `source_url`, `media_details`, `mime_type`, `filename`, `filesize`, `media_type`. **There is no file replacement through update.** **[source]**
- **`status`:** the update schema enum is the *non-internal* stati (`publish`, `future`, `draft`, `pending`, `private`; PC:2484). `inherit` and `trash` cannot be set directly. Because `wp_insert_post` forces any attachment status outside `inherit/private/trash/auto-draft` back to `inherit` (`wp-includes/post.php:4705-4707`), setting `status=publish` on a trashed attachment *probably* untrashes it. That is untested, and the leftover `_wp_trash_meta_*` meta stays. **[source]** for the code path; the outcome is an **[assumption]**.
- **Every REST update calls `wp_update_post`, so `modified` is bumped.** That makes `modified_after` usable for incremental sync after REST edits. **[source]** (PC `update_item`)

### 3.3 Delete: `DELETE /wp/v2/media/{id}`

- Trash is supported only if `EMPTY_TRASH_DAYS > 0 && MEDIA_TRASH`. **`MEDIA_TRASH` defaults to `false`** (`wp-includes/default-constants.php:134-136`; PC:1100-1104). This can be changed with the `rest_attachment_trashable` filter.
- Without `force=true` and with trash off, the result is **501 `rest_trash_not_supported`** (PC:1147-1154). **[source]**
- `force=true` calls `wp_delete_post` → `wp_delete_attachment`. That removes:
  - the original file and all sub-sizes, plus edit backups
  - term relationships
  - every `_thumbnail_id` that points to the item, so featured images are silently cleared on the posts that used it (`wp-includes/post.php:6822-6890`).

  The response contains `{deleted: true, previous: {…}}`. **This cannot be undone.** **[source]**
- With `MEDIA_TRASH` enabled (a wp-config constant), `DELETE` without `force` moves the item to trash, and `status=trash` lists trashed items. Restore is awkward (see 3.2). **[source]**

### 3.4 Image edit: `POST /wp/v2/media/{id}/edit` (AC:1086-1376)

- **Input:** `src` (required; must match the attachment's file through `wp_image_file_matches_image_meta`). Then either `modifiers[]` (types `crop` with percentages, `rotate` with any angle in degrees clockwise, `flip` with h/v; 6.9+) or the legacy `rotation`/`x`/`y`/`width`/`height`. 6.9+ also accepts `title`, `caption`, `description`, `post` and `alt_text` for the new item (AC:2269-2455). **[source]**
- **Supported types:** jpeg, png, gif, webp, avif, heic (AC:1107). **[source]**
- **7.1 applies the EXIF orientation first**, so the edit runs in the upright frame. **[source]**
- **Result: always a NEW attachment** (`unset($new_attachment_post->ID)`, AC:1290):
  - The file is named `<name>-edited[-N].<ext>` (AC:1256-1266) and saved in the *current* month's upload folder.
  - Sub-sizes are generated synchronously, and the original's EXIF is merged in.
  - `parent_image` points back to the source.
  - `post` defaults to **0**, so the new item is unattached even when the source was attached.
  - Alt text is copied unless it is overridden.

  The original attachment is untouched. Folder membership (FileBird) is **not** carried over **[assumption]**. **[source]**
- **Not available:** scale/resize, in-place edit (the wp-admin image editor edits in place and keeps `_wp_attachment_backup_sizes`), and "restore original". **[source]**

### 3.5 Post-process: `POST /wp/v2/media/{id}/post-process` (AC:84-102, 1031-1054)

- The only action is `create-image-subsizes`, which calls `wp_update_image_subsizes`. **It only creates sizes that are missing from the metadata** (`wp-admin/includes/image.php:159-189`). It does **not** regenerate sizes that already exist, for example after a theme changed a size's dimensions.
- If the metadata is empty, it rebuilds everything from the original.
- Errors from `wp_update_image_subsizes` are ignored; the endpoint always returns the item.
- Permission: same as update. **[source]**

### 3.6 Sideload and finalize (7.1, conditional)

`POST /wp/v2/media/{id}/sideload` and `/finalize` (AC:115-281, 2752-3470) exist **only when `wp_is_client_side_media_processing_enabled()` is true**. By default that means the request is over HTTPS or to localhost, and the decision can be changed with a filter (`wp-includes/media.php:6580-6593`). **[source]**

- They let a client upload **its own sub-size files** for an existing image or PDF. Each file must be a registered size within its max dimensions, or one of the special sizes `original`, `scaled`, `source_original`, `animated_video` or `animated_video_poster`. `finalize` then writes the metadata after checking that each file name came from a prior sideload. **[source]**
- **Side door 1: replacing the main file.** `image_size=scaled` (no dimension check) replaces the attached file with the uploaded one and keeps the old file as `original_image` (AC:2961-2982, 2683-2686). Combined with sideloading each sub-size, this *could* replace an image's file or regenerate its thumbnails **without a plugin**. Our server would have to produce the derivatives itself (e.g. with `sharp`). This is an off-label use of an endpoint designed for the block editor. **[source]** for the mechanics; it is fragile and untested.
- **Side door 2: listing image sizes.** When this mode is on, the REST index (`GET /wp-json/`) also includes `image_sizes` (name → width, height, crop), `image_size_threshold`, `image_strip_meta` and `image_max_bit_depth` for users with `upload_files` (`class-wp-rest-server.php:1377-1402`). **[source]**

---

## 4. Batch: `POST /batch/v1`

- Defined in `class-wp-rest-server.php:115-150` and `serve_batch_request_v1` at :1741-1880. **[source]**
  - Methods allowed per sub-request: **POST, PUT, PATCH, DELETE. GET is not allowed.**
  - Maximum **25** sub-requests, adjustable with the `rest_get_max_batch_size` filter (:1722-1731).
  - Validation mode is `normal` or `require-all-validate`. The latter means all requests must validate or none run; it is **not transactional** once they execute.
  - The response is a 207 with per-item envelopes.
- **A route is batchable only if it declares `allow_batch['v1']`** (:1795-1806):

| Controller | `allow_batch` |
|---|---|
| Posts (posts, pages, CPTs) | `v1 => true` (PC:48) |
| Terms | `v1 => true` |
| Users | `v1 => true` |
| Widgets | `v1 => true` |
| **Attachments (`/wp/v2/media…`)** | **`false`** (AC:35), which overrides the posts controller |
| Font families / faces | `false` |

- **So bulk edit, delete and re-attach of media cannot be batched.** Our server has to fan out single requests with a concurrency limit, for example 4–8 in parallel, and report progress per item, as `uploadJobs.ts` already does. **[source]**
- A companion plugin could register its own batch-capable route or a dedicated bulk route (see §9).

---

## 5. "Where is this media used?"

| Signal | REST path | Cost / limits |
|---|---|---|
| Uploaded-to parent | `post` field and the `wp:attached-to` link | Free. It shows only where the file was **first uploaded**, not real usage. **[source]** |
| Featured image of posts/pages | **No `featured_media` query param** in PC `get_collection_params` (PC:2973-3189) | You would have to page through every post of every type with `_fields=id,featured_media` and build a reverse index: O(all posts). **[source]** |
| In post content (`wp-image-123` class, block `"id":123`, URL) | `GET /wp/v2/{posts,pages,blocks,…}?search=<filename or wp-image-123>&status=any&context=edit` | A `LIKE '%…%'` scan over title, excerpt and content **per post type**. Searching `wp-image-12` also matches `wp-image-123`, so the result needs client-side verification. Acceptable **on demand for one item** in the detail panel; too expensive for the grid. **[source]** (search mechanics). It also misses shortcodes such as `[gallery ids="…"]`, custom fields (ACF), WooCommerce galleries, widgets, site logo and site icon **[assumption]** |
| Site logo / icon | `GET /wp/v2/settings` (`site_logo`, `site_icon`), admin only | Cheap **[docs]** |

**Conclusion:** a reliable "used in" view needs a companion plugin, or an index built and maintained by our server. Core WordPress does not track usage of media.

---

## 6. Performance at 10k–100k attachments

**What the SQL does** **[source]** for the query shape; the cost estimates are **[assumption]**:

- The default list is `WHERE post_type='attachment' AND post_status='inherit' ORDER BY post_date DESC LIMIT …` with `SQL_CALC_FOUND_ROWS`. The core `type_status_date` index covers this, so it is fast even at 100k rows.
- `mime_type` / `media_type` add `post_mime_type IN (…)`, which is still fine.
- **`search`** adds a LEFT JOIN on postmeta and `LIKE '%x%'` on four columns plus a `GROUP BY`. That is a full scan of attachments and their `_wp_attached_file` rows. Expect hundreds of milliseconds to seconds at 100k, depending on the host. Debounce it and avoid search-as-you-type on every keystroke.
- **Deep `page`/`offset`** pagination makes MySQL walk and discard rows. For a virtualized grid over 100k items, consider a **keyset cursor**: `orderby=date&before=<date of last item>`. `before` is exclusive and has one-second resolution, and bulk uploads share timestamps, so combine it with `exclude=<IDs already seen at that timestamp>`. Alternatively, keep an ID index in our server.
- `orderby=title` sorts on an unindexed `post_title`, which means a filesort. That is acceptable at 100k.

**PHP cost per item** **[source]**:

- `media_details` calls `wp_get_attachment_image_src` per size (AC:1476-1490). Plugins that rewrite URLs (CDNs) hook in here.
- `description.rendered` runs **`the_content`** (blocks, shortcodes, embeds), which can be very expensive. `caption.rendered` runs the excerpt filters.
- `_links` runs **targetHints**, a permission check per link per item.
- **Use `_fields` aggressively.** `get_fields_for_response()` skips computing top-level fields that were not requested, and nested paths trim the payload (`rest_filter_response_fields`, `wp-includes/rest-api.php:953`). A suggested grid projection:

  ```
  _fields=id,date,modified,mime_type,title,alt_text,filename,filesize,author,post,media_details.width,media_details.height,media_details.sizes
  ```

  Note that `media_details` is still computed whole, only trimmed in the output.
- Post meta and author caches are primed per page by WP_Query and by `update_post_author_caches` / `update_post_parent_caches` (PC:461-462).

**Caching**:

- For logged-in (authenticated) requests WordPress sends `nocache` headers (`class-wp-rest-server.php:487`) and has **no ETag or Last-Modified support** in REST. **[source]**
- Caching therefore has to live in our server.
- **Incremental sync** with `modified_after` catches REST/admin edits to post fields. It **misses** the following, so a periodic full ID sweep is needed (`_fields=id`, 100 per page, about 1,000 requests at 100k):
  - deletions
  - sub-size regeneration (meta-only)
  - FileBird folder moves
  - changes made by direct meta writes from plugins

  **[source]** / **[assumption]** for plugin behaviour.
- Page-cache plugins usually bypass authenticated REST **[assumption]**.

---

## 7. Site configuration over REST

| Need | Core REST? | Where / workaround |
|---|---|---|
| Registered image sizes (names + dimensions) | **Only in 7.1 client-processing mode**: `GET /wp-json/` → `image_sizes` (`class-wp-rest-server.php:1377-1384`) | Otherwise: names from the OPTIONS schema `image_quality.properties.sizes.properties` (7.1, AC:1849-1856), or inferred from items' `media_details.sizes`. Dimensions are not available without a plugin. **[source]** |
| Big image threshold (2560) | Same 7.1 conditional index field | n/a |
| Media settings (thumbnail size, `uploads_use_yearmonth_folders`) | **No.** `/wp/v2/settings` exposes only general, writing, reading and discussion options (`wp-includes/option.php:2740-2990`) | Companion plugin **[source]** |
| Max upload size | **No** core REST endpoint. `maxUploadFileSize` exists only in PHP-rendered block-editor settings (`wp-includes/block-editor.php:158-225`) | Companion plugin, or learn it from 413/`rest_upload_*` errors. Reverse proxies (body size) and `post_max_size` also apply. **[source]** / **[assumption]** |
| Allowed MIME types | Indirectly: `OPTIONS /wp/v2/media` → `args.media_type.items.enum` gives the top-level types only | Companion plugin for the full list. **[source]** |

---

## 8. Auth and capabilities (single Application Password identity)

- **Application Passwords** authenticate as one real WP user, with all of that user's capabilities. They are available only over HTTPS or when `WP_ENVIRONMENT_TYPE=local` (`wp-includes/user.php:5155-5157`). There is no per-password scoping in core 7.1. **[source]** **[docs]**
- **Attachments use `capability_type => post` and `create_posts => upload_files`** (`wp-includes/post.php:104-122`). Attachment status is `inherit`, so `map_meta_cap` (`wp-includes/capabilities.php`, `edit_post` and `delete_post` cases) works out as follows **[source]**:
  - own item: `edit_post` needs `edit_posts`; `delete_post` needs `delete_posts`.
  - someone else's item: `edit_post` needs `edit_others_posts`; `delete_post` needs `delete_others_posts`. Private items need the matching `*_private_posts` capability.
- **What each action requires** **[source]**:

| Action | Required |
|---|---|
| List (view context) | Nothing; public, since `inherit` items with no parent are treated as published (PC:1783-1814). Items attached to a private or draft parent follow the parent |
| List or get (edit context) | `edit_posts`, plus per item `edit_post` |
| Upload | `upload_files`, plus `edit_post` on the target parent if `post` is set |
| Update / post-process | `edit_post` on the item |
| Edit image / sideload / finalize | `upload_files` + `edit_post` |
| Delete | `delete_post` on the item |
| Change author | `edit_others_posts` |

| Role (default) | upload | edit/delete own media | edit/delete others' media |
|---|---|---|---|
| Contributor | ✗ | (no uploads) | ✗ |
| Author | ✓ | ✓ | ✗ (items show up in lists but are dropped in edit context; updates return 403) |
| Editor / Admin | ✓ | ✓ | ✓ |

- **Implications of the single identity:**
  - The app's WP user should be an **Editor** for a full media manager. With an Author, all media from other WP users is read-only.
  - "Mine" (`author=<app user>`) means "uploaded via wp-upload, or by that WP user in wp-admin". It never means an individual app user.
  - Per-app-user attribution needs custom meta, which requires `register_post_meta(..., show_in_rest)` in a plugin, or a mapping kept in our server.
  - All edits appear in WordPress as made by one user.
  - `targetHints.allow` can drive per-item UI permissions without the app knowing the role.
  - A leaked Application Password has full rights for that role. Keep it server-side, as today.
- **CORS:** irrelevant while every WordPress call goes through our server. Direct browser-to-WP calls would need WP CORS headers and would expose the credential, so avoid them. Loading **image files** directly from WordPress or a CDN in `<img>` tags is fine: there is no CORS issue for plain display, though canvas pixel access would need CORS. **[assumption]**

---

## 9. Gaps vs. the wp-admin Media Library, and companion-plugin sketches

| WP admin capability | REST core? | Companion mu-plugin sketch (feasibility) |
|---|---|---|
| Regenerate thumbnails (all sizes, after a theme change) | ✗ (`post-process` only fills missing sizes) | `POST /wpu/v1/media/{id}/regenerate`: run `wp_get_original_image_path` → `wp_create_image_subsizes`, then delete orphaned old files. Easy. Long running, so call it per item from our job queue |
| Restore original image (after in-place edits) | ✗ (REST edit never edits in place) | Route that calls `wp_restore_image()` logic from `wp-admin/includes/image-edit.php`. Medium |
| In-place edit (crop/rotate/**scale**) with backups | ✗ (new attachment, no scale) | Wrap `wp_save_image()`. Medium; that function reads `$_REQUEST`, so it needs shimming |
| Replace file, keeping ID and URLs | ✗ | Upload to a temp file → `update_attached_file` → `wp_generate_attachment_metadata`, then delete old files. Medium; must handle URL/extension changes and caches |
| Trash + restore (UI) | Partly: trash needs the `MEDIA_TRASH` constant; no restore | `define('MEDIA_TRASH', true)` in wp-config, plus a restore route calling `wp_untrash_post`. Easy |
| Bulk edit / bulk delete / bulk attach | ✗ (no batch for media) | `POST /wpu/v1/media/bulk` taking `{ids, action, fields}`. Easy |
| Month dropdown (existing year/months) | ✗ | `GET /wpu/v1/media/months` running a `SELECT DISTINCT YEAR(post_date), MONTH(post_date)` query. Trivial |
| Filter/sort by size, dimensions, orientation, missing alt | ✗ | Write scalar meta (`_wpu_w`, `_wpu_h`, `_wpu_bytes`) on `wp_update_attachment_metadata`, plus a backfill, plus `rest_attachment_collection_params` / `rest_attachment_query` to expose `min_width` etc. Medium |
| Search alt text / EXIF keywords | ✗ | Add a `posts_search` / `posts_join` clause for `_wp_attachment_image_alt` (and keywords copied to meta). Medium; watch performance |
| "Used in" / usage report | ✗ | Index `_thumbnail_id`, `wp-image-N` and block `"id":N` on `save_post` into a custom table or meta, exposed as `GET /wpu/v1/media/{id}/usage`. Medium–hard; plugin-specific fields are best effort |
| Attachment pages (view/permalink) | `link` exists. Pages are disabled by default since 6.4 (`wp_attachment_pages_enabled`, `wp-admin/includes/schema.php:562`) | Not needed |
| Image sizes, max upload size, allowed MIME types, media settings | ✗ / conditional | `GET /wpu/v1/media/config` returning `wp_get_registered_image_subsizes()`, `wp_max_upload_size()`, `get_allowed_mime_types()` and the thumbnail options. Trivial |
| Per-app-user attribution | ✗ | `register_post_meta('attachment', '_wpu_uploader', ['show_in_rest' => true, 'auth_callback' => …])`. Trivial |
| Detach / attach | ✓ (`post`) | n/a |

All of these are small: one PHP file, a few hundred lines, with `permission_callback`s that check `upload_files` / `edit_post`. Using a namespace such as `wpu/v1` keeps them separate from core. Some of the wins (regeneration, file replace) could also be done **without** a plugin through the 7.1 sideload side door (§3.6), at a cost in complexity and fragility.

---

## 10. Recent changes relevant to media (6.x–7.1)

| Version | Change | Source |
|---|---|---|
| 6.4 | Attachment pages off by default (`wp_attachment_pages_enabled`) | **[source]** schema.php:562; **[docs]** |
| 6.5 | `featured_media` handling for audio/video attachments | AC:929-965 **[source]** |
| 6.6 | Uploads attached to a post are filed under the post's date (`$time`) | AC:822-830 **[source]** |
| 6.7 | `targetHints.allow` on self links | server.php:660 **[source]** |
| 6.8 | Refuses image types the server editor cannot process (`wp_prevent_unsupported_mime_type_uploads`) | AC:428-495 **[source]** |
| 6.9 | `media_type` / `mime_type` accept arrays; `/edit` gains `flip`, `modifiers` and new-item fields; `wp:attached-to` link | AC:351, 1080, 1687 **[source]** |
| 7.0 | `filename` and `filesize` response fields | AC:2457-2505 **[source]** |
| 7.1 | Client-side media processing: `generate_sub_sizes`, `convert_format`, `url` sideload on create; `/sideload` and `/finalize`; HEIC uploads allowed; index exposes `image_sizes`; `exif_orientation` / `image_quality` / `image_output_format` fields; edit applies EXIF orientation first | AC:44-281, 505, 1081 **[source]**; dev note **[docs]** |

---

## Implications for the media manager

**Easy (core REST through the existing server proxy):**

- Paged grid with type, date range, attached/unattached and author filters.
- Search across title, caption, description and path.
- Counts via `HEAD`.
- Thumbnails and `srcset` from `media_details.sizes`.
- Detail panel with dimensions, file size, filename, EXIF subset, uploaded-to (with `_embed`) and author.
- Editing title, caption, description, alt text, parent, date and slug.
- Permanent delete.
- Crop/rotate/flip "save as new".
- Upload with metadata in one request.
- Per-item permission hints through `targetHints`.

**Needs extra work in our server:**

- **Bulk operations:** fan out with limited concurrency and report progress per item. There is no batch for media.
- **Caching and sync:** an in-server index (IDs, dates, MIME, size, dimensions), refreshed by `modified_after` plus periodic ID sweeps to catch deletions. This also unlocks local sorting and filtering by size or dimensions **without a plugin**, at the cost of an initial crawl (100k / 100 = 1,000 requests).
- **Keyset pagination** for deep scrolling.
- **Original-image URL:** derive it from `source_url` plus `media_details.original_image`.
- **Media kind:** derive "video/audio/document" from `mime_type`.
- **Edit-as-new:** after `/edit`, re-apply the FileBird folder and `post` parent to the new item, and optionally delete or hide the original to make it feel like an in-place edit.
- **Delete safety:** confirmation UI, because delete is permanent unless `MEDIA_TRASH` is set. Warn that featured images using the item are silently cleared.
- **Upload path:** ~~consider multipart instead of a raw body for very large files (PHP memory), and fix the `Content-Disposition` filename encoding~~ — **done in #46** (streamed multipart; fixes both).

**Needs a companion plugin** (or the fragile 7.1 sideload trick):

- regenerate thumbnails, replace file, restore original, in-place edit and scale
- trash restore
- month list
- server-side filtering and sorting by size, dimensions or missing alt
- alt/keyword search
- "used in"
- site media configuration (sizes, max upload, MIME list)
- per-app-user attribution

**Risks:**

- With an **Author-role** WP user the manager is half read-only. Document an **Editor** requirement.
- Search cost at 100k items on weak shared hosting.
- Sub-size generation latency on upload. Note `generate_sub_sizes=false` plus `post-process` skips scaling and rotation, so it is not a free speed-up.
- Plugins that rewrite URLs or formats (CDN, WebP) change `source_url` values.
- The 7.1 sideload routes depend on HTTPS detection and may be absent.
- The official REST docs lag the code, so rely on `OPTIONS /wp/v2/media` and the source.

## Open questions

1. Which WP role will the Application Password user have on real installs? Should the app detect it, for example via `GET /wp/v2/users/me?context=edit` → `roles` and `capabilities`, and adapt the UI?
2. Is a companion mu-plugin acceptable to the project, or must everything work with core plus FileBird only? This decides the regenerate, replace, usage and month-list features.
3. Should the server keep a full local index of the library (enables rich filtering and instant grids, but adds sync complexity), or be a thin live proxy?
4. Is enabling `MEDIA_TRASH` on target sites acceptable, so delete can be soft?
5. Does wp-upload's current `Content-Disposition` encoding actually produce mangled filenames for names with spaces or non-ASCII characters? Needs a quick test against a real site.
6. How does FileBird scope folders for queries (track C)? Is fetching folder membership IDs and then `include=` (≤100 per page) fast enough for large folders?
7. Are the 7.1 client-side processing routes registered for server-to-server calls behind a TLS-terminating proxy, where `is_ssl()` may be false? This decides whether `image_sizes` in the index and `/sideload` can be relied on.

## Sources

**Code** (WordPress 7.1.5, read only; paths relative to `wordpress/`):

- `wp-includes/rest-api/endpoints/class-wp-rest-attachments-controller.php`
- `wp-includes/rest-api/endpoints/class-wp-rest-posts-controller.php`
- `wp-includes/rest-api/endpoints/class-wp-rest-controller.php`
- `wp-includes/rest-api/class-wp-rest-server.php`
- `wp-includes/rest-api.php`
- `wp-includes/class-wp-query.php`
- `wp-includes/post.php`
- `wp-includes/capabilities.php`
- `wp-includes/media.php`
- `wp-includes/option.php`
- `wp-includes/block-editor.php`
- `wp-includes/default-constants.php`
- `wp-includes/user.php`
- `wp-includes/formatting.php`
- `wp-admin/includes/image.php`
- `wp-admin/includes/schema.php`

**Docs:**

- REST reference, Media: https://developer.wordpress.org/rest-api/reference/media/ (does not yet list `filename`, `filesize` or the 7.1 params)
- Global parameters (`_fields`, `_embed`): https://developer.wordpress.org/rest-api/using-the-rest-api/global-parameters/
- Pagination: https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/
- Batch framework (5.6): https://make.wordpress.org/core/2020/11/20/rest-api-batch-framework-in-wordpress-5-6/
- Application Passwords integration guide: https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/
- Roles and capabilities: https://wordpress.org/documentation/article/roles-and-capabilities/
- Client-side media processing in WordPress 7.1 (dev note): https://make.wordpress.org/core/2026/07/22/client-side-media-processing-in-wordpress-7-1/
- Client-side media architecture: https://developer.wordpress.org/block-editor/explanations/architecture/client-side-media-architecture/
