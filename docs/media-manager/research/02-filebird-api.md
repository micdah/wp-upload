# 02 — FileBird API & internals

Research track B for the media-manager initiative. Research only: no stack decisions, no app changes.

Source studied: **FileBird Lite 6.5.9** (`filebird.php:6`, `readme.txt` "Stable tag: 6.5.9", released 2026-10-13), read statically. FileBird Pro source was **not** available; Pro statements come from the readme, the official docs and the Lite UI bundle (which ships the Pro menu entries disabled).
File references are relative to the plugin root (`filebird/`). WordPress core references are relative to the WP 7.1.5 root.

Confidence markers: **[source]** = read in code; **[docs]** = official docs/readme; **[assumption]** = inferred, not verified against a live site.

---

## Summary

- The **public API** (`filebird/public/v1`, Bearer API key) has 6 media routes: list the folder tree (with counts), get one folder, create a folder, assign attachments to a folder, list **all** attachment IDs of a folder, and count a folder. It has **no rename, delete, move/reorder or colour** routes, and no way to look up "which folder is attachment X in". It also never logs a WordPress user in: every call runs as **user 0**. **[source]**
- Public-API errors come back as **HTTP 200 `{success:false, data:{mess:"..."}}`** (from `wp_send_json_error`). Only a bad or missing key returns a real 401 (`rest_forbidden`). Our current `unwrap()` reads `message`/`data` and misses `data.mess`. **[source]**
- FileBird's **internal REST namespace `filebird/v1`** has everything its UI uses: tree with counts and search, create, rename, delete (recursive), move/reorder, colour, bulk assign/unassign, and settings. The permission callbacks are plain `current_user_can('upload_files')` (some need `manage_options`), and **no FileBird-specific nonce** is checked. These routes can therefore be called from our server with the **Application Password** we already use. The catch is that they are undocumented and can change in any release. **[source]**
- **Filtering media by folder only works for `WP_Query` objects that carry an `fbv` query var**, applied in the `posts_clauses` hook. FileBird fills that var only for admin-ajax `query-attachments` (`query[fbv]`) and the `upload.php` list screen. It does **not** hook `rest_attachment_query`, so **`/wp/v2/media?fbv=123` is silently ignored**. **[source]**
- Paging a folder with the public API alone means fetching all IDs (`/attachment-id`) and then calling `/wp/v2/media?include=…` with native sort and paging. Long ID lists can be sent as `POST …?_method=GET` with a JSON body. "Uncategorized" has no ID list at all, only a count. **[source]**
- A **tiny companion mu-plugin** could close most gaps. About 20 lines would forward `fbv` into `rest_attachment_query`, which gives native paging, sort, search and mime filters per folder, including Uncategorized. A `register_rest_field` would add the folder ID to each media item. Optionally it could expose a clean folder-CRUD namespace that wraps FileBird's own model methods.
- The data model is simple and stable (unchanged since v4): `{prefix}fbv` (id, name, parent, type, ord, created_by) plus `{prefix}fbv_attachment_folder` (folder_id, attachment_id). Colours live in the `fbv_folder_colors` option. **[source]**
- **Pro vs Free:** unlimited folders and the API are in both. Pro-only are folder colours in the UI, folder ZIP download, advanced file/folder sorting, themes, and page-builder or multilingual integrations. In Lite 6.5.9 the colour and sort **REST endpoints still work server-side**; only the UI gates them. **[source]**+**[docs]**
- **"Folder per user" mode is a trap for API clients.** FileBird caches `get_current_user_id()` at `plugins_loaded`, before Application-Password auth runs. App-password calls therefore see the shared tree (`created_by=0`) while some checks compare against the real user. Shared mode (the default) is consistent. **[source]** (inference, untested)

---

## 1. Public REST API — `wp-json/filebird/public/v1`

Registered in `includes/Rest/PublicApi.php:11-161`; the handlers are in `includes/Controller/Api.php`.

### 1.1 Authentication

```php
// includes/Rest/PublicApi.php:198-208
public function permission_callback( $request ) {
    $key = get_option( 'fbv_rest_api_key', '' );
    if ( \strlen( $key ) !== 40 ) {
        return false;
    }
    $token = $this->getBearerToken();
    return is_string( $token ) && hash_equals( $key, $token );
}
```

- The key is one site-wide 40-character random string in the option `fbv_rest_api_key`. **[source]**
- The key is read **only from the `Authorization: Bearer …` header**. Query-string tokens were removed on purpose (`PublicApi.php:184-186`). **[source]**
- The key is generated (or rotated) via `POST filebird/v1/fbv-api` with `act=generate-key`. That route needs `upload_files && manage_options` (`PublicApi.php:14-22, 194-196`; `Api.php:11-24`). An **admin** Application Password can call it, but each call **replaces** the key, which breaks every other client. **[source]**
- **Which WP user does it act as? None.** The callback never sets a user, and the Bearer header is not Basic auth, so WP's app-password filter (`wp_validate_application_password`, WP `wp-includes/user.php:521-544`) does nothing. `get_current_user_id()` is `0`. **[source]** Consequences:
  - Folders are created with `created_by = apply_filters('fbv_folder_created_by', 0)`, which is **0, the shared tree**, even in per-user mode (`Model/Folder.php:545-559`). **[source]**
  - `set-attachment` runs **no capability or ownership checks**: no `canEditObjects`, no `verifyAuthor`, and no check that the folder exists (`Api.php:256-276`, `Folder.php:330-363`). The key is effectively an admin-level credential for folder data. **[source]**
  - One `Authorization` header cannot carry both the Bearer key and Basic app-password credentials, so public-API calls can never be tied to a WP user. **[source]**

### 1.2 Response and error format

- Success: `wp_send_json_success($data)` → HTTP **200** `{"success":true,"data":{…}}`.
- Validation errors: `wp_send_json_error(['mess'=>…])` → HTTP **200** `{"success":false,"data":{"mess":"Validation failed"}}`. **[source]** (`Api.php:205-209, 250-254, 271-275`)
- Auth failure: the REST permission callback returns false → WP's own `{"code":"rest_forbidden","message":"Sorry, you are not allowed to do that.","data":{"status":401}}`. **[source]**/**[docs]**
- Post-type routes return real `WP_Error`s, e.g. `post_type_not_enable` with status 400 (`Api.php:147-153`). **[source]**
- **ID types vary.** `/folders` returns ints (`Tree::prepareTreeData` casts them). `/folder` and `/attachment-id` return **strings**, because they are raw `$wpdb` rows or columns. **[source]**
- **Docs drift.** The official docs show `/folders` items with `li_attr` and `count`. The 6.5.9 code returns `key, id, children, text, title, color, data-id, parent, data-count, ord` (`Classes/Tree.php:221-240` plus `Api.php:26-36`). **[source]** vs **[docs]**
- `wp_send_json_*` calls `die()`, so these routes skip the normal `rest_post_dispatch` and response filters. **[source]**

### 1.3 Endpoint table — public API (media)

| Route | Method | Params | Auth | Callable via app password? | Notes |
|---|---|---|---|---|---|
| `/folders` | GET | `language` (WPML/Polylang) | Bearer key | No (needs the Bearer key) | Full nested tree. Each node has `id, text, title, parent, ord, color, data-count, children`. `data-count` = files directly in the folder (non-trash), or folder+sub when user 0's counter type is "and_sub" (never in practice). Sorted by `ord ASC`. `Api.php:38-46`, `Tree.php:159-174`. **[source]** |
| `/folder?folder_id=` | GET | `folder_id` | Bearer | No | `{folder:{id,name,parent}}` (strings), or `null` if missing. No ownership filter. `Api.php:187-194`. **[source]** |
| `/folders` | POST | `name`, `parent_id` (0 = root) | Bearer | No | `FolderModel::newUniqueFolder`. Since 6.5.2 a **duplicate name is auto-renamed** to "Name (1)" and so on (max 15 tries) instead of failing, so `{id}` is always returned. If the insert fails, `id` is `null` with `success:true`. Created with `created_by=0`. `Api.php:242-255`, `Folder.php:487-495, 444-473`. **[source]** |
| `/folder/set-attachment` | POST | `folder` (int; 0 = Uncategorized), `ids` (int or array) | Bearer | No | Per attachment, removes it from all folders of the current owner, then inserts. No folder-exists, post-type or capability checks. Fires `fbv_before_setting_folder` and `fbv_after_set_folder`. One row-delete plus insert per id, so it is not batched SQL. `Api.php:256-276`, `Folder.php:330-363`. **[source]** |
| `/attachment-id?folder_id=` | GET | `folder_id` (>0) | Bearer | No | `{attachment_ids:["12","15",…]}`. **All** IDs, **unpaginated, unsorted, any post status**, straight from the relation table. `folder_id=0` returns `[]` (there are no relation rows for Uncategorized), so it **cannot list Uncategorized**. `Api.php:195-210`, `Helpers.php:212-215`. **[source]** |
| `/attachment-count?folder_id=` | GET | `folder_id` (`>0`, `-1` = all, `0` = uncategorized), `icl_lang` | Bearer | No | `{count}`. `0` is computed as `total(inherit/private) − Σ per-folder counts`. Direct files only, no subfolders. `Api.php:211-241`, `Tree.php:64-157`. **[source]** |

Post-type folder routes on the same key (6.5.7+, "Updated: APIs for post types"; posts, pages and CPTs, not media; one level only in Free): `GET /post-type-folders?post_type=`, `GET /post-type-folder/posts?post_type=&folder_id=&per_page=&page=` (this one **is** paginated, and `folder_id=0` = uncategorized via `tax_query NOT EXISTS`), `POST /post-type-folders`, `POST /post-type-folder/update`, `POST /post-type-folder/delete`, `POST /post-type-folder/set-posts`. They are irrelevant for media, but they show the vendor *can* ship a paginated "items in folder" route. Media just lacks one. `PublicApi.php:35-103`, `Api.php:48-185`. **[source]**

---

## 2. Internal endpoints (FileBird's own admin UI)

All are registered on `rest_api_init` via `includes/Rest/RestApi.php` (FolderApi, PublicApi, SettingApi, SyncApi, PostTypeApi), plus `Classes/Convert.php`, `Controller/Import/ImportController.php`, `Addons/PostType/Routes.php` and `blocks/filebird-gallery/init.php`.

The UI calls them with jQuery. The body is **JSON** (`contentType:"application/json"`, `JSON.stringify`), the header is `X-WP-Nonce: fbv_data.rest_nonce`, and the base is `fbv_data.json_url` = `rest_url('filebird/v1')` (`Classes/Core.php:117-122`; client map in `assets/dist/index-*.js`: `getTree→GET /get-folders`, `createFolder→POST /new-folder`, `updateFolder→/update-folder`, `deleteFolder→/delete-folder {ids,language}`, `assignFolder→/assign-folder`, `updateFolderOrd→/update-folder-ord`, `updateFolderColor→/update-folder-color`, `setFolderCounter→/set-folder-counter`). **[source]**

### 2.1 Why these work with an Application Password

- The `X-WP-Nonce` is the generic `wp_rest` nonce. WP core only enforces it for **cookie-authenticated** requests (`rest_cookie_check_errors`, WP `wp-includes/rest-api.php` around line 1139: it returns early unless `$wp_rest_auth_cookie`). Basic-auth or app-password requests skip it. FileBird adds no nonce check of its own to any `filebird/v1` route. **[source]**
- The permission callbacks are capability-only:
  ```php
  // includes/Rest/FolderApi.php:108-110 (all folder routes)
  public function permission_callback() { return current_user_can( 'upload_files' ); }
  // includes/Rest/SettingApi.php: set-settings → manage_options; set-user-settings → upload_files
  // includes/Rest/SyncApi.php: export/import/restore CSV → upload_files
  // ImportController.php:206-208: backups → manage_options
  ```
  The app-password user (Editor/Admin) passes these. **[source]**
- The user is reset correctly for REST. Before serving, `WP_REST_Server::serve_request` clears a cached "user 0", so app-password auth runs once `REST_REQUEST` is defined (WP `class-wp-rest-server.php:295-307`, `user.php:386-402`). **[source]**
- **Caveat (per-user mode):** `Modules/ModuleUser.php:10-21` and `Model/UserSettingModel.php` (`$this->userId = get_current_user_id()` in the constructor) capture the user at **`plugins_loaded`** (`filebird.php` `init()` → `Core::getInstance()` → `loadModules()`). That is before `REST_REQUEST` exists, so for an app-password request the captured id is **0**. Effects:
  - The `fbv_folder_created_by` filter returns 0, so listing, creating and moving all work on the **shared** tree (`created_by=0`).
  - `verifyAuthor()` compares against the *live* `get_current_user_id()`. In per-user mode that is the real user, so `assign-folder`, `update-folder`, `delete-folder` and `update-folder-color` refuse ("Permisson Denied" / silently skip) for created_by=0 folders.
  - User settings (counter type, folder sort, startup folder) are read from and written to user meta of user 0, which is a no-op.
  - **Net: in the default shared mode everything is consistent; in "folder per user" mode the internal API is broken for app-password clients.** **[source]**, inference, **[assumption]** until tested live.

### 2.2 Endpoint table — internal `filebird/v1` (media-relevant)

| Route | Method | Params (JSON body / query) | Permission | Callable via app password? | Notes |
|---|---|---|---|---|---|
| `/get-folders` | GET | `order` (`asc`/`desc`/`reset`), `orderby` (`name`; anything else = manual `ord`), `search`, `language` | `upload_files` | **Yes** | `{tree:[nodes…], allAttachmentsCount:int, attachmentsCount:{display:{id:n}, actual:{id:n}}}`. `actual` = direct files. `display` = direct or recursive, depending on the user's counter type. With `search` it returns a **flat** list of matching folders (`name LIKE %search%`). Side effect: passing `order`/`orderby` persists the sort to user meta. `FolderController.php:26-41`, `Tree.php:17-62`. **[source]** |
| `/new-folder` | POST | `title`, `parent` | `upload_files` | **Yes** | Returns `[ {title,id,key,type,parent,children,data-count,data-id} ]`. Auto-renames duplicates. A `WP_Error` without a status (→ HTTP 500) on DB failure. `FolderController.php:91-114`. **[source]** |
| `/update-folder` | POST | `id`, `parent`, `title` | `upload_files` + `verifyAuthor` | **Yes** (shared mode) | **Rename only.** `parent` is used only for the sibling-uniqueness check and does not move the folder. Duplicate name → `folder_name_exist` (HTTP 500, no status). `FolderController.php:116-144`, `Folder.php:392-433`. **[source]** |
| `/update-folder-ord` | POST | `dragNodeId`, `dropNodeId`, `toParentId`, `dropPosition` (`-1` = first in parent, `0` = into dropNode, `1` = after dropNode), `language` | `upload_files` | **Yes**, but see notes | **Move/reparent + reorder** in one call. Renumbers `ord` of all siblings and blocks cycles (`isSelfOrDescendant`). Auto-renames on a name clash and returns `{reload:true}`. Fires `fbv_folder_parent_updated`. **Gotcha:** it compares `dropPosition` with `===` against ints, so it must be sent as a **JSON number**. Form-encoded `"0"` silently does nothing and still returns 200. `FolderController.php:146-353`. **[source]** |
| `/delete-folder` | POST | `ids: [int]`, `language` | `upload_files` + `verifyAuthor` per id | **Yes** | **Recursive**: deletes subfolders and their relation rows; files become Uncategorized. Unauthorized ids are silently dropped. Returns `{display,actual}` counters. Filter `fbv_can_delete_folder`, action `fbv_after_folder_deleted`. `FolderController.php:355-383`, `Folder.php:647-680`. **[source]** |
| `/assign-folder` | POST | `folderId` (0 = unassign → Uncategorized), `ids: [int]`, `language` | `upload_files` + `verifyAuthor(folder)` + `edit_post` on **every** id (atomic reject) | **Yes** | **Bulk move**, batched SQL (one DELETE plus one multi-row INSERT). Returns `{display,actual}` counters. Action `fbv_after_assign_folder`. Safer than the public `set-attachment`. `FolderController.php:385-428`, `Folder.php:287-324`, `Helpers.php:71-99`. **[source]** |
| `/update-folder-color` | POST | `folderId`, `color` (hex) | `upload_files` + `canUseFolder` | **Yes** | Stores `fbv_folder_colors[id]=hex`. **Server-side ungated in Lite**; only the UI marks colour as PRO. `FolderController.php:59-89`. **[source]** |
| `/set-folder-counter` | GET | `type` = `counter_file_in_folder` \| `counter_file_in_folder_and_sub`, `language` | `upload_files` | Yes (the write lands on user 0, a no-op) | Returns counters. We can compute recursive counts ourselves from the tree. `FolderController.php:43-57`. **[source]** |
| `/gutenberg-get-folders` | GET | – | `upload_files` | Yes | Flat `[{value,label}]` with `-` depth prefixes, in a `{success,data}` envelope. **[source]** |
| `/gutenberg-get-images` | POST | gallery block attributes | `upload_files` | Yes | Renders gallery HTML for a folder. Not useful to us. `blocks/filebird-gallery/init.php:22-35`. **[source]** |
| `/generate-attachment-size` | POST | `page` | `upload_files` | Yes | Fills post meta `fb_filesize` in batches of 50 (used by Pro's "sort by size"). WP also sets it on upload via `added_post_meta`. `Attachment/AttachmentSize.php:12-80`. **[source]** |
| `/set-settings` | POST | settings keys (`USER_MODE`, `SVG_SUPPORT`, `IS_SEARCH_USING_API`, `AUTO_BACKUP`, … plus user keys) | `manage_options` | Yes (admin) | Global settings. `USER_MODE` toggles `njt_fbv_folder_per_user`. **[source]** |
| `/set-user-settings` | POST | `DEFAULT_FOLDER`, `DEFAULT_SORT_FILES`, `DEFAULT_SORT_FOLDERS`, `FOLDER_COUNTER_TYPE`, `THEME`, `SHOW_BREAD_CRUMB` | `upload_files` | Yes, but writes to user 0 (see 2.1) | **[source]** |
| `/export-csv`, `/import-csv`, `/import-csv-detail`, `/restore-backup` | GET/POST | – | `upload_files` | Yes | Folder-structure backup and restore (CSV). **[source]** |
| `/get-backup-files`, `/download-backup`, `/backup-now` | GET/POST | – | `manage_options` | Yes (admin) | 6.5.9 backup management. **[source]** |
| `/fbv-api` | POST | `act=generate-key` | `upload_files && manage_options` | Yes (admin) | **Rotates** the public API key. **[source]** |
| `/import/get-folders/{prefix}`, `/import/get-attachments/{prefix}`, `/import/run/{prefix}`, `fb-get-old-data`, `fb-insert-old-data`, `fb-wipe-*`, `fb-no-thanks` | various | – | `upload_files` | Yes | Migration from other folder plugins or old FileBird. Ignore. **[source]** |
| `pt-*` (`pt-folders`, `pt-new-folder`, `pt-edit-folder`, `pt-update-tree`, `pt-delete-folder`, `pt-set-folder`, `pt-set-folder-color`, `pt-set-setting`, `pt-folder-counter`, `pt-duplicate-folder`, `pt-import`, `pt-import-run`) | various | – | `manage_options \|\| edit_posts` | Yes | Post-type folders (taxonomies `fbv_pt_tax_{type}`). Not media. **[source]** |

### 2.3 admin-ajax actions (not usable from our server)

`wp_ajax_fbv_first_folder_notice` (`check_ajax_referer('fbv_nonce')` + `manage_options`), `wp_ajax_fbv_save_review`, `wp_ajax_fbv_save_post_type_settings`, and `wp_ajax_fbv_sync_wpml` are all UI chores. More importantly, **core's** `wp_ajax_query_attachments` is the only place FileBird injects the folder filter (see §3). WP only accepts Application Passwords on REST and XML-RPC requests (`application_password_is_api_request`, WP `user.php:386-402`), so **admin-ajax cannot be called with our app password** and would need a cookie session. **[source]**

### 2.4 Features that do not exist (in Lite)

- **Folder ZIP download:** no route in Lite; the UI shows a disabled "Download (PRO)" item. Pro adds it (filter `fbv_use_zipstream` in the docs). **[source]**+**[docs]**
- **Sort files** (10 ways) and **sort folders** by name: the UI items are disabled in Lite (`assets/dist/main.tsx-*.js`). File sort is just a `WP_Query` `orderby` chosen by the UI (stored as user meta `_njt_fbv_default_sort_files`). There is **no per-folder manual file order**: the relation table has no `ord` column. **[source]**; Pro behaviour **[assumption]**.
- **"Get folder of attachment":** no REST route anywhere. FileBird only renders it as HTML in `attachment_fields_to_edit` (`Core.php:249-276`, `FolderModel::getFolderFromPostId`). **[source]**
- **Folder search:** only via internal `/get-folders?search=` (flat result). **[source]**

---

## 3. Filtering media by folder

### 3.1 How FileBird does it

```php
// includes/Classes/Core.php:33,36  (hooks registered for every request)
add_filter( 'ajax_query_attachments_args', array( $this, 'ajaxQueryAttachmentsArgs' ), 20 );
add_filter( 'posts_clauses', array( $this, 'postsClauses' ), 10, 2 );

// Core.php:183-204
public function postsClauses( $clauses, $query ) {
    if ( $query->get( 'post_type' ) !== 'attachment' ) return $clauses;
    $fb_folder = ( new FolderStateManager( $query, $this->userSettingModel ) )->getFbFolder();
    if ( ! \is_null( $fb_folder ) ) {
        if ( FolderModel::ALL_CATEGORIES === $fb_folder ) {         // -1
            return $clauses;
        } elseif ( FolderModel::UN_CATEGORIZED === $fb_folder ) {   // 0
            $clauses = FolderModel::getRelationsWithFolderUser( $clauses ); // NOT IN (subquery)
        } else {
            $clauses['join']  .= $wpdb->prepare( " LEFT JOIN {$wpdb->prefix}fbv_attachment_folder AS fbva ON fbva.attachment_id = {$wpdb->posts}.ID AND fbva.folder_id = %d ", $fb_folder );
            $clauses['where'] .= ' AND fbva.folder_id IS NOT NULL';
        }
    }
    return $clauses;
}
```

- `FolderStateManager::getFbFolder()` reads `$query->get('fbv')`. It falls back to `$_GET['fbv']` or the startup folder **only** when `get_current_screen()->id === 'upload'` (`FolderStateManager.php:18-51`, `Helpers::isListMode` at `Helpers.php:228-234`). **[source]**
- `fbv` reaches the query only via `ajaxQueryAttachmentsArgs`, which copies `$_REQUEST['query']['fbv']` into the admin-ajax `query-attachments` args (`Core.php:240-247`), and via the list-mode screen. **[source]**
- **There is no `rest_attachment_query`, `rest_*_collection_params`, `register_rest_field` or `rest_prepare_attachment` hook anywhere in the plugin** (grep across the code). `WP_REST_Attachments_Controller` maps only its registered params into `WP_Query`, so **`GET /wp/v2/media?fbv=123` returns the unfiltered library**. **[source]**
- The hook itself is generic. Any `WP_Query` with `post_type=attachment` and an `fbv` arg gets filtered, so a one-line `rest_attachment_query` filter in a mu-plugin makes REST work (§6, option 3). **[source]**
- Uncategorized SQL: `ID NOT IN (SELECT attachment_id FROM fbv_attachment_folder JOIN fbv … GROUP BY attachment_id HAVING FIND_IN_SET(owner, GROUP_CONCAT(created_by)))` (`Folder.php:630-645`). It is correct but scans the whole relation table on every query, which is acceptable for libraries in the tens of thousands. The relation table's PK is `(folder_id, attachment_id)`, so there is **no index on `attachment_id` alone**. **[source]**, perf **[assumption]**

### 3.2 Getting "files in folder X, paginated and sorted" today, without changing WordPress

1. `GET filebird/public/v1/attachment-id?folder_id=X` → every ID (strings).
2. `GET /wp/v2/media?include=<ids>&orderby=date|title|…&order=…&per_page=≤100&page=N` (plus `search`, `media_type`, `mime_type`). WP sorts and pages within `post__in` and returns `X-WP-Total` and `X-WP-TotalPages`. **[source]**
   - Large folders run into URL length limits. WP's method override lets us send `POST /wp/v2/media?_method=GET` (or header `X-HTTP-Method-Override: GET`) with a **JSON** body `{include:[…], page, per_page, orderby}`. JSON params are honoured for GET because `get_parameter_order` puts `JSON` first (WP `class-wp-rest-server.php:390-393`, `class-wp-rest-request.php:361-398`). **[source]**
3. **Uncategorized:** no ID list exists. Options are `exclude=<every categorized id>` (one `/attachment-id` call per folder), or the internal or mu-plugin route. Only `/attachment-count?folder_id=0` exists for the count. **[source]**
4. **Folder of attachment X** (for the detail view): build a reverse index from `/attachment-id` over all folders and cache it server-side; N requests per refresh. **[source]** (no direct route)

### 3.3 Upload directly into a folder (bonus)

`Core::addAttachment` runs on core's `add_attachment` action and reads **`$_REQUEST['fbv']`**. A query param on `POST /wp/v2/media?fbv=123` therefore assigns the folder inside the upload request. It also accepts a path, `fbv=12/Sub/SubSub`, which **creates the missing subfolders** with `newOrGet` (filter `fbv_auto_create_folders`). The folder has to pass `verifyAuthor` (fine in shared mode). `Core.php:206-234`. **[source]**; untested over REST **[assumption]**.

---

## 4. Data model

```sql
-- includes/Install.php:18-38
CREATE TABLE {prefix}fbv (
  id int(11) unsigned AUTO_INCREMENT PRIMARY KEY,
  name varchar(250) NOT NULL,
  parent int(11) NOT NULL DEFAULT 0,    -- 0 = root
  type int(2) NOT NULL DEFAULT 0,       -- 0 folder, 1 "collection" (unused)
  ord int(11) NULL DEFAULT 0,           -- sibling order, renumbered on move
  created_by int(11) NULL DEFAULT 0     -- 0 = shared tree; user id in per-user mode
);
CREATE TABLE {prefix}fbv_attachment_folder (
  folder_id int(11) unsigned NOT NULL,
  attachment_id bigint(20) unsigned NOT NULL,
  PRIMARY KEY (folder_id, attachment_id)
);
```

- **Single folder per attachment per owner.** Every assignment first deletes the attachment's rows in the owner's folders (`Folder.php:294-302, 344`). In per-user mode one file can sit in one folder **per user**. **[source]**
- **Uncategorized and All are virtual:** ids `0` and `-1` (`Folder.php:12-14`). Uncategorized = no relation row for the current owner. **[source]**
- **Ordering:** folders are listed `ORDER BY ord ASC`; new folders get `MAX(ord)+1` among siblings (`Folder.php:39-44, 548-558`). An optional name sort (natural, case-insensitive) is applied in PHP (`Folder.php:48-50, 65-70`). **[source]**
- **Colours:** option `fbv_folder_colors` = `{folderId: "#hex"}`, cleaned up on delete. **[source]**
- **Counts** (`Folder::countAttachments`, `Folder.php:237-285`): `GROUP BY folder_id` over relation ⋈ posts (non-trash, plus third-party exclusions from `Helpers::buildExclusionConditions`). Recursive totals are computed in PHP when the user's counter type is `counter_file_in_folder_and_sub`. "All" = attachments with status inherit or private (`Tree::getCount(-1)`). The counts are **not cached**; they are computed per request. **[source]**
- **Integrity:** `delete_attachment` removes the relation rows (`Core.php:236-238`). Deleting a folder deletes its subtree, and the files become uncategorized. Edited images (`wp_edited_image_metadata`) inherit the folder. There are no foreign keys; the public `set-attachment` can create orphan rows for non-existent folders. **[source]**
- **Other storage:** options `fbv_rest_api_key`, `njt_fbv_folder_per_user`; user meta `_njt_fbv_default_folder`, `_njt_fbv_default_sort_files`, `fbv_folder_sort`, `fbv_counter_type`, `fbv_folder_startup`, `fbv_theme`, `fbv_show_breadcrumb`; post meta `fb_filesize`. Post-type folders are taxonomies `fbv_pt_tax_{post_type}` with term meta `fbv_tax_order` and `fbv_author`. **[source]**
- **Per-user mode** (setting `USER_MODE` → option `njt_fbv_folder_per_user`): filter `fbv_folder_created_by` → the current user id, so each user gets a separate tree. Deleting a user deletes or reassigns that user's folders (`Core.php:322-328`). **[source]**

---

## 5. Free vs Pro, versions, stability, extension points

### 5.1 Free vs Pro

| Feature | Lite 6.5.9 | Pro | Evidence |
|---|---|---|---|
| Unlimited folders and subfolders | ✔ (the old 10-folder limit text remains in i18n but is not enforced or referenced) | ✔ | **[docs]** readme / compare page; **[source]** |
| Public REST API | ✔ | ✔ | **[docs]** compare page ("API access" in both) |
| User-based folders | ✔ | ✔ | **[docs]** |
| Folder colour | UI: PRO; **REST `update-folder-color` works** | ✔ | **[source]**, **[docs]** |
| Sort folders by name / sort files (10 ways, by size) | UI disabled; `get-folders?orderby=name` works server-side | ✔ | **[source]**, **[docs]** |
| Download folder as ZIP | ✘ (no route) | ✔ | **[source]**, **[docs]** |
| Folder themes, flat tree view | ✘ | ✔ | **[docs]** |
| Post/page/CPT folders | 1 level | multi-level, WooCommerce etc. | **[docs]** readme FAQ |
| WPML / Polylang, page builders | basic / ✘ | ✔ | **[docs]** |

The Pro routes (ZIP, etc.) could not be inspected because the Pro source is not public. **[assumption]**: Pro shares this codebase and adds routes under `filebird/v1`.

### 5.2 Version and stability notes

- Changelog cadence is about monthly, and many entries are **security** fixes touching access control: 6.5.1 "Access Control Authenticated (Subscriber+)", 6.5.2, 6.4.9, 6.5.9, 5.3.2 "SQL security", and "Permission for generate-key api". Recent code has `verifyAuthor` / `canEditObjects` checks added late. Expect **internal route params and permission semantics to keep shifting**. **[docs]**+**[source]**
- Public API history: "New API method for Dev" in 5.0 (2022); query-string token removed (comment in `PublicApi.php:184-186`); post-type routes added 6.5.7. The media routes look stable since 5.0 (**[assumption]**, based on the docs still matching the paths). The response shape of `/folders` has drifted from the docs.
- Behaviour change in 6.5.2: `POST /folders` **auto-renames duplicates** instead of failing. Our `createFolder` comment about duplicate-name failures is outdated. **[docs]**+**[source]**
- Tables are unchanged since the v4 migration (`fbv_old_data_updated_to_v4`), so this is the most stable surface. **[source]**

### 5.3 Hooks other plugins can use

Actions: `fbv_after_folder_created($id,$data)`, `fbv_after_folder_renamed`, `fbv_after_folder_deleted`, `fbv_after_parent_updated`, `fbv_folder_parent_updated`, `fbv_before_setting_folder`, `fbv_after_set_folder($post_id,$folder_id)`, `fbv_after_assign_folder($folderId,$ids)`, `fbv_after_delete_all`.
Filters: `fbv_folder_created_by`, `fbv_will_check_author`, `fbv_counter_type`, `fbv_all_folders_and_count`, `fbv_ids_assigned_to_folder`, `fbv_can_delete_folder`, `fbv_auto_create_folders`, `fbv_speedup_get_count_query`, `fbv_folder_api_search`, `filebird_json_url`. **[source]**
Documented filters include `fbv_use_zipstream` (Pro) and `fbv_user_default_*` (**[docs]**, Filters page).
Documented PHP functions: `FolderModel::findById`, `Tree::getFolders`, `FolderModel::newOrGet`, `Helpers::getAttachmentIdsByFolderId`, `FolderModel::setFoldersForPosts` (**[docs]**, Functions page). A mu-plugin should prefer these over raw SQL.

---

## 6. Gaps and options

Use-case gaps with the public API alone: rename, delete, move/reorder, colour, bulk move with permission checks, paginated or sorted folder contents, Uncategorized listing, folder-of-attachment, search folders, recursive counts, ZIP.

### Option 1 — public API only

- **Pros:** documented and versioned (`v1`), so it is the most likely to stay compatible. It needs no PHP on the WP side, and the API key is independent of WP users.
- **Cons:** no rename, delete, move, reorder or colour, which rules out a real folder sidebar. Folder contents need the `attachment-id` + `include` two-step, and Uncategorized has no listing. Every call is anonymous (user 0): there is no audit trail and no capability checks, and per-user mode is unsupported. Errors arrive as HTTP 200. It also needs a second credential (`FILEBIRD_API_KEY`) besides the app password.
- **Verdict:** enough for today's upload-into-folder feature, **not enough for a media manager**.

### Option 2 — internal `filebird/v1` with the existing Application Password

- **Pros:** full folder CRUD, move/reorder, colour, bulk assign with `edit_post` checks, search, and counts. Calls act as the real WP user (audit, capabilities), use one credential, and need no WP-side installation. They work in Lite. The app-password user needs `upload_files` (plus `manage_options` only for settings and backups).
- **Cons:** undocumented, and params and permission semantics have changed in security releases, so a contract test suite against a pinned FileBird version is needed. Quirks: `dropPosition` must be a JSON int; `WP_Error`s without a status become 500s; responses mix envelopes. It is **broken in per-user mode** for app passwords (§2.1). It **still gives no folder filter for `/wp/v2/media`**, so the paging problem of option 1 remains (or the `attachment-id` + `include` workaround is needed).
- Detection: `GET /wp-json/` → `namespaces` contains `filebird/v1` and `filebird/public/v1`, which also tells us FileBird is optional and present. **[source]** (standard WP index)

### Option 3 — companion mu-plugin (our own REST surface)

Minimal version (about 20 lines), which unlocks the grid:

```php
// sketch only (not decided)
add_filter( 'rest_attachment_collection_params', fn( $p ) => $p + [ 'fbv' => [ 'type' => 'integer' ] ] );
add_filter( 'rest_attachment_query', function ( $args, $req ) {
    if ( isset( $req['fbv'] ) ) { $args['fbv'] = (int) $req['fbv']; } // FileBird's posts_clauses does the rest
    return $args;
}, 10, 2 );
register_rest_field( 'attachment', 'fbv_folder', [ 'get_callback' => fn( $a ) => /* FolderModel::getFolderFromPostId */ ... ] );
```

That gives `/wp/v2/media?fbv=123|0|-1` with native `page`/`per_page`/`orderby`/`search`/`media_type`, correct `X-WP-Total`, Uncategorized included, and the folder ID on every media item (detail view, selection state).

A fuller version would add `wpupload/v1/folders` (tree, direct and recursive counts, all and uncategorized counts in one response), `PATCH /folders/{id}` (`name`, `parent`, `position` as an index, `color`), `DELETE`, and `POST /folders/{id}/items {ids}` (bulk). Each wraps FileBird's model methods, so FileBird's actions still fire. Permissions would be `upload_files` + `edit_post`, under our own contract and version. If `class_exists('FileBird\Model\Folder')` is false, the routes return 404 or "unavailable", which keeps FileBird optional.

- **Pros:** a clean, stable, typed contract owned by us, with efficient server-side paging and filtering. It can fix the per-user caching issue (resolve the user at request time) and can batch work (one tree+counts call).
- **Cons:** someone must install PHP on the WordPress site, which is extra deployment friction for a "small self-hosted app", and it needs versioning and updates. It couples to FileBird's table schema and model method names, though both have been stable since v4. Security review is our responsibility.
- **Hybrid:** a minimal mu-plugin (query filter + REST field) for reads, plus internal `filebird/v1` (option 2) for mutations. Or start with option 2 plus the `include` workaround and add the mu-plugin later as an optional accelerator.

---

## Implications for the media manager

1. **Folder sidebar (tree, counts, CRUD, drag-to-move/reorder, colours):** this needs option 2 or 3. The public API alone cannot rename, delete or move. Recursive counts can be computed on our side from `actual` counts plus the tree.
2. **Grid per folder with paging and sort:** without WP-side code this means `attachment-id` + `/wp/v2/media?include=` (`POST _method=GET` for big folders), with server-side caching of the ID lists. With the mu-plugin it is one native `/wp/v2/media?fbv=` call. Uncategorized is cheap only with the mu-plugin (or with option 2 plus an `exclude` list).
3. **Detail mode "folder" field:** no FileBird route exists. We need a reverse index (cached) or the mu-plugin REST field.
4. **Bulk move:** prefer internal `assign-folder` (one SQL batch, capability-checked) over public `set-attachment` (per-row, unchecked).
5. **Uploads:** `?fbv=<id>` on `POST /wp/v2/media` may remove the separate assign call (verify live).
6. **Keep FileBird optional:** detect it from the `/wp-json/` namespaces (and the mu-plugin's namespace, if any). Treat `-1`/`0` as virtual folders, and treat "folder per user" mode as unsupported or a warning unless the mu-plugin path is taken.
7. **Fix later** (no change now): `server/src/lib/filebird.ts` `unwrap()` should also read `data.mess`, and the createFolder duplicate-name comment is outdated (FileBird auto-renames).
8. ZIP download is Pro-only and has no API in Lite. If wanted, build it in our server from the attachment URLs, independent of FileBird.

## Open questions

- Live verification needed: (a) `filebird/v1` routes with our app password (expect 200); (b) the per-user-mode mismatch; (c) `POST /wp/v2/media?fbv=` auto-assign; (d) `POST /wp/v2/media?_method=GET` with a JSON `include` behind the user's reverse proxy (some proxies or WAFs strip override headers or bodies on GET semantics).
- Do the target sites use FileBird **Pro**? If so, which extra `filebird/v1` routes does Pro register (ZIP, sort), and does Pro change the `posts_clauses` behaviour? The Pro source was not available.
- Is installing a mu-plugin acceptable for the intended users (self-hosters with WP admin access), or must wp-upload work with stock plugins only?
- Is per-user folder mode a requirement for anyone? If not, document it as unsupported.
- Performance of the Uncategorized `NOT IN … GROUP BY … HAVING` query and `countAttachments` on large libraries (50k+). Would the mu-plugin need its own index on `fbv_attachment_folder(attachment_id)`?
- WPML/Polylang `language` params: needed for the target sites?

## Sources

Code (FileBird Lite 6.5.9, paths relative to `filebird/`):
- `filebird.php` (version, constants `NJFB_REST_URL='filebird/v1'`, `NJFB_REST_PUBLIC_URL='filebird/public/v1'`, `init()` on `plugins_loaded`)
- `includes/Rest/PublicApi.php`, `includes/Controller/Api.php` (public API)
- `includes/Rest/FolderApi.php`, `includes/Controller/FolderController.php`, `includes/Rest/SettingApi.php`, `includes/Rest/SyncApi.php`, `includes/Rest/PostTypeApi.php`, `includes/Addons/PostType/Routes.php`, `includes/Controller/Import/ImportController.php`, `includes/Classes/Convert.php`, `blocks/filebird-gallery/init.php`
- `includes/Model/Folder.php`, `includes/Classes/Tree.php`, `includes/Classes/Helpers.php`, `includes/Install.php`
- `includes/Classes/Core.php`, `includes/Classes/FolderStateManager.php`, `includes/Model/UserSettingModel.php`, `includes/Classes/Modules/ModuleUser.php`, `includes/Classes/Attachment/AttachmentSize.php`
- `assets/dist/index-*.js`, `assets/dist/main.tsx-*.js`, `assets/dist/admin.tsx-*.js` (UI API client, disabled PRO menu items)
- `readme.txt` (features, FAQ, changelog)

WordPress 7.1.5 core: `wp-includes/user.php` (`wp_authenticate_application_password`, `wp_validate_application_password`, `_wp_get_current_user`), `wp-includes/rest-api/class-wp-rest-server.php` (`serve_request`: user reset, `_method` override), `wp-includes/rest-api/class-wp-rest-request.php` (`get_parameter_order`), `wp-includes/rest-api.php` (`rest_cookie_check_errors`, `REST_REQUEST`), `wp-admin/includes/ajax-actions.php` (`wp_ajax_query_attachments`).

Web:
- FileBird APIs (developer zone): https://ninjateam.gitbook.io/filebird/integrations/developer-zone/apis
- FileBird PHP functions: https://ninjateam.gitbook.io/filebird/integrations/developer-zone/functions
- FileBird filters: https://ninjateam.gitbook.io/filebird/integrations/developer-zone/filters
- Compare FileBird Free and Pro: https://ninjateam.gitbook.io/filebird/compare-filebird-free-and-pro
- Docs index: https://ninjateam.gitbook.io/filebird/sitemap.md
- Plugin page and changelog: https://wordpress.org/plugins/filebird/
