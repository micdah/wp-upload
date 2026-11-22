# Screens — walkthrough

Every screen and state of the media manager, in the order of the brief's inventory
([brief.md](brief.md) §5).

- **Images:** the dark theme is shown; each has a `-light.jpg` twin in `screenshots/`. They are produced
  by `scripts/screenshots.mjs` at 1440 × 900.
- **Behaviour:** see [interaction-spec.md](interaction-spec.md) and the area specs in `specs/`.
- **Live:** run `node scripts/serve.mjs` and use the scenario switch in the dev box.

## S1–S2 · Grid and selection

**Grid with the folder column and inspector.** Justified layout and quiet tiles. Missing-alt badges sit on
the photos; the folder tree and the single-item inspector are on either side.

![Grid](screenshots/grid-dark.jpg)

**Multi-select.** Check circles appear on every tile, the toolbar becomes the selection bar, and the
inspector switches to batch editing with "Mixed" values.

![Multi-select](screenshots/multiselect-dark.jpg)

**Square layout** at a smaller density (`L`, `-`): [core-square-layout-dark.jpg](screenshots/core-square-layout-dark.jpg)

## S3 · Folder column (FileBird)

| Screen | Image |
|---|---|
| The tree with counts, All files and Uncategorized | ![](screenshots/folders-tree-dark.jpg) |
| Folder search keeps the ancestors of matches | ![](screenshots/folders-search-dark.jpg) |

Also: [no FileBird at all](screenshots/folders-no-filebird-dark.jpg) ·
[per-user mode notice](screenshots/folders-per-user-dark.jpg) ·
[Pro colours](screenshots/folders-pro-colours-dark.jpg) ·
[Pro folder options](screenshots/folders-pro-options-dark.jpg)

## S4 · Inspector

| Screen | Image |
|---|---|
| Nothing selected: folder summary, alt-text coverage | ![](screenshots/inspector-summary-dark.jpg) |
| One item: fields, then File / Camera / Sizes | ![](screenshots/inspector-single-dark.jpg) |
| Many items: "Editing N items" with Mixed | ![](screenshots/inspector-batch-dark.jpg) |

Also: [file details](screenshots/inspector-file-dark.jpg) ·
[autosave states](screenshots/inspector-autosave-dark.jpg) ·
[batch applied, with Undo](screenshots/inspector-batch-applied-dark.jpg) ·
[Author: read-only](screenshots/inspector-author-dark.jpg)

## S5–S6 · Detail mode

**Detail mode.** The stage, filmstrip in grid order, and the inspector staying in place. Reached from the
grid by the shared-element morph.

![Detail](screenshots/detail-dark.jpg)

| Variant | Image |
|---|---|
| Zoom to 100 % (`Z`), drag to pan | ![](screenshots/core-detail-zoom-dark.jpg) |
| Video: poster and player bar | ![](screenshots/core-detail-video-dark.jpg) |
| Audio card | ![](screenshots/core-detail-audio-dark.jpg) |
| PDF: first-page sheet | ![](screenshots/core-detail-pdf-dark.jpg) |

## S7 · Quick peek (`Space`)

![Quick peek](screenshots/core-peek-dark.jpg)

## S8 · Search, filters, sort

| Screen | Image |
|---|---|
| "+ Filter" menu: size, orientation, months with media | ![](screenshots/core-filter-menu-dark.jpg) |
| Active filters as removable chips | ![](screenshots/core-filters-active-dark.jpg) |
| Sort menu | ![](screenshots/core-sort-menu-dark.jpg) |
| No results | ![](screenshots/core-no-results-dark.jpg) |

## S9 · Organising

| Screen | Image |
|---|---|
| Context menu | ![](screenshots/folders-context-menu-dark.jpg) |
| Dragging the selection onto a folder | ![](screenshots/folders-drop-target-dark.jpg) |
| Move to… dialog (`M`) | ![](screenshots/folders-move-dialog-dark.jpg) |
| Delete folder: subtree explained | ![](screenshots/folders-delete-confirm-dark.jpg) |

Also: [inline rename](screenshots/folders-rename-dark.jpg) ·
[new folder in place](screenshots/folders-new-dark.jpg) ·
[moved, with Undo](screenshots/folders-moved-toast-dark.jpg) ·
[reordering a folder](screenshots/folders-folder-reorder-dark.jpg) ·
[searching the Move to… dialog](screenshots/folders-move-search-dark.jpg)

## S10 · Alt-text pass ("Save & next")

| Screen | Image |
|---|---|
| Start the pass from the summary or the Missing-alt filter | ![](screenshots/inspector-alt-pass-dark.jpg) |
| `Enter` saves and moves to the next item, keeping focus in the field | ![](screenshots/inspector-save-next-dark.jpg) |

## S11 · Image editing (in place) and usage

| Screen | Image |
|---|---|
| Crop canvas and edit panel | ![](screenshots/inspector-edit-dark.jpg) |
| Saving | ![](screenshots/inspector-edit-saving-dark.jpg) |
| Where used | ![](screenshots/inspector-usage-dark.jpg) |

Also: [items that can't be edited (PDF)](screenshots/inspector-edit-pdf-dark.jpg) ·
[multiple items](screenshots/inspector-edit-multi-dark.jpg) ·
[attach to a post](screenshots/inspector-attach-dark.jpg)

## S12 · Upload

| Screen | Image |
|---|---|
| Dropping files anywhere names the destination | ![](screenshots/system-upload-drop-dark.jpg) |
| Tiles appear at once with progress; the tray | ![](screenshots/system-upload-progress-dark.jpg) |
| A failed upload with Retry | ![](screenshots/system-upload-error-dark.jpg) |

Also: [processing thumbnails](screenshots/system-upload-processing-dark.jpg)

## S13 · Delete and trash

| Screen | Image |
|---|---|
| In a folder: Delete removes from the folder, with Undo | ![](screenshots/system-delete-remove-folder-dark.jpg) |
| Permanent delete: where used, featured images | ![](screenshots/system-delete-confirm-dark.jpg) |
| With `MEDIA_TRASH`: the Trash view | ![](screenshots/system-delete-trash-view-dark.jpg) |

Also: [the Delete menu in a folder](screenshots/system-delete-folder-menu-dark.jpg) ·
[moved to trash, with Undo](screenshots/system-delete-trash-toast-dark.jpg)

## S14–S15 · System states

| Screen | Image |
|---|---|
| Companion plugin missing: onboarding | ![](screenshots/system-states-no-plugin-dark.jpg) |
| WordPress unreachable | ![](screenshots/system-states-offline-dark.jpg) |
| Loading | ![](screenshots/system-states-loading-dark.jpg) |
| Empty library | ![](screenshots/system-states-empty-dark.jpg) |

Also: [Author role banner](screenshots/system-states-author-dark.jpg) ·
[empty folder](screenshots/core-empty-folder-dark.jpg) ·
[core loading skeleton](screenshots/core-loading-dark.jpg) ·
[core empty library](screenshots/core-empty-library-dark.jpg)

## S16 · Shortcuts and command palette

| Screen | Image |
|---|---|
| `?`: every shortcut, built from the live keymap | ![](screenshots/system-shortcuts-sheet-dark.jpg) |
| `Ctrl/Cmd+K`: the command palette | ![](screenshots/system-shortcuts-palette-dark.jpg) |

## S17 · Tablet and phone

| Screen | Image |
|---|---|
| Tablet: grid | ![](screenshots/system-tablet-grid-dark.jpg) |
| Phone: grid | ![](screenshots/system-phone-grid-dark.jpg) |
| Phone: detail with swipe | ![](screenshots/system-phone-detail-dark.jpg) |

Also: [tablet inspector](screenshots/system-tablet-inspector-dark.jpg) ·
[phone folders drawer](screenshots/system-phone-folders-dark.jpg) ·
[phone selection](screenshots/system-phone-selection-dark.jpg) ·
[phone info sheet](screenshots/system-phone-info-dark.jpg)

## Design system

The full component and token reference: [design-system.md](design-system.md) and
[`system-dark.jpg`](screenshots/system-dark.jpg) / [`system-light.jpg`](screenshots/system-light.jpg).
