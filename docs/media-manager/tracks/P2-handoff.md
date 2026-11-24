# Track P2 (M1): handoff

Branch `mm/p2`, from `feature/media-manager` @ e09ac4f. Scope: the companion plugin's write side
(contracts/plugin-api.md §5.4–5.15, §8.2–8.3), the usage index with Visual Portfolio (D22), and the
`wpu` keys P2 owns. Docker was available; everything below was run against this worktree's stack.

## 1. What works

| Route / piece | Code | Notes |
|---|---|---|
| `POST /media/batch` | `Rest/MediaController.php` | Validation before any item, per-item `edit_post` and attach-target checks, one `wp_update_post()` (skipped when nothing differs), alt via meta, `previous`/`item` as stored, 20 s budget with `remaining` |
| `POST /media/trash`, `/media/delete` | `Rest/MediaController.php` | 409 `wpu_trash_disabled` first; already trashed succeeds; `delete_post` per item |
| `GET /trash`, `POST /trash/restore`, `/trash/empty` | `Rest/TrashController.php` | Restore reports the FileBird folder (read-only SQL, per-user aware); empty is oldest-trashed first, `skipped` for items the user may not delete |
| `GET\|POST /usage` | `Rest/UsageController.php` | One ref per post (site slots first, then featured, then title), 200 refs max, "Private post" for unreadable posts, `complete` from the index state |
| Usage index | `Index/UsageIndex.php`, `Usage/Parser.php` | Tables via `dbDelta` on load; hooks for saves, trash, deletes, `_thumbnail_id`, `vp_images`, site logo/icon (incl. the `custom_logo` theme mod); backfill `step()`; reconcile pass after `mark_stale()`; Visual Portfolio on/off detection; rev moves only when a post's rows change |
| `POST /media/{id}/edit`, `/edit/undo`, `/restore` | `Rest/ImagesController.php`, `Images/*` | Same URL (spike X2), undo stack of 10 with merging, original recorded for wp-admin, per-item lock, `expectedModified` checked before and under the lock |
| `POST /media/{id}/regenerate` | same | Every registered size from the current file; PDFs re-render their preview under the same names |
| `POST /media/{id}/replace` | same | Same URL in every case (spike X3), MIME/extension validation, `wp_handle_sideload()`, any kind (images rebuilt by the plugin, others by core) |
| `wpu` keys `edited`, `editedAt`, `undoable`, `restorable`, `sizesPending` | `Images/EditStateProvider.php` | P1's `Field\Provider`; `prime()` loads all meta in one query |
| `wpu.usageCount` | `Usage/UsageCountProvider.php` | One grouped query per page; null while the index isn't `ready` |
| Features | `Plugin::provide_feature()` calls | `media-batch`, `trash`, `usage`, `usage-visual-portfolio`, `image-edit`, `image-regenerate`, `image-replace` |

**Integration with P1 (checked, not merged):** P1's published files from `mm/p1` @ fe211b3 were laid
over this branch *uncommitted* (and removed again) to check the seams:
- `/info` lists all twelve features; P1's single-file build includes the P2 classes in dependency order;
  `php -l` passes on the built file (PHP 8.1).
- `POST /maintenance/step` drives `UsageIndex::step()` through `UsageBridge`; the `wpu` field shows
  P2's values.
- `dev/run test plugin-contract` (test mode, built plugin, runner, TLS): **11 files, 132 passed,
  33 skipped** (the variant, Author and Visual Portfolio cases the runner can't reach). Run before
  the review fixes in §7.
- On the host, P1 (`mm/p1` @ 27ef64b) + P2 together, after the review fixes: **13 files, 178 passed,
  1 skipped, 1 failed**. The failure is P1's `field.spec.ts` schema check on Visual Portfolio's
  placeholder attachment (`author.id` 0), which is CR-P2-4, not a P2 defect.

### Commands

```sh
dev/run up dev && dev/run seed small                      # the stack
# P2's contract tests from the host, on this branch (P1's vitest.config.ts isn't here yet):
npx vitest run --root plugin --no-file-parallelism tests/contract
# with the separate Author user (track D's M1 stack writes these to dev/.env.wp):
WPU_AUTHOR_USER=wpu-author WPU_AUTHOR_APP_PASSWORD=… npx vitest run --root plugin --no-file-parallelism tests/contract
# after integration, exactly as CI:
dev/run test plugin-contract
```

On this branch: **6 files, 83 passed, 1 skipped** (the skip is the `role=author` fallback, which runs
only without a separate Author user). `images-internals.spec.ts` and `usage-internals.spec.ts` are
PHP-level checks run through `dev/run wp eval` (host only, skipped in the runner, or with
`WPU_CONTRACT_VARIANTS=off`) for failure paths HTTP can't provoke. The tests flip `trash=`, `role=` and Visual Portfolio through
`dev/run`, so on the host they cover MEDIA_TRASH on and off, Visual Portfolio on and off, Editor and
Author; inside the runner those cases skip.

PHP: `php -l` clean with PHP 8.1 and 8.4 on every P2 file. Biome: clean on `plugin/tests`.

## 2. What's missing, and why

- **PHPStan** wasn't run: P1 owns `composer.json`/`composer.lock` and `plugin-static` isn't wired on
  this branch. The P2 code is written against the WordPress stubs' signatures.
- **Contract-test helpers are duplicated** in the P2 specs (P1 owns `tests/contract/support/**`,
  which didn't exist when they were written). See CR-P2-1.
- **`remaining` for the batch routes** is implemented (the budget is checked before each item) but not
  exercised by a test: a 20 s budget can't be exhausted in a test. A `wpu_batch_budget_ms` filter exists
  for a future test hook.
- **Saved Visual Portfolio layouts** are only tested against track D's seed (Editors can't create
  `vp_lists`); on this branch's stack (M0 seed) that test returns early.

## 3. Spike results

| Spike | Decision | Note |
|---|---|---|
| X2 | Own `WP_Image_Editor` pipeline; same URL; hard-linked backups; Imagick and GD both work, AVIF works | [spikes/X2.md](spikes/X2.md) |
| X3 | The URL can always be kept; `urlChanged` stays `false` for replace | [spikes/X3.md](spikes/X3.md) |
| X7 | Exact on the seed and 2000 synthetic posts; ~275 posts/s, ~1400 per 5 s step | [spikes/X7.md](spikes/X7.md) |
| X10 | Storage confirmed by rendering through Visual Portfolio 3.11.0; synced loops don't carry the layout's images | [spikes/X10.md](spikes/X10.md) |

## 4. Deviations from the plan or contract

1. **Lock storage (§5.11):** the per-item lock is one options row taken with `INSERT IGNORE` (atomic),
   holding `<expiry>:<token>`; an expired lock is taken over by one conditional `UPDATE`, and a holder
   deletes the row only while it still holds its own token (`Mutation\OptionLock`). Not a transient:
   that isn't atomic, and lives in the object cache when one is configured. The usage index's schema
   lock uses the same class.
2. **Undo stack format (§8.3):** each entry holds the metadata before the edit, the backups of the files
   it overwrote, the backup-size keys it replaced, and a fingerprint of the state after. Beyond 10
   entries the two oldest are merged, so Restore still reaches the original.
3. **`sizesRegenerated` for undo and restore** is the number of sizes in the restored metadata (files are
   moved back, nothing is regenerated).
4. **Restore of an image edited in wp-admin** goes through core `wp_restore_image()`, which switches the
   attached file back to wp-admin's original: `urlChanged: true`.
5. **Replace keeps wp-admin's backups** (the plugin's own recorded original and undo stack are dropped),
   so an item edited in wp-admin stays restorable after a replace.
6. **`applyTo: "thumbnail"`** makes the thumbnail uncropped from the edited image, as wp-admin does.
7. **Check order:** malformed bodies (400 `wpu_invalid_param`) are rejected after 404/403 and before
   415/409, for every image route.
8. **`wpu.usageCount`** is null whenever the usage index isn't `ready`, not per item.
9. **Content URLs** are matched by path whatever their host (spike X7).
10. **`wpu_usage_sources` gains a `modified_gmt` column** (§8.2; schema version 2, row version 2): the
    post's `post_modified_gmt` at scan time. A post is pending when it differs, so a future-dated
    `post_modified_gmt` doesn't keep a post pending forever.
11. **PDF regenerate** answers 415 `wpu_unsupported_type` when the site can't render PDFs (no
    Imagick/Ghostscript), and renders the preview itself (as core names it) instead of calling
    `wp_generate_attachment_metadata()`.
12. **Helper classes** (`Mutation\Api`, `Budget`, `Rev`, `Folders`) overlap with P1's `Support\*`,
    `Rev` and `FileBird\Adapter`. `Mutation\Rev` already delegates to P1's `Rev::commit()`/`touch()`
    when that class is loaded; the others can be folded in at integration.

## 5. Change requests

**CR-P2-1 (orchestrator, at integration): shared test helpers.** Each P2 spec starts with the same
helper block (`// --- Shared P2 test helpers` … `// --- End of the shared helpers ---`). Replace it with
imports from P1's `tests/contract/support/{env,http,variants}.ts` when both tracks are merged. No
behaviour change.

**CR-P2-2 (track D): a variant switch the runner can reach.** In the runner, `trash=`, `vp=` and `role=`
can't be flipped, so CI never runs the MEDIA_TRASH-on, Visual Portfolio-off and role tests. P1 asked the
same. Suggestion: a dev-only REST route in `dev/wordpress/mu-plugins/wpu-dev.php` (admin-only, test mode
only) that calls the existing variant code, plus `WPU_ADMIN_APP_PASSWORD` in the runner env.

**CR-P2-3 (P1 / track D): the Author password variable.** Track D writes `WPU_AUTHOR_APP_PASSWORD`
(`mm/d-m1`), P1's `support/env.ts` reads `WPU_AUTHOR_PASSWORD`. P2's specs read D's name. One of them
should change:

```diff
--- plugin/tests/contract/support/env.ts (mm/p1)
-    process.env.WPU_AUTHOR_PASSWORD ?? stack.WPU_AUTHOR_PASSWORD
+    process.env.WPU_AUTHOR_APP_PASSWORD ?? stack.WPU_AUTHOR_APP_PASSWORD
```

**CR-P2-4 (orchestrator, shared schema): `wpu.author.id` may be 0.** Visual Portfolio creates a
placeholder attachment with `post_author` 0 the first time it renders a gallery; P1's
`field.spec.ts` then fails `WpuFieldSchema` (`author.id` must be > 0). Either the plugin reports such
items as `author: {id: 0, name: ""}` and the schema allows it, or P1 maps them; the schema change would be:

```diff
--- shared/library-api.schema.ts (WpuFieldSchema)
-  author: z.object({ id, name: z.string() }),
+  author: z.object({ id: z.number().int().nonnegative(), name: z.string() }),
```

(Reproduce with Visual Portfolio active: render any gallery, then run `field.spec.ts`.)

**CR-P2-5 (P1): `field.spec.ts` "reports the original of a big image".** It asserts that *every* item
with an `original` is 2560 px on its long side. Items uploaded with an EXIF rotation (`-rotated`, no
scaling), and items P2's replace test leaves behind, can be smaller. Suggest filtering on
`original.filename` not ending in `-rotated` and on seeded ids, or asserting only `original.width >=
wpu.width`.

**CR-P2-6 (orchestrator): contract clarifications in `plugin-api.md`.**

```diff
@@ §5.11 Semantics
-- Holds a per-item lock (a transient, 10 minutes) for the whole operation.
+- Holds a per-item lock (an option taken with add_option(), 10 minutes) for the whole operation.
@@ §5.12 / §5.13 Response
+`sizesRegenerated` counts the sizes in the restored metadata (files are moved back, not regenerated).
@@ §5.13
+An image edited in wp-admin is restored with core's wp_restore_image(), which switches the attached
+file back to wp-admin's original: `urlChanged: true`.
@@ §5.15 Semantics
-- **`-scaled` images (spike X3):** the goal is that the attached file's URL stays the same. If X3 shows
-  it can't for some inputs (…), the plugin keeps the URL working where it can and reports
-  `urlChanged: true`; the UI warns.
+- **`-scaled` images (spike X3):** the attached file always keeps its name: an oversized or rotated
+  upload becomes the original and the attached file gets the processed copy; otherwise the upload is the
+  attached file and an old original is deleted. `urlChanged` is false; wp-admin's backups are kept.
@@ §5.14 Checks
-**Checks:** 404, 403, 415 `wpu_unsupported_type` (not a raster image in `imageEditor.mimes` and not a
-PDF), 409 `wpu_locked`.
+**Checks:** 404, 403, 415 `wpu_unsupported_type` (not a raster image in `imageEditor.mimes`, or a PDF
+on a site that can't render PDFs), 409 `wpu_locked`. New sizes are made under temporary names and
+swapped in only when every one was made; otherwise 500 `wpu_image_error` and nothing changes.
@@ §8.2 wpu_usage_sources
+| `modified_gmt` | `DATETIME NULL` | The post's `post_modified_gmt` when it was scanned; the post is pending when it differs |
@@ §8.3
-The undo stack lives in post meta `_wpu_edit_backups` (a list, newest last, at most 10 entries, each
-naming the backup file and the metadata it replaces).
+The undo stack lives in post meta `_wpu_edit_backups` (a list, newest last, at most 10 entries; the two
+oldest merge beyond that), each holding the metadata before the edit, the backups of the files it
+overwrote, the `_wp_attachment_backup_sizes` keys it set, and a fingerprint of the state after.
```

**CR-P2-7 (track D, optional): PHP upload limits in the dev stack.** `upload.maxBytes` is 2 MB (PHP's
default `upload_max_filesize`). Real photos are larger; tests of upload and replace with realistic files
would need e.g. 64 MB in the WordPress image's PHP config.

**Changelog lines** for `plugin/CHANGELOG.md` (orchestrator):

```md
- Batch metadata edits, attach and detach (`POST /media/batch`).
- Trash, restore, permanent delete and empty Trash.
- Where-used index for core blocks, featured images, classic content, `[gallery]`, the site logo and
  icon, and Visual Portfolio galleries (`GET|POST /usage`).
- In-place image edits that keep the file's URL, with Undo (10 steps) and Restore original.
- Regenerate sub-sizes and replace a file under the same URL.
```

## 6. Open questions

1. **Animated GIFs** flatten to one frame when edited (as in wp-admin). Refuse edits of animated GIFs
   (415), or let the UI warn?
2. **Sub-size URLs after a replace with a new aspect ratio:** old sub-size files whose dimensions no longer
   exist are deleted, so a post that embedded that exact size shows a broken image. Keep them (stale
   pixels, files that only deleting the item removes) instead?
3. **Visual Portfolio `content_source` / `queryType`** aren't checked, so a gallery switched from images to
   posts still counts its old images as used. Keep erring towards "used"?
4. **`[gallery]` without ids** (the post's attached images) isn't counted. Add it as `shortcode-gallery`
   from `post_parent`?

## 7. Fixes from the final review

An independent `final-reviewer` pass found 12 issues after the first handoff; all are fixed in
`515c924`, each with a regression test (HTTP in `images.spec.ts`, PHP-level in
`images-internals.spec.ts` / `usage-internals.spec.ts`):

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | A failed replace had already dropped the undo stack and the recorded original | Dropped only after the new file is in place | internals: replace with a non-image keeps stack, Restore works |
| 2 | An editor/size failure saved fewer sizes, deleted the old ones, answered 200 | `make_sizes` returns errors (skips only sizes the image is too small for); sizes are staged and swapped in only when all were made; 500 | internals: regenerate without an editor → 500, files unchanged |
| 3 | Regenerate wrote outputs over live sub-size files in place (corrupting hard-linked originals; 404s while running) | Sizes are made from a temporary link of the source; regenerate backs up files the stack still needs into the newest entry; `record_original` copies files that stay in place | HTTP: nothumb edit → regenerate → Restore gives the original thumbnail, every size served; internals: a hard link to a size keeps its bytes |
| 4 | PDF regenerate discarded previews when nothing could render, answered 200 | 415 up front; preview and sizes made under temporary names | HTTP: regenerate twice keeps names; internals: no renderer → 415, metadata and files unchanged |
| 5 | A reconcile pass whose last batch was full (or empty) never ended | Cursor reset when no post is left | internals |
| 6 | Future-dated posts stayed pending forever and made the index stale | `modified_gmt` recorded and compared for equality | internals |
| 7 | Layout images were cached across posts in one request | Cache per post | internals: `vp_images` written after the embedding post |
| 8 | `add_option()` locks weren't atomic; release could drop a taken-over lock | `OptionLock` (`INSERT IGNORE`, token-checked release) | internals |
| 9 | The copy fallback wrote through hard links | `Files::copy_replace()` (temporary copy, rename) | internals |
| 10 | Undo ignored failed renames | Backups and renames checked before any state is saved; 500 `wpu_io_error` | internals: missing backup → 500, stack kept |
| 11 | The stack fingerprint missed wp-admin thumbnail-only edits | Fingerprint includes the sub-size files | internals: `wp_save_image` thumbnail edit ends the stack |
| 12 | Site slots weren't reconciled after a stale mark; a first theme mod was missed | `mark_stale()` resets source 0; `added_option` hooked | internals |

The reviewer also noted that `UsageIndex::step()`, `check_consistency()` and `mark_stale()` have no
caller on this branch until P1's maintenance route is merged; that is expected.

## 8. Branch and commits

`mm/p2` (not pushed):

- `baefbe2` feat(plugin): media batch, trash, usage index and in-place image operations
- `68a8be9` test(plugin): contract tests for media batch, trash, usage and image operations
- `9c60971` fix(plugin): drop the stale original when a replacement needs no scaling
- `62ad199` test(plugin): check that a restored item returns to its FileBird folder
- `634f6dc` docs: P2 spike notes (X2, X3, X7, X10) and handoff
- `515c924` fix(plugin): address the final review of the image engine and usage index
- (this update of the note)
