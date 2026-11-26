# Track A4 (M3): inspector — handoff

Branch `mm/a4`, from `feature/media-manager` @ fc9999d. Scope: [A4.md](A4.md), [M3-wave-A.md](M3-wave-A.md).
Three helper agents (high effort) built the Usage panel (`features/inspector/usage/`), the item sections
and actions (`features/inspector/info/`) and most of the wave-A component tests. The track owner built the
rest, reviewed and adjusted the helpers' work (bundle, a11y, flakiness) and committed it.

## 1. What works

From the repo root:

```sh
npm ci
npm run check                                  # Biome: clean
npm run typecheck -w client -w e2e             # clean
npm run test -w client                         # 66 files, 849 tests (see §4 for a flaky reload)
node client/scripts/bundle-budget.mjs          # initial chunk 146.77 kB of 150
dev/run test plugin-static
dev/run up test && dev/run seed small && dev/run test e2e-mock e2e-live
npm run dev:mock -w client                     # http://localhost:5173/?view=library
```

Everything is in `client/src/media-manager/features/inspector/`, plus `core/data/inspector.ts`
(per-track file) and `e2e/{mock,live}/a4.spec.ts`.

1. **Rail** (`index.tsx`, initial chunk):
   - Info, Edit image and Usage. Clicking the active tab collapses the panel, `I` toggles it (core), and `E`
     (`inspector.edit-image`, now implemented) opens the Edit tab or collapses it.
   - Badges: a warn dot on Info while the item lacks alt text; the usage count on Usage (from the full
     item's `usageCount`, drawn with CSS `attr()` so it isn't part of the button's visible label); an
     accent dot on Edit while `editUnsaved` is set.
   - The tab names say what the badges mean ("Usage (used in 3 places)").
2. **Info for 0 items** (`Summary.tsx`):
   - the folder name; "Nothing selected · N items in view";
   - stats from the facets: items, total size, missing alt text (a button that sets `?alt=missing`) and
     not used anywhere (flagged when the usage index is incomplete);
   - alt-text coverage of the folder (`facets.folder`) with a meter and **Start alt-text pass**, or "Every
     image here has alt text";
   - the type breakdown of the view;
   - "You can edit N of M items here — the ones you uploaded." when `editable < total`.
3. **Info for 1 item** (`InfoPanel.tsx`, `MetaField.tsx`, `info/`):
   - Preview in grid mode only, with an Open button (= Enter) and an Edited badge.
   - Title, Alt text (image-like only), Caption and Description, all autosaving. Caption and Description
     wait for the full item and are multi-line (Enter is a line break; Ctrl/Cmd+Enter commits).
   - File (folder path, uploaded on/by, edited, attached to with Detach / Attach…, name, type, size,
     dimensions, duration, pages, original with Copy URL for `-scaled`, file URL with Copy), Camera (only
     with EXIF) and Sizes (collapsed by default, count in the header, copy per size). Open state is kept per
     session (sessionStorage).
   - Copy falls back to selecting the URL when the clipboard is unavailable (inspector.md §9).
   - Actions as commands: Edit image (`E`, images only, disabled for an Author with the reason), Download
     (`items.download`) and Delete (`items.delete`). Download and Delete show "Not available yet" until B3
     implements them.
4. **Info for N items** (`BatchPanel.tsx`, `batch.ts`):
   - a strip of up to six thumbnails (+N); clicking one selects only it;
   - "Editing N items" · size · "3 images, 1 other file", and the rule stated once, including D33 ("…, 2 of
     them hidden by the filters");
   - Mixed fields: dashed edge, "Mixed — 3 different values"; an empty field never commits, Mixed or not
     (inspector.md §9: "clear on all" isn't in v1), and shows the items' own value again;
   - Alt text only on image-like items ("Alt text · 4 images"), with the "2 of 4 images have no alt text"
     card and Start alt-text pass;
   - Description with Replace | Append (Append clears the field after the save). The mode is one value in
     the inspector store, read by the toggle and by every commit, so it survives selection changes and what
     shows is what is sent;
   - Enter in Title or Alt text commits to all; Ctrl/Cmd+Enter in any field; blur;
   - commits go through `bulkBatch` (100 per request, D24) with "Saving… 200 / 1,000" above 100 items, and a
     toast "Updated caption on 4 items · Undo" whose Undo sends every item's `previous` back;
   - an Author's mixed selection writes their own items only ("Changes apply to the 5 items you uploaded. 7
     uploaded by others stay as they are."); all foreign → read-only with the lock notice;
   - half-typed batch text is committed to the items it was typed for when the selection moves (§9); a
     commit made while a save runs is sent once it settles (Append sends only the new text);
   - a partial Undo says so: "Couldn't undo: only 3 of 4 items restored (…)";
   - batch Delete hides when none of the loaded items may be deleted;
   - over 1,000 selected: every field shows "Mixed values" and the rule says values and permissions are
     shown for the first 1,000. The alt label says "images only" while some kinds are unknown, and the
     commit first loads unknown kinds (tiles, 100 per request) so alt text reaches every selected image.
5. **Save & next** (`saveNext.ts`, `altPass.ts`):
   - Enter in Title or Alt text of one item saves and moves selection and focus to the next item in
     collection order, same field, caret at the end; Shift+Enter goes back.
   - Grid mode selects the next tile and reveals it; detail mode steps the stage (`?item=` replaced) and D52
     moves the selection.
   - At either end the field nudges (`data-nudge`) and announces "Last/First item in this view" (D34).
   - From Alt text it skips items without alt text (video, documents), so focus always lands in an alt
     field; at the end it announces "Last/First image in this view".
   - The next item is chosen before the save, so a saved item can leave the Missing alt view under the
     cursor. If it has already left, the step starts from its remembered place (`stepFrom`).
   - With the Missing alt filter on, Ctrl/Cmd+Enter in Alt text moves on too.
   - The strip under the alt field (while it is focused or the item lacks alt text) shows "N missing in
     <folder>", the coverage meter, the position "4 / 18" and the key hints.
   - **Start alt-text pass** turns on the filter, selects the first image and focuses its alt field. When an
     alt save (single or batch) empties the filtered view, the filter turns off, the last item stays selected
     with its field focused, and one toast says "Every image in <folder> now has alt text — showing all files
     again". Under a search or type filter the folder may not be done (facets `folder.missingAlt`); then it
     says "Every image in this view now has alt text — the Missing alt filter is off". Only the save that
     turns the filter off toasts, so a run celebrates once.
6. **Usage panel** (`usage/`):
   - One item: "Used in N places", per-post contexts (Featured image, Gallery block, …), title linking to
     the post (`viewUrl`) and "Edit in WordPress" (`editUrl`), the featured-image warning, site-level refs
     (site logo/icon; the Visual Portfolio placeholder with no view link, D44), "Private post" refs without
     links, "and N more" past 200 refs.
   - Attached to: post card with Change… / Detach, or "Not attached" + Attach to…, with the hint.
   - Post picker: published posts only (D21), debounced search, ArrowUp/ArrowDown, Enter, Esc returns focus
     (also through a key layer and from the dialog itself), `data-mm-local-keys`, combobox + listbox roles.
     It is fixed under its button, so no ancestor clips it (the Info panel's File row), and a press on a
     part that can't take focus keeps focus in the search field.
   - The File section's "Attached to" row has one label; after an attach there, focus moves to Detach.
   - Attach and detach show toasts with Undo; batch: "Used in 7 posts · 3 not used anywhere", posts grouped
     with "2 selected items", "N of M attached", Attach N to… and Detach all, with Undo per item.
   - Nothing selected: used / not-used counts for the view.
   - The footnote about what the index can't see, plus "still being built" while it is incomplete.
   - Read-only notice for an Author, and the mixed-selection rule.
7. **Read-only and permissions:** fields are `readonly`, never `disabled`. Offline keeps the M2 rules (D49).
8. **The M2 gap:** "Unsaved changes" in the header now counts typing done during a save
   (`autosave.hasPendingText`).
9. **Edit tab** (`EditPanel.tsx`): a stub the image editor replaces. B1 calls
   `registerEditPanel(Component)` and `setEditUnsaved(bool)`, both exported from `features/inspector`. Until
   then the tab covers nothing selected, several items (Edit “<first image>” selects it), SVG, non-images and
   not-allowed (naming the uploader).

## 2. Tests and gate

- **Component and unit tests** (`npx vitest run src/media-manager/features/inspector` from `client/`): 15
  files, 195 tests, run with `failOnReactWarnings()`. The review fixes (§7) each have a test.
  - `autosave.spec.ts`, `batch.spec.ts`, `folderName.spec.ts`, `format.spec.ts`;
  - `info/{details,sections,clipboard}.spec.ts`, `usage/model.spec.ts`;
  - `inspector.browser.spec.tsx` and `detailMode.browser.spec.tsx` (M2's, updated: Enter in Title/Alt is
    now Save & next, so the old commit-and-stay steps use Ctrl+Enter);
  - `summary.browser.spec.tsx`: summary, rail, Edit stub, single item, alt strip;
  - `batch.browser.spec.tsx`: Mixed, commit and Undo, alt for images only, Append, Author partition, D33,
    the pass ending on a batch save;
  - `saveNext.browser.spec.tsx`: whole app; grid, ends, detail mode, the alt pass in Blog / 2025;
  - `info/info.browser.spec.tsx` and `usage/usage.browser.spec.tsx`.
- **E2E** (`e2e/mock/a4.spec.ts`, `e2e/live/a4.spec.ts`), both colour schemes, axe on each screen.
  - **Mock:**
    - the summary and the alt pass, with the saved image leaving the view;
    - Save & next and Shift+Enter;
    - batch caption and Undo;
    - sections, Usage and `E`;
    - attach from the File section through the picker, focus on Detach, detach and Undo.
  - **Live:**
    - Save & next persisting across a reload;
    - batch caption persisting, then Undo of a second batch;
    - attach and detach through the picker against WordPress: only published posts are offered (D21), the
      attachment survives a reload, Detach and Undo;
    - the Usage panel from the plugin's index.
  - Live tests snapshot the items they change through the app's API, and `afterEach` writes the snapshot
    back, so a failing test doesn't leave the seed changed.
- **Gate results** (Docker available):

| Step | Result |
|---|---|
| `npm run check` | clean |
| `npm run typecheck -w client -w e2e` | clean |
| `npm run test -w client` | 66 files, 861 tests passed with CR-1 applied locally; without it, runs fail 1–4 browser files on the mid-run `react-dom/client` reload (§4), and those files pass when run alone |
| bundle budget | 146.81 kB of 150 (M2: 145.30); the lazy Panel chunk is 25.6 kB |
| `dev/run test plugin-static` | pass |
| `dev/run test e2e-mock` | 41 passed on the last two full runs; see the flake note below |
| `dev/run test e2e-live` | 22 passed |

**Flake note (e2e-mock, not fixed):** after the review fixes, the M2 slice test "edits alt text with
autosave" failed in 2 of 5 full e2e-mock runs, once per colour scheme. It passed 8 of 8 runs on its own
(`--repeat-each 4`) and in the last two full runs. Each failure was on "Saving…" for the Title committed on
blur. The page then had announced "Title saved" but showed the old title, and the alt text was empty again.
That points to an item refetch that started before the PATCH and finished after it, overwriting the saved
snapshot in the cache (core/data's optimistic path). I didn't confirm it; a trace from a failing run would.

The stack was stopped with `dev/run down` (volumes kept).

## 3. Deviations

- **Batch hydration cap:** values and permissions come from the first 1,000 selected items, and the panel
  says so. Larger selections show "Mixed values" in every field. The commit still writes every selected
  item (alt text to every image, kinds loaded first), and the server refuses per item what the user may not
  change. Usage and attach aggregate the first 500 and say so.
- **An empty batch field never commits** (decided: inspector.md §9, "clear on all" isn't in v1).
- **`A` on a non-image** stays unavailable (M2's deviation). inspector.md §4 says it falls back to Title.
- **The post picker** is a plain anchored dropdown, not Mantine's Popover. The Popover moved 2.5 kB gzip into
  the initial chunk, even though only the lazy panel used it.
- **No Visual Portfolio placeholder in the mock data.** Adding one would contradict that item's
  `usageCount` and the facets' `unused` count. The usage browser spec covers it with an MSW override.
- **Inspector-local icons** (`features/inspector/icons.ts`) re-export tabler icons that `core/ui/icons.ts`
  lacks (CR-2).
- **Folder paths** are built twice: `folderName.ts` (summary, toasts) and `info/details.ts` (File section).
  They agree; merge them when convenient.
- **Delete** in the actions passes `{ fromLibrary: true }`, so a button labelled "Delete" never just
  removes from the folder. B3 may decide otherwise.

## 4. Change requests

- **CR-1, `client/vitest.config.ts`: pre-bundle `react-dom/client`.** On this machine most full runs of
  `npm run test -w client` log `dependency optimized: react-dom/client … reloading`. That mid-run reload
  fails whichever browser spec is loading then (grid, detail, toast, noSelect; 1–15 files a run, under
  load). With the include, two full runs in a row passed with no reload. I tried it locally and reverted it.

  ```diff
  -        optimizeDeps: { force: true },
  +        optimizeDeps: { force: true, include: ['react-dom/client'] },
  ```

- **CR-2, `client/src/media-manager/core/ui/icons.ts`:** add these icons, then delete
  `features/inspector/icons.ts` and import from core:

  ```diff
  +  IconAlertCircle as NoticeIcon,
  +  IconChevronDown as ChevronDownIcon,
  +  IconCircleCheck as DoneIcon,
  +  IconCopy as CopyIcon,
  +  IconExternalLink as ExternalLinkIcon,
  +  IconFileText as PostIcon,
  +  IconPlayerPlay as PlayIcon,
  +  IconTrash as DeleteIcon,
  +  IconUnlink as DetachIcon,
  +  IconWorld as SiteIcon,
  ```

- **CR-3, design docs (`interaction-spec.md`, inspector.md §8):** reserve `E` and `A` (group "Edit") as
  inspector.md §11.4 asked. Also note that the `inspector.edit-image` command now belongs to the inspector:
  B1 hooks in through `registerEditPanel`.
- **CR-4, for B1 (no file change):** the Edit tab renders `bridgeStore.editPanel` with `{ ids }` (the
  inspector targets). Report unsaved edits with `setEditUnsaved`. The rail's dot and the header follow it.

## 5. Open questions

1. **Save & next at the end in an alt pass:** at the last item of a filtered view with earlier items left,
   Enter saves, nudges and announces the end. The saved item then leaves the view, and the selection stays
   on it. Should it step back to the previous remaining item instead?
2. **`A` on a non-image:** keep it unavailable, or fall back to Title as inspector.md §4 says?
3. **Batch over 1,000 items:** is "Mixed values" with the note acceptable, or should the panel hydrate
   everything?
4. **The e2e-mock flake** (§2): worth a core/data look at refetch-vs-mutation ordering?

## 6. Commits

- `67e3589` feat: inspector wave A (M3, track A4)
- `c4a8db0` fix: inspector axe names, a lighter post picker, batch alt ends the pass
- `d334b34` test: A4 inspector e2e flows (mock and live)
- `77ddf88` docs: A4 inspector handoff
- `774d71a` fix: inspector review findings (batch mode, picker, Save & next, honesty)
- `3a513ec` test: A4 e2e attach/detach through the picker; live restores in afterEach
- this update (docs)

## 7. Review fixes

An independent review found 1 critical, 3 important and 9 minor issues. All are fixed, each with a test.

| # | Fix | Test |
|---|---|---|
| 1 (critical) | One Replace/Append mode in the store, read by the toggle and the commit; fields keyed by batch; the batch key ignores order | `batch.browser.spec.tsx`: Append, extend the selection, commit sends `appendDescription`; back to Replace sends `set.description` |
| 2 | The File row's dd wraps instead of clipping; the picker is fixed under its button; the row has one "Attached to" label | `summary.browser.spec.tsx` (listbox inside the window, `elementFromPoint` hits it, one label); mock e2e |
| 3 | Save & next from Alt text skips items without alt text | `saveNext.browser.spec.tsx` (Team folder: over the video and back) |
| 4 | A compact attach focuses Detach | `summary.browser.spec.tsx`; mock e2e |
| 5 | The picker has an Esc key layer and handles Esc on the dialog; a press on a non-focusable part keeps focus in the search field | `summary.browser.spec.tsx` |
| 6 | A commit made during a batch save is sent afterwards; Append drops the text already appended (`appendSucceeded`) | `batch.browser.spec.tsx` (write latency, two requests "One." then "Two."); `batch.spec.ts` |
| 7 | Batch Delete hides when no loaded item may be deleted | `batch.browser.spec.tsx` (Author, Site Admin's items) |
| 8 | The completion toast names the folder only when `facets.folder.missingAlt` is 0 | `summary.browser.spec.tsx` (`completionMessage`); the Blog / 2025 pass in `saveNext.browser.spec.tsx` still names the folder |
| 9 | The mixed-selection notice counts `perms.edit`, not `can()` | `batch.browser.spec.tsx` (the notice is unchanged when offline) |
| 10 | Over 1,000: "Mixed values" everywhere, the rule says what was counted, "images only", unknown kinds loaded before alt is written | `batch.browser.spec.tsx` (1,050 items, images filtered out of the view, every image id sent) |
| 11 | A partial Undo rejects with the real count; the Edit stub offers the first image | `batch.browser.spec.tsx` (one item refused on Undo); `summary.browser.spec.tsx` (a video before the image) |
| 12 | An empty batch field never commits (decided) | `batch.browser.spec.tsx` (a shared caption cleared: no request) |
| 13 | Mock and live e2e for attach/detach through the picker; live restores in `afterEach` | `e2e/{mock,live}/a4.spec.ts` |
