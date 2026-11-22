# Media manager — Phase 1 research

Research into whether wp-upload could grow from an upload tool into a full, modern alternative to the
WordPress Media Library. It would have a large media grid, an optional drag-resizable FileBird folder
column and a Lightroom-style detail mode: a large preview, a filmstrip in grid order and toggleable
right-side info/edit panels.

This phase answers three questions before any design or implementation work:

1. What do the **WordPress REST API** and **FileBird API** allow, and where are the gaps?
2. What do the **built-in Media Library** and **FileBird UI** offer, so we reach parity?
3. Which proven UX patterns from **pro photo apps and web media managers** should we borrow?

**Start with [`00-synthesis.md`](00-synthesis.md).** It has the capability matrix, the architectural forks,
the UX principles and the decisions needed.

## Documents

| Doc | Track | Contents |
|---|---|---|
| [00-synthesis.md](00-synthesis.md) | — | Capability & gap matrix, forks, contradictions resolved, UX principles, decisions |
| [01-wordpress-rest-api.md](01-wordpress-rest-api.md) | A | `/wp/v2/media` querying, fields, writes, edit/post-process, batch, auth, performance, gaps, companion-plugin sketches |
| [02-filebird-api.md](02-filebird-api.md) | B | FileBird public & internal REST routes, auth, folder filtering, data model, Free vs Pro, integration options |
| [03-wordpress-media-library-ui.md](03-wordpress-media-library-ui.md) | C | Feature inventory of core's Media Library (grid, list, modal, image editor), pain points, parity checklist |
| [04-filebird-ui.md](04-filebird-ui.md) | D | FileBird UI inventory, Pro features, competitor standouts, parity checklist |
| [05-ux-pro-photo-apps.md](05-ux-pro-photo-apps.md) | E | Lightroom Classic/cloud, Capture One, Apple Photos, Bridge, Photo Mechanic, darktable — patterns, keyboard map draft |
| [06-ux-web-media-managers.md](06-ux-web-media-managers.md) | F | Google Photos, Immich, Eagle, Cloudinary, Frame.io and others — grid styles, viewer, inspector, visual style |
| [07-ux-interaction-patterns.md](07-ux-interaction-patterns.md) | G | Web tech for transitions, virtualised grids, image loading, panels, selection, drag-and-drop, URL state; feasibility table |

## Method

- **Baselines:** WordPress 7.1.5 core and FileBird Lite 6.5.9, both read from source (downloaded from
  wordpress.org). FileBird Pro source was not available; Pro claims come from its docs and the Lite UI.
- **No live WordPress site was used.** Claims that need a live test are listed in the synthesis.
- **Confidence tags** on each claim:
  - **[source]**: verified in code, with file:line references;
  - **[docs]**: official documentation;
  - **[observed]**: tutorials or product observation;
  - **[assumption]**.
- **Blocked sites:** some vendor help sites (Adobe, Capture One, Bynder, one Google page) block automated
  fetches. Those facts come from search extracts and tutorials, and the docs say so where it applies.
- **Versions:** library versions and dates are as of 2026-11-22.

## Status

- Phase 1 (research): this folder.
- Phase 2 (planned): design system and visual designs of the intended interaction, before any
  implementation.
- All work lives on the `feature/media-manager` branch and is not merged to `master`.
