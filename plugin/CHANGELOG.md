# wp-upload companion plugin: changelog

The plugin follows semver (`WPU_VERSION`), and its REST contract has its own level (`WPU_API`). See
[the implementation plan](../docs/media-manager/implementation-plan.md) §2.6 for the update policy:
changes within a major are additive, and updates should be rare because users install them by hand.

Release headings read `## 1.0.0 (2026-12-01)` (or `## 1.0.0 - 2026-12-01`), with `- ` items:
`plugin/scripts/build.mjs` turns those sections into the zip's `changelog.json` and skips
"Unreleased".

## Unreleased

- 1.0.0-dev.4: fixes from the M1 review.
- `sizesPending` counts only sizes the attached file itself is large enough for, so an edited
  `-scaled` image no longer stays "Processing".
- The media index stores each attachment's `post_modified_gmt` (schema 2): future-dated items no
  longer keep it stale. Maintenance steps work in small sub-batches that save their cursor, and large
  PDFs are read only at both ends for their page count.
- The maintenance and schema locks are released only by their holder; the rev option is recreated
  without recursion; deactivating over REST marks the index stale.
- `GET /trash` counts only what the user may see; a no-op folder assign doesn't bump the rev; every
  id list and number is parsed the same way (JSON integers, duplicates dropped).
- 1.0.0-dev.3: the write side (track P2).
- Batch metadata edits, attach and detach (`POST /media/batch`).
- Trash, restore, permanent delete and empty Trash.
- Where-used index for core blocks, featured images, classic content, `[gallery]`, the site logo and
  icon, and Visual Portfolio galleries (`GET|POST /usage`).
- In-place image edits that keep the file's URL, with Undo (10 steps) and Restore original.
- Regenerate sub-sizes and replace a file under the same URL.
- 1.0.0-dev.2: the read side (track P1).
- `GET /info`, `GET /rev`, `GET /collection`, `GET /facets`, the folder routes
  (`GET/POST/PATCH/DELETE /folders`, `POST /folders/assign`) and `POST /maintenance/step` work.
- The `wpu` field on `/wp/v2/media` (track P2's keys are stubs).
- New table `wp_wpu_media_index`, built by maintenance steps and kept current by hooks.
- Works as a regular plugin and as a mu-plugin from one built file.
- Logs why it registers no routes when PHP or WordPress is below the minimum.
- 1.0.0-dev.1: scaffold. Every `wp-upload/v1` route is registered and answers 501
  `wpu_not_implemented`.
