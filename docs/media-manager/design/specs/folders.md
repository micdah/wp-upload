# Spec — Folders & organising

Behaviour of the FileBird folder column and every way of organising media into folders: screens S3 and
S9 in the [brief](../brief.md). The clickable version is the prototype (`?scenario=` switches site
situations); screenshots are `screenshots/folders-*-dark|light.jpg`.

| Code | What it holds |
|---|---|
| `prototype/js/folders.js` | Column shell, tree rendering, search, keyboard navigation, options menu, resize and collapse |
| `prototype/js/features/folders-model.js` | Scenario flags, per-user preferences, counts, sorting, every mutation |
| `prototype/js/features/folders-ops.js` | Create and rename in place, delete, context menu, Pro colours, keys, bus actions |
| `prototype/js/features/folders-dnd.js` | Drag media to folders, drag folders to nest or reorder, drag preview |
| `prototype/js/features/folders-move.js` | The "Move to…" dialog and the shared move helpers (toast with Undo) |
| `prototype/css/features/folders.css` | Styles beyond the design system, tokens only |
| `scripts/shots/folders.mjs` | Screenshots and interaction checks |

## 1. Data model (from FileBird)

- A file sits in **at most one folder**. Moving a file replaces its folder. Folder `0` is
  **Uncategorized** (no folder). **All files** is a view, not a folder: it can't be a move target.
- Folders nest without a depth limit. Sibling order is a manual `order` (FileBird's `ord`).
- Deleting a folder deletes its **whole subtree**. Their files fall back to Uncategorized. No media is
  ever deleted.
- A duplicate name among siblings is auto-suffixed, case-insensitively: `Blog` → `Blog (1)` →
  `Blog (2)`. Names are trimmed, whitespace is collapsed, and the maximum is 200 characters.
- **Pro only** (shown only when FileBird Pro is detected, never as an upsell): folder colours and
  sorting folders by name.

## 2. The column

**Anatomy, top to bottom:**

1. Header (40 px, aligned with the filter bar): the `FOLDERS` label, then icon buttons:
   - **New folder** (`N`);
   - **Folder options** (`⋯`): Expand all, Collapse all, the count mode, and, with Pro only, the folder
     sort;
   - **Hide folders** (`F`).
2. **Find folder** search box.
3. The per-user notice, in that scenario only (§9).
4. The tree:
   - All files and Uncategorized, each with its count;
   - a separator;
   - the folder tree.

**Rows:**

- A row shows a twisty, a folder icon (open when expanded), the name (ellipsis with a tooltip) and a
  count in mono.
- Uncategorized has a muted icon.
- Row states: rest, hover, current (accent tint and leading bar), keyboard focus (ring), drop target,
  reorder line, inline name input, menu open (pressed tone), drag source (dimmed), and "just changed"
  (a single accent flash, which is off under reduced motion).

**Counts:**

- *Count files in the folder only* (default) or *Count files in subfolders too*, both FileBird modes,
  from the `⋯` menu.
- The choice is a per-user preference (FileBird keeps it per WordPress user), kept in local storage in
  the prototype.
- Counts are computed from the data and update at once after any move, delete, upload or undo.
- All files and Uncategorized always count directly.

**Width and visibility:**

- The column is 280 px by default. Drag the edge to resize it (220–480 px, remembered). The resizer is
  also keyboard-resizable with ←/→ in 16 px steps.
- Double-click the resizer, press `F` or use the header button to hide the column. The grid column
  animates to 0 while the content fades out (150 ms), so nothing looks clipped.
- A hidden column is `inert`: it takes no Tab stops, and focus inside it moves to the grid.
- The column never re-flows its content while animating, because the inner width stays fixed.

## 3. Navigation and keyboard

The tree is an ARIA `tree` with a roving tabindex. One row is a Tab stop: the last focused row, else
the current folder.

| Key (focus in the tree) | Action |
|---|---|
| `↑` / `↓`, `Home` / `End` | Previous / next visible row, first / last row |
| `→` | Expands a closed folder; on an open folder, moves to its first child |
| `←` | Collapses an open folder; otherwise moves to the parent |
| `Enter` / `Space` / click | Opens the folder (filters the grid, clears the selection, updates `?folder=`) |
| `Delete` / `Backspace` | Deletes the focused folder, with a confirm |
| `N` | New subfolder of the focused folder |
| `R` | Renames the focused folder |
| `M` | Moves the focused folder ("Move to…" in folder mode) |
| `ContextMenu` key / right-click | Folder context menu |

**Global keys** (all `event.key`, layout-safe on US + DK keyboards; registered with `registerBindings`
under the "Folders" group, so the `?` sheet lists them):

| Key | Mode | Action |
|---|---|---|
| `N` | grid | New folder inside the folder you're viewing (top level from All files / Uncategorized) |
| `R` | grid | Rename the folder you're viewing |
| `M` | any | Move the selection, or the focused item, to a folder… (also in detail mode) |
| `ContextMenu` | grid | Context menu of the folder you're viewing |
| `F` | any | Show / hide the column (existing binding; with no FileBird it explains instead) |

- Keys typed in the search box or in a name input never trigger shortcuts.
- `Esc` in the search box clears it first; a second `Esc` leaves the field.
- `↓` from the search box jumps into the tree, and `Enter` opens the first match.
- `Shift+F10` and `F2` are deliberately not used (F-keys are out, brief §7). Double-click is the pointer
  rename.

## 4. Create and rename (in place)

**Create:**

- Triggers: `N`, the header button, the empty-tree button, or the context menu's **New subfolder**
  (or **New folder** on All files / Uncategorized).
- The parent is the focused folder, else the viewed folder, else the top level. FileBird does the same:
  "under the selected folder".
- An input row appears as the parent's last child. The parent and its ancestors expand, and the folder
  search is cleared so the row is visible.
- `Enter`, or moving focus away, creates the folder. An empty name or `Esc` cancels. Only one name
  input exists at a time: starting another saves the first.
- The new folder flashes once and takes focus. The view does **not** switch to it, so you can keep
  creating.
- If the name was taken, a toast says "A folder named “Logos” is already there, so this one is
  “Logos (1)”".

**Rename:**

- Triggers: double-click the name, `R`, or the context menu.
- The name becomes an input with the text selected. `Enter` or leaving the field saves; `Esc` restores
  the name; an unchanged name is a no-op.
- The toast reads "Renamed to “X”", with **Undo**. A taken name is auto-suffixed and the toast says so.
- The breadcrumb, inspector and Move dialog pick up the new name at once.

## 5. Delete

- Triggers: the context menu's **Delete folder**, or `Delete` / `Backspace` on a focused row.
- A confirm dialog (danger), worded from the real numbers:
  - title: "Delete “Blog” and 3 subfolders?";
  - text: "“Blog” and its 3 subfolders will be deleted. The 25 files in them move to Uncategorized.
    No media is deleted.";
  - notice: "Deleted folders can’t be restored.";
  - button: "Delete 4 folders" (or "Delete folder").
- If you were inside the deleted subtree, the view switches to Uncategorized, as in FileBird.
- The toast reads "Deleted “Blog” · 25 files moved to Uncategorized". It has no Undo: FileBird can't
  restore a folder's id. The companion plugin could add a restore; see §10.

## 6. Drag and drop

**Media onto a folder:**

- Tiles in the grid and the filmstrip are draggable. Dragging a *selected* tile carries the whole
  selection, in collection order. Dragging an unselected tile carries just that tile, and the
  selection is left alone.
- The native drag image is replaced by an in-page **preview** that follows the pointer:
  - up to three stacked thumbnails;
  - "Move 3 items";
  - a target line: "Drop on a folder", "to “Press kit”" (accent), or "All files isn’t a folder"
    (danger).
- Dragged tiles dim in place.
- Rows highlight as drop targets (`.is-drop-target`). Uncategorized is a valid target, meaning "remove
  from folder". All files is not.
- Hovering a closed folder for 700 ms expands it. Near the top or bottom edge, the tree auto-scrolls.
- On drop, the items move and the counts update. The toast reads "Moved 3 items to “Press kit”" (or
  "to Uncategorized") with **Undo**, which restores each item's previous folder. If every item was
  already there, the toast says "Already in “X”".
- Drags from the desktop (`Files`) are not handled here; they belong to the upload overlay.

**Folders in the tree:**

- Every real folder row is draggable when editing is allowed.
- **Middle of a row:** nest the folder inside it.
- **Top or bottom quarter:** reorder before or after it, as a sibling. A line indicator in the
  selection-ring colour shows this (≥ 3:1).
- The bottom edge of an *open* folder means "inside", because the line would sit above its first
  child.
- **Empty tree area:** move to the top level.
- Invalid targets show the reason in the preview and refuse the drop: into itself or its own subtree,
  or onto All files / Uncategorized.
- With Pro sorting by name, there is no manual order, so only "inside" is offered.
- The toast reads "Moved “Team” into “Brand”" (or "to the top level") with **Undo**, which restores
  the whole tree's parent and order snapshot.

## 7. Move to… (keyboard and touch)

- Triggers:
  - `M`;
  - the bus action `move-to-folder`: the selection bar, the inspector button and the detail "⋯" menu
    already emit it;
  - the folder context menu's **Move to…**, in folder mode.
- A dialog, not a popover, so it works the same from the toolbar, the inspector and a phone sheet:
  - title: "Move 3 items" or "Move “photo-name”";
  - subtitle: where the items are now, plus the one-folder rule;
  - a combobox search box with a listbox of folders.
- **List content:**
  - Uncategorized (or **Top level** in folder mode);
  - **Recent** (up to 3 folders used this session);
  - every folder, indented by depth, with Pro colours.
- **While searching,** the list is flat and each match shows its path ("2025 · Blog"). The last option
  is **Create folder “query”** when no folder has that exact name: it creates a top-level folder and
  moves into it.
- **Current folder:** when every item already sits in one folder, that option is marked *Current* and
  can't be chosen. In folder mode, the folder's current parent is marked, and the folder itself and its
  subtree are left out.
- **Keys:**
  - `↑`/`↓` move the active option, skipping disabled ones;
  - `Enter` or **Move here** moves;
  - double-click moves;
  - `Esc`, Cancel, or a click on the scrim closes.
- Focus returns to where it was. The result is the same toast with Undo as for drag and drop.
- **Focus after moving:** when moved items leave the folder being viewed, they leave the selection, and
  focus moves to the next remaining item. So `M`, `Enter`, `M`… works as a triage flow. In detail mode,
  the stage shows that neighbour, or returns to the grid if the folder is now empty.

## 8. Folder search

- Client-side and case-insensitive. Matching folders and **all their ancestors** stay visible, shown
  expanded for the duration of the search; your saved expansion is untouched.
- The matched text is marked. All files and Uncategorized hide while searching.
- With no match, the tree shows "No folders match “x”" and a **Clear search** button.
- The match count is announced politely.
- A large tree may need server-side search (FileBird's `get-folders?search=`). The UI stays the same.

## 9. Scenarios

| Scenario | Behaviour |
|---|---|
| `normal` | Everything above. Manual folder order, no colours |
| `pro` | Folder colours tint the icon (outline plus a faint fill), in the tree, the Move dialog and the drag preview. Context menu **Colour…** opens a swatch popover: 9 colours plus No colour; ←/→ walk the swatches. `⋯` adds Sort folders: manual order / name A–Z / name Z–A (natural sort, per-user pref) |
| `per-user` | A warn notice at the top of the column: "Per-user folders aren’t supported. FileBird gives each user their own folders, so you see only this account’s folders, read-only. Turn off “Each user has his own folders” in FileBird to organise media here." Browsing works. New, rename, delete, drag, Move to… and context menus are off, and each trigger says why in a toast |
| `no-filebird` (and `no-plugin`) | No column and no folder UI. The grid takes the space, and N/R/M aren't registered (nor listed in `?`). `F` and any `move-to-folder` / `new-folder` / `remove-from-folder` action show "Folders need the FileBird plugin on your WordPress site." |
| `offline` | Folder changes are refused with "WordPress can’t be reached, so folder changes can’t be saved right now."; browsing works |

## 10. What the companion plugin / server must provide

> **Superseded by the contracts.** The `fbv_folder` field and `/wp/v2/media?fbv=` listing are replaced by `wpu.folder` and the plugin's `/collection`; folder routes are the plugin's `wp-upload/v1/folders` (no `filebird/v1`, D2). The binding definitions are in
> [plugin-api.md](../../contracts/plugin-api.md) and [server-api.md](../../contracts/server-api.md); this
> section is kept for the design rationale.

| Need | Why | FileBird today |
|---|---|---|
| Tree with id, name, parent, order, colour (Pro), in one call | Render the column | `filebird/v1/get-folders` (`tree`) |
| Direct counts per folder plus All and Uncategorized | Counts; nested counts are summed client-side | `get-folders` (`attachmentsCount.actual`, `allAttachmentsCount`) |
| Folder id on every media item | Move dialog "Current", inspector folder, Undo of a move | **Missing**: needs the mu-plugin REST field `fbv_folder` |
| `GET /wp/v2/media?fbv=<id\|0>` with paging and sort | The grid per folder, including Uncategorized | mu-plugin query param (FileBird's own query filter does the rest) |
| Create `{name, parent}` → returns the **final** name | The auto-suffix toast | `new-folder` (auto-renames) |
| Rename `{id, name}` → the final name, auto-suffixed instead of failing | Same toast; today a duplicate returns HTTP 500 `folder_name_exist` | `update-folder`; the server should map that error or suffix itself |
| Move/reorder `{id, parent, before\|after\|index}` | DnD reparent and reorder, Move to… for folders | `update-folder-ord` (`dropPosition`), cycle-checked |
| Bulk assign `{folder, ids[]}` atomically, returning fresh counts | DnD and Move to…; Undo is a second assign per original folder | `assign-folder` |
| Delete `{id}` recursive, returning the moved-file count | Confirm wording and toast | `delete-folder`; the count comes from the counts diff |
| Colour `{id, color\|null}` and sort-folders pref | Pro features, only if Pro is detected | `update-folder-color`, `get-folders?orderby=name` |
| Detect FileBird, its **Pro** licence and **per-user mode** | Scenarios above | Detect `filebird/v1` in `/wp-json/`; Pro and `USER_MODE` need the mu-plugin to report them. *Amended (D15/D17, [implementation plan](../../implementation-plan.md) §0): the companion plugin reports them; Pro features are detection-gated and mock-tested only (no licence), and colours are written only through FileBird's own colour function* |
| Per-user prefs (count mode, folder sort) | FileBird stores them per WP user | `set-user-settings` writes to user 0 with an app password; store them in our app instead |
| (Optional) restore a deleted subtree | Would allow Undo on delete | Not in FileBird; a backup restore is coarse |

## 11. Edge cases

- **Deleting the folder you're in,** or one of its ancestors, lands you in Uncategorized with the
  selection cleared.
- **Moving the item shown in detail mode** out of the viewed folder steps to its neighbour. If none is
  left, the view returns to the grid.
- **Undo after further changes:** item Undo restores each item's previous folder. Folder-move Undo
  restores the snapshot taken at that move, so later reorders in between are rolled back too. That is
  acceptable for a 5-second toast.
- **Hidden folders:** a rename or new-folder target that's hidden in a collapsed branch or behind a
  search is revealed first.
- **Re-renders during editing** (e.g. a count changing) keep the half-typed name, the caret and the
  focus.
- **Long names** truncate with a tooltip. The rename input scrolls. A name is capped at 200 characters.
- **Long trees** scroll independently, and the drag edge auto-scrolls. Rows are not virtualised in the
  prototype; production should virtualise beyond a few hundred rows (a known FileBird complaint).
- **Tablet (< 900 px):** the column is the overlay drawer from `layout.css`. Every operation is reachable
  without drag, through the context menu, `M` and the Move dialog.

## 12. Requests to core

1. **Trash row in the tree (Agent C):** `system-delete.js` re-injects its Trash row through a
   MutationObserver on `#folders` childList. The column now renders its shell once and replaces only
   `#folder-tree`'s content, so that observer no longer fires. Please re-add the row on the new bus
   event `mm:folders-rendered` (`on('folders-rendered', …)`, `detail.tree`) instead. Give the row
   `data-folder="trash"` only if it should join arrow-key navigation; today navigation skips it.
2. **Toolbar (`toolbar.js`):** with no FileBird, omit the "Folders" panel toggle and the selection
   bar's **Move to folder** button. Both currently fall back to an explanatory toast.
3. **`ui.js` `openMenu`:** support `checked` (render `role="menuitemradio"` with `aria-checked`) and
   `disabled` items. The options menu currently signals radio state with circle / circle-check icons
   only.
4. **`ui.js` `openMenu`:** restore focus to the opener when the menu closes with `Esc`.
   `folders.js#returnFocusOnEscape` patches this for folder menus.
5. **`components.css` `.tree__row.is-drop-target`:** in light theme, the 1.5 px `--accent` ring
   (cyan-500 on white) is about 1.7:1. Consider `--select-ring` for the ring, which is ≥ 3:1 in both
   themes, keeping the accent tint.
6. **Grid tile context menu:** if core adds a media context menu on tiles, its `ContextMenu` binding
   should take precedence when focus is on a tile. The folder binding is registered for grid mode and
   only acts on the folder you're viewing.
7. **Folder state should be read live:** other features that show folder names or counts should read
   them through `folders-model.js` (`folderName`, `folderCount`) or `library.folders`, not the
   pre-computed `folder.count` from the sample data. Counts are computed live.
8. **Collapsed column while dragging:** consider opening the folder drawer when a media drag nears the
   left window edge while the column is hidden. Today the column must be open to drop.
