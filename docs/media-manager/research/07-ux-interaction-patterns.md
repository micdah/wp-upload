# 07 — UX interaction patterns and the web tech behind them

Track G of the media-manager research. **Research only: this document makes no stack decision.** It lists options, how feasible they are, and the traps to avoid. Library versions and dates come from the npm registry as of 2026-11-22. Bundle sizes are bundlephobia min+gzip figures unless noted.

Confidence markers:

- **[docs]**: official documentation, specs, or vendor blog posts.
- **[source]**: npm registry metadata, changelogs, or code.
- **[assumption]**: my own reasoning or experience, not verified for this project.

---

## Summary

1. **Everything on the wish list is feasible on the web in late 2026.** Most items are well-trodden. The two things that need real engineering are the shared-element grid↔detail transition combined with virtualization, and a justified (aspect-preserving) layout over 10k+ paged items. Both have proven approaches: Google Photos, Immich, and React 19.3 `<ViewTransition>`.
2. **The current React 18 + Mantine 8 base is the main constraint, not the browser.** *(Status: resolved — #48 upgraded `master` to React 19.3.1 + Mantine 9.8.2 + Vite 8.3.8.)*
   - Mantine 8's last release was 8.3.18 on 2026-03-17. Mantine 9 (from 2026-03-31) requires React ≥ 19.2 [source].
   - The Mantine `Tree` features that matter here are 9.x only: drag-and-drop, async children, and virtualization helpers [docs].
   - React's stable `<ViewTransition>` arrived in React 19.3 (2026-09-09), and `<Activity>` in 19.2 [docs].
   - Several candidate libraries now require React 19: `@viselect/react` (≥ 19), `react-router` 8 (≥ 19.2.7) [source].
   - **Practically, any serious build of this feature should begin with a React 19.3 + Mantine 9 upgrade.**
3. **Grid↔detail:** render detail mode as an overlay above a still-mounted, `inert` grid. This removes the "restore scroll position" problem entirely. Animate the clicked cell into the large preview with same-document View Transitions, which are Baseline since Firefox 144 (Oct 2025) [docs]. Assign a `view-transition-name` only to the one cell involved. Fall back to Motion `layoutId` or a hand-rolled FLIP if needed.
4. **Grid layout:** a uniform (square or fixed-ratio) grid can be virtualized exactly from `X-WP-Total` alone and supports random-access paging and a scrubber from day one.
   - A justified layout needs each item's aspect ratio before layout. That requires either a server-side "layout index" (id + width + height for the whole filtered set), or the Google Photos estimate-then-correct technique [docs].
   - Recommended path: square first, justified as a later toggle.
5. **Data loading:** use page-addressed TanStack Query queries (`['media', filter, page]`), fetched for the pages that intersect the viewport. `useInfiniteQuery` alone is not enough: it loads pages sequentially and cannot jump to the end via a scrubber [assumption]. WP caps `per_page` at 100 and returns `X-WP-Total`/`X-WP-TotalPages` [docs].
6. **Images:** pick the WP sub-size from cell px × DPR. Set an explicit `sizes` (we know the cell width). Show dominant-colour or ThumbHash placeholders computed server-side (sharp + cache), or read `dominant_color` from the WP Performance Team's *Image Placeholders* plugin if it is installed [docs/assumption]. In detail mode, preload the neighbours.
7. **Selection and drag-and-drop:**
   - Compute marquee selection mathematically from the layout model, not from the DOM, because virtualized cells don't exist off-screen.
   - Model "select all" as *all matching the filter minus exclusions*.
   - For DnD, Pragmatic drag and drop (Atlassian) handles native file drops, tree hitboxes, and custom drag previews with counts. dnd-kit's new `@dnd-kit/react` is still 0.x.
8. **URL state:** keep state in **query parameters** (`?folder=…&item=…&view=detail`), not path segments. The app builds with Vite `base: './'` and runs under an unknown sub-path, so path-based routes would break relative asset URLs unless the server injects a `<base href>` [source: `client/vite.config.ts`, `server/src/app.ts`]. Push one history entry when entering detail, and *replace* it when stepping between items, so Back returns to the grid.
9. **Theming:** imagery needs a **neutral** (achromatic) dark UI, as in Lightroom and Photos apps. The current cyberpunk blue-black `dark` tuple in `client/src/theme.ts` would tint perception of photos. Keep the neon accent for focus and selection only [assumption].

---

## 1. Grid → detail shared-element transition

### UX pattern and best-practice behaviour

- A click, Enter, or Space on a cell morphs the thumbnail into the large preview. The rest of the grid fades or dims. The filmstrip and panels slide in.
- Going back (Esc, Back button, or a "grid" key such as `G` in Lightroom) morphs the *currently shown* item back to *its* cell. That may not be the cell you opened if you navigated in detail mode. The grid must scroll so that cell is visible **before** the animation [assumption].
- Duration around 200–300 ms with ease-out. Interruptible, or at least short enough not to block. No animation under `prefers-reduced-motion: reduce`; use a crossfade or an instant cut [docs: MDN `prefers-reduced-motion`].
- Aspect-ratio change: the grid cell is often a square crop (`object-fit: cover`) while detail is `contain`. A good morph animates the clip, not a stretch [assumption].

### Approaches

**A. View Transitions API, same-document** [docs]

- Use `document.startViewTransition(update)`. Give the source cell's `<img>` and the detail `<img>` the same `view-transition-name` (for example `media-hero`) at snapshot time.
- **Only one element should carry that name at a time.** Set it dynamically on the clicked cell just before starting the transition. Never give all 10k cells names: names must be unique, and every named element costs a snapshot.
- `view-transition-name: match-element` (Chrome 137, Firefox 144, Safari 18.4) auto-generates names but is not useful for a cross-component morph [docs].
- Browser support:
  - Same-document VT is **Baseline Newly available** since Firefox 144 (2025-10-14). Chrome has had it since 111 and Safari since 18 [docs].
  - Firefox's first release lacks *view transition types*.
  - `view-transition-class` is in Chrome, Firefox 144, and Safari [docs].
- Element-scoped transitions (`element.startViewTransition()`) shipped in **Chrome 147 only** (2026-03). They avoid blocking the whole document's input and allow concurrent or nested transitions. Treat them as progressive enhancement [docs].
- Pitfalls:
  - A document-level transition blocks pointer input for its duration [docs].
  - The new state's DOM must be committed synchronously inside the callback. In React 18 that means `flushSync`; in React 19.3, `<ViewTransition>` does this for you.
  - When returning to a virtualized grid, the target cell must be mounted and scrolled into view inside the update callback, or the morph has no destination. Fallback: crossfade.
  - The cover→contain aspect change: style `::view-transition-old/new(media-hero)` with `object-fit` and `height: 100%`, plus `overflow: clip` on `::view-transition-image-pair` [assumption, a common recipe].
  - The large image may not be decoded yet. Show the already-cached thumbnail URL in the detail view first, then swap in the `large` sub-size once `img.decode()` resolves [assumption].

**B. React `<ViewTransition>`, stable in React 19.3 (2026-09-09)** [docs]

- Declarative. An update animates only when it is a Transition: `startTransition`, a `useDeferredValue` update, or a Suspense reveal.
- `<ViewTransition name="media-123">` rendered in the grid cell and later in the detail view gives a **share** animation.
- `addTransitionType('next' | 'prev')` lets filmstrip navigation slide left or right.
- Needs React ≥ 19.3. React's 19.3 post does not describe a fallback for browsers without the API [docs]. Since all evergreen browsers have same-document VT, this is a minor concern.
- Fits well with a router that wraps navigations in `startTransition`. Both TanStack Router and React Router do; React Router has a `viewTransition` option [assumption, verify per router version].

**C. Motion (formerly framer-motion) layout animations** [docs]

- `<motion.img layoutId={id}>` on both the cell and the detail image gives a FLIP-based shared-element animation. It measures layout and animates transforms, so it is interruptible and works with React 18.
- Motion also offers `animateView` / `AnimateView`, a wrapper over the View Transitions API with spring easing. It no longer needs Motion+ [docs].
- `motion` 14.14.0 (2026-11-13) supports React 18/19. The full bundle is about 63 kB gz; `LazyMotion` + `m` cuts this substantially [source].
- Pitfalls: `layoutId` across a virtualized list requires both elements to be mounted. Scale-based FLIP can distort images unless the inner image is counter-scaled; Motion handles this for `layout` but `borderRadius` and cover→contain need care [docs/assumption].

**D. Hand-rolled FLIP with WAAPI** [assumption]

- Measure `getBoundingClientRect()` of the cell and the target. Render the detail view. Animate a fixed-position clone with `element.animate()` (transform + `clip-path: inset()` for the crop).
- About 100 lines, works anywhere, and is fully controllable (interruptible and reversible).
- A good fallback if VT behaviour on the overlay proves fiddly.

### Architecture tip: overlay, don't swap [assumption]

Render detail mode as a full-viewport layer *over* the grid. Keep the grid mounted with `inert` (Baseline since 2023) and `aria-hidden`. Optionally add `content-visibility: hidden` to skip painting while detail is open.

- The grid's scroll position, virtualizer cache, and selection survive for free.
- The return transition has a ready destination.
- React 19.2 `<Activity mode="hidden">` is the alternative. It preserves React state but hides with `display: none`, so DOM scroll offsets of the scroller are not guaranteed to survive. Test before relying on it [docs/assumption].

### Reduced motion

- `@media (prefers-reduced-motion: reduce) { ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; } }`.
- Or skip `startViewTransition` entirely when `matchMedia('(prefers-reduced-motion: reduce)').matches`.
- Motion has `useReducedMotion()` / `MotionConfig reducedMotion="user"` [docs].

---

## 2. Large virtualized grids

### Square vs justified

| | Square or fixed-ratio grid | Justified rows (Flickr / Google Photos) |
|---|---|---|
| Look | Uniform, "contact sheet" (Lightroom Library grid) | Shows true aspect ratios with no cropping; "photo app" feel |
| Layout needs | Only the total count and the container width | Width/height of **every** item before the item's row can be placed |
| Virtualization | Trivial: row height is constant and the index→row math is exact | Variable row heights. Heights of unloaded regions must be estimated, then corrected with scroll anchoring |
| Random access / scrubber | Exact from `X-WP-Total` | Approximate until dimensions are known |
| Keyboard ↑/↓ | Same column, easy | Must pick the "nearest x-centre" item in the adjacent row |
| Non-image items (PDF, video, audio) | Icon tile, fits naturally | Need a nominal ratio (for example 1:1 or 4:3) |

**Recommendation [assumption]:** ship square tiles first, with "cover" vs "contain" in a size slider as Lightroom does. Add justified later behind a toggle, once a dimension index exists (see below).

### Justified layout over 10k paged items

- **Layout algorithm:**
  - `justified-layout` (Flickr): 4.1.0, last published **2021**, about 2 kB. Stable math, but unmaintained [source].
  - `react-photo-album` 3.6.2 (2026-10): rows, columns, and masonry layouts, React 18/19, about 4 kB gz. Not virtualized itself, but its layout functions can be used headlessly [source].
  - Writing the classic "fit row to width at target height" greedy or Knuth-Plass style algorithm is under 100 lines [assumption].
- **Google Photos approach** [docs, via the DEV write-up of the 2018 Google Design article]:
  1. The server sends section metadata (per month: item count) up front.
  2. Each section's height is *estimated* from count × average ratio, which sizes the whole scrollbar.
  3. Sections are attached and detached as they near the viewport.
  4. Once the real items load, the justified layout replaces the estimate. If a height delta occurs *above* the viewport, scrollTop is adjusted by the same delta so nothing jumps.
- **Immich** (open-source Google Photos alternative, Svelte):
  - Month "buckets" with counts from the server.
  - A `TimelineManager`/`VirtualScrollManager` with pre-measured buckets.
  - A Google-Photos-style scrubber driven by per-month data.
  - Justified layout (added 2023; a WASM version was tried and reverted in 2025) [docs: DeepWiki/commit history].
- **For WP specifically** [assumption]:
  - `/wp/v2/media` returns `media_details.width/height` per item, but only for loaded pages.
  - Two options:
    1. **Server-side layout index:** the Express proxy builds and caches `[id, w, h, date, mime]` for the whole filtered set with `per_page=100&_fields=id,media_details,date,mime_type` loops. That is about 100 requests for 10k items, cached and invalidated on mutations. The client can then compute the exact justified layout for everything up front; 10k items of layout math takes milliseconds.
    2. **Estimate-and-correct** per page in the Google Photos style. Track D (WP API) should confirm whether nested `_fields` trimming works on `media_details`.
  - Date grouping: WP sorts by `date` by default, so month headers are easy if the set is date-ordered. With other sort orders, use a flat grid.

### Virtualization libraries (React 18/19)

| Library | Version / date | Size (gz) | Grid capability | Notes |
|---|---|---|---|---|
| **@tanstack/react-virtual** | 3.14.26 (2026-11-03) | ~10 kB | Headless. `lanes`, `horizontal`, `gap`, `scrollMargin`, `rangeExtractor` (sticky headers), `scrollToIndex({align:'center'})`, `initialOffset`, `takeSnapshot()` → `initialMeasurementsCache` for restoration | Most flexible. Virtualize **rows** (a row = N squares, or one justified row) with dynamic `measureElement`. Same lib for the filmstrip (`horizontal: true`) and the folder tree [docs] |
| **react-virtuoso** | 4.18.24 (2026-11-20) | ~20 kB | `VirtuosoGrid` assumes **same-size items**. `Masonry` (separate `@virtuoso.dev/masonry`) for variable heights. `GroupedVirtuoso` for section headers | Batteries included (endReached, initial index, follow), less control over justified rows [docs] |
| **react-window** v2 | 2.5.4 (2026-11-21) | ~8 kB | `List` and `Grid` with function row heights | Rewritten v2 API, React 18/19. Leaner, but still needs known sizes [source] |
| Mantine | — | — | No virtualizer. Mantine 9 `Tree` docs show `@tanstack/react-virtual` integration | [docs] |

**Recommendation [assumption]:** TanStack Virtual as the single virtualization primitive (grid rows, filmstrip, tree), since we own the layout math anyway.

### Scroll restoration when returning from detail

- The overlay approach (§1) makes this a non-issue.
- If detail is a separate route: save `{scrollOffset, snapshot: virtualizer.takeSnapshot()}` keyed by `filter+sort`. Restore via `initialOffset` + `initialMeasurementsCache`, or simply `scrollToIndex(indexOfCurrentItem, {align:'center'})` [docs: TanStack Virtual].
- TanStack Router has `useElementScrollRestoration` + `data-scroll-restoration-id` for custom scroll containers [docs].
- Always ensure the item the user *ended on* in detail mode is visible on return, even if that means not restoring the exact old offset (Google Photos and Lightroom both do this) [assumption].

### Scrubber / fast scroll

- A custom vertical rail: drag maps to a fraction of total height, showing date or month labels (or "item 3 400 / 10 212" for non-date sorts).
- Driven by total count (square grid) or section metadata (justified).
- While the user drags fast, *don't* fetch every page passed through. Debounce page fetches until scrolling settles. `scrollend` is Baseline since Safari 26.2 (Dec 2025); feature-detect `'onscrollend' in window` [docs].
- Show placeholders (dominant colour or neutral) in the meantime.
- Use cheaper thumbnails (`thumbnail` 150px) while scrolling, and upgrade once idle [assumption].
- Hide the native scrollbar on the grid scroller only if the custom scrubber is keyboard- and AT-accessible. Otherwise keep it [assumption].

### Infinite loading with REST pagination and totals

- WP: `per_page` ≤ 100, `page` or `offset`, headers `X-WP-Total` and `X-WP-TotalPages` [docs].
- **Sparse, page-addressed loading** [assumption]:
  1. Create `total` placeholder slots on the first response.
  2. Compute which pages intersect the visible and overscan index range.
  3. Fetch those (`useQueries`), and render loaded items over placeholders.
  - This supports jumping to the middle or end, unlike cursor or `useInfiniteQuery`-only loading.
- Fetch `per_page=100` but use `_fields=` to trim payload size (WP media objects are large).
- Concurrency limit of about 3–4 page fetches. Cancel (AbortSignal) pages that scroll away; TanStack Query passes `signal`.
- Inserts and deletes shift page boundaries (offset pagination drifts). After a mutation, invalidate the affected filter's page queries. Accept brief inconsistency, or re-key by a "dataset version" [assumption].

---

## 3. Progressive image loading

### Choosing WP sub-sizes

- Available: `thumbnail` (150², usually hard-cropped square), `medium` (≤300), `medium_large` (≤768 wide), `large` (≤1024), `-scaled` original (≤2560), plus theme or plugin sizes.
- Rule: needed px = cell CSS px × `devicePixelRatio` (cap DPR at 2 for grids). Choose the smallest size ≥ needed px, otherwise the next larger [assumption].
  - Square grid at 160 CSS px on a 2× screen needs 320 px, so `medium` (which is *not* square-cropped; render it with `object-fit: cover`).
  - `thumbnail` is fine at ≤ 75 CSS px on 2× (filmstrip) or ≤ 150 on 1×.
- Because the cell size is known in JS, set **explicit `sizes="{cellWidth}px"`** with a `srcset` of the available sub-sizes (`url 300w, url 768w, …`) and let the browser pick for DPR [docs: MDN responsive images]. `sizes="auto"` is unnecessary and not yet in Safari stable [docs: caniuse].
- Note: `thumbnail` is a crop. Never use it in detail mode or in justified layouts.
- Original (non-image) mime types have no sub-sizes. PDFs get a generated preview image only if the server's Imagick supports it (WP ≥ 4.7 renders the first page as `media_details.sizes`) [assumption/WP behaviour].

### Loading attributes

- In a virtualized grid, mounted cells are by definition near the viewport. `loading="lazy"` adds little and can *delay* visible tiles. Use eager loading plus the virtualizer's overscan [assumption, consistent with web.dev's "never lazy-load LCP" guidance].
- `decoding="async"` on grid images keeps scrolling smooth [docs].
- `fetchpriority="high"` only on the detail hero image. `low` for neighbour preloads and overscan rows. Using `high` on many images makes it useless [docs: web.dev].
- Cancel offscreen loads: when a cell unmounts, the browser may continue the request. Setting `img.src = ''` on unmount, or relying on HTTP/2 priority, helps somewhat [assumption].

### Placeholders: where would they come from with WP?

| Option | Source | Cost | Notes |
|---|---|---|---|
| Neutral tile or skeleton | none | 0 | Fine baseline on a dark neutral UI |
| **Dominant colour** | WP Performance Team plugin *Image Placeholders* (`dominant-color-images`, v1.3.0, updated 2026-08) stores the dominant colour (and transparency flag) for new uploads. Expected in attachment metadata, therefore `media_details.dominant_color` in REST | 0 runtime | Only for uploads after activation. Field location to verify [docs + assumption]. The older `dominant-color` plugin is stale (2+ years) [docs] |
| **ThumbHash** (preferred) or BlurHash | Computed **server-side** in the Express proxy with `sharp` (0.35.x): decode the 150 px thumbnail, resize to ≤100 px, encode (about 25 bytes). Cache in SQLite or a JSON LRU keyed by `id + modified` | Lazy compute on first listing. 10k thumbnails is a one-off background job | ThumbHash encodes aspect ratio and alpha with better colour than BlurHash [docs]. `thumbhash` 0.1.1 (2023, done/stable, ~2 kB). Decoding on the client to a data URL is cheap; or render as a CSS gradient [source] |
| LQIP (tiny JPEG) | Same pipeline | Bytes ×10 | Usually unnecessary given ThumbHash |

Delivering placeholders: return them as an extra field from the proxy's list endpoint, enriched server-side, so no extra round-trip [assumption].

### Detail mode

- Show the cached grid thumbnail instantly (same URL means it's already in the memory cache), stretched underneath. Load `large` (1024) or `-scaled` (2560) chosen by viewport × DPR. Swap after `decode()` [assumption].
- **Preload neighbours** (±1–2 in sort order) with `new Image()` + `fetchpriority="low"`, or `<link rel="preload" as="image" imagesrcset imagesizes>`. Cancel on fast scrubbing through the filmstrip, and only preload after the user dwells about 150 ms [assumption].
- **Zoom/pan:**
  - `react-zoom-pan-pinch` 4.4.0 (2026-11-19, ~17 kB gz, any React): wheel, pinch, double-click, and imperative controls [source].
  - `yet-another-react-lightbox` 3.33.1 (2026-11-14, ~12 kB gz core) has Zoom, Video, and Thumbnails plugins, but is a *lightbox* (modal) by design. Its pieces could inspire, but the "detail mode with panels" layout fits poorly [source/assumption].
  - PhotoSwipe 5.4.4 is last published 2024 [source].
  - A hand-rolled CSS-transform zoom with pointer events is also viable.
  - Load the `-scaled` or original when zoom exceeds 100% of `large`, to avoid showing upscaled pixels [assumption].
- **Video:** native `<video controls preload="metadata" poster=…>` (WP may have no poster unless a plugin generates one).
- **Audio:** `<audio controls>` plus ID3 metadata from `media_details`.
- **PDF:** WP-generated first-page preview image. For an inline viewer, the browser's built-in PDF viewer via `<iframe>`/`<embed>` (works in Chromium, Firefox, and Safari desktop), or pdf.js for consistency [assumption].
- All media URLs must route through the proxy if the WP host isn't directly reachable. That decision belongs to another track.

---

## 4. Filmstrip

**Pattern (Lightroom Loupe / Google Photos):** a horizontal strip of small thumbnails at the bottom in exactly the grid's sort and filter order. The current item is highlighted and auto-centred. Arrow keys move. Click jumps. Collapsible (Lightroom F6).

- **Implementation** [assumption + docs]:
  - The same TanStack Virtual primitive with `horizontal: true`, fixed item width, and `overscan` of about 10.
  - `scrollToIndex(current, {align: 'center', behavior: 'smooth'})` on change. Use `behavior: 'auto'` when the jump is long, because smooth scrolling across thousands of items is janky and the docs note only nearby items are measured during smooth scroll [docs].
  - Shares the **same index space and page cache** as the grid (one `useMediaWindow(filter, sort)` source). Moving near an unloaded page triggers that page's fetch.
  - Use `thumbnail` (150 px) images, since filmstrip cells are about 64–96 CSS px.
  - Wheel: map vertical wheel deltas to horizontal scroll.
- **Selection sync:** the filmstrip shows *selection* (checked) and *focus/current* (the large preview) distinctly, like Lightroom's "most selected" vs "selected" states. In detail mode, ←/→ changes the current item. Shift+←/→ could extend selection [assumption].
- **Keyboard:** ←/→ prev/next, Home/End first/last. Arrow keys must not fire while focus is in an edit field (see §8). Debounce the hero image load while a key is held.
- **Performance:** about 20–40 mounted thumbnails. Avoid re-rendering the whole strip on every navigation: memoize cells and pass `isCurrent` via a stable selector [assumption].

---

## 5. Resizable and collapsible panels

**Pattern:** left folder tree, centre (grid or detail), and right info/edit panel in detail mode. Drag handles, double-click a handle to reset, keyboard-resizable, panels collapsible via shortcuts (Lightroom: Tab or F7/F8), widths remembered.

**The "constant-width left column" requirement:** when the window resizes, the folder column keeps its pixel width and the grid absorbs the change. That rules out pure percentage layouts [assumption].

| Option | Status | Notes |
|---|---|---|
| **react-resizable-panels** v4 | 4.24.1 (2026-11-18), React 18/19. Bundlephobia reports ~49 kB gz, which seems high; verify tree-shaken size | v4 renamed components to ARIA terms (`Group`, `Panel`, `Separator`). `useDefaultLayout` replaces `autoSaveId` for persistence. `:focus-visible` on separators (4.11). Keyboard resizing via the separator role [docs/source]. Historically sizes were percentages; check that v4's size units support **pixel min/max/default** for the constant-width column [assumption, needs verification] |
| Mantine | No splitter component in 8 or 9 [docs: absence in component list] | `AppShell` has a fixed-width `navbar`/`aside` with collapse breakpoints but no drag resize |
| **Hand-rolled** | — | CSS grid `grid-template-columns: var(--left) 1fr var(--right)`. A `role="separator"` element with `aria-valuenow/min/max`, `aria-orientation="vertical"`, `tabindex=0`. Pointer capture for dragging. ←/→ resize by 16 px, Enter toggles collapse. Persist to `localStorage`. About 80 lines, and the simplest way to get exact px semantics [docs: WAI-ARIA window splitter pattern, assumption] |

**Pitfalls** [assumption]:

- During drag, set `user-select: none` and `cursor: col-resize` on `body`.
- Recompute grid columns on `ResizeObserver` (throttled by rAF) so justified rows don't relayout 60 times a second. Relayout on drag *end*, or relayout cheaply (square grids are cheap).
- Persist per-mode widths: the right panel in detail mode vs a possible info panel in grid mode.

---

## 6. Selection model

### Behaviours (Finder / Explorer / Lightroom conventions) [assumption + docs]

- **Click:** select only this item and set it as *anchor* and *focus*.
- **Cmd/Ctrl+click:** toggle the item and move the anchor.
- **Shift+click:** select the range anchor→item, replacing the previous range from that anchor. Cmd+Shift adds the range to existing selections.
- **Arrow keys:** move focus. Shift+arrow extends. Cmd/Ctrl+arrow moves focus without changing selection, and Space toggles.
- **Cmd/Ctrl+A:** select all *in the current filter*. Esc clears.
- **Marquee (drag on empty space):** rubber-band selection. Shift or Cmd while dragging adds or toggles. Auto-scroll near edges.
- **Double-click or Enter:** open detail.
- **Focus vs selection:** keep them separate. Focus is the keyboard cursor (one item). Selection is a set. The focus ring is visible only for keyboard (`:focus-visible`). Selection shows as a check badge plus accent outline.

### Data model [assumption]

- Use `selected: Set<id>`, `anchorId`, and `focusedIndex`, keyed by **ID**, not index, so selection survives re-sorting.
- Range selection between unloaded indices: either fetch the IDs of the pages in between (≤100 per page), or store ranges symbolically (`{from: i, to: j, filterKey}`) and materialize only when an action runs.
- **Select-all across 10k items:** represent it as `{mode: 'all', filterKey, excluded: Set<id>}`, the Gmail "select all 10 212 items" pattern. Bulk operations then iterate server-side through the filter's IDs, which suits the proxy: one bulk endpoint, server enumerates. Show the count from `X-WP-Total`.

### Marquee in a virtualized grid

DOM-based selectors (`@viselect/*`, `@air/react-drag-to-select`) only see mounted elements. With virtualization, items scrolled past during an auto-scrolling drag are unmounted. **Compute hits geometrically from the layout model** (we know every cell's rect in content coordinates). Use the library only for the rectangle and auto-scroll, or hand-roll it (pointer events, `setPointerCapture`, rAF auto-scroll) [assumption].

| Library | Version / date | React | Notes |
|---|---|---|---|
| `@viselect/react` (+ `@viselect/vanilla` ~4.6 kB) | 3.10.1 (2026-09) | **≥ 19 only** since 3.8 | Feature-rich (scroll containers, start threshold, modifier keys). DOM-based. Open issue about keyboard-scroll expansion [docs/source] |
| `@air/react-drag-to-select` | 5.0.11 (2025-06) | 16–19 | Small (~2.4 kB), gives you a box and lets you do the hit-testing. A good fit for the geometric approach [source] |

### ARIA

- Use **`role="grid"`** (with `role="row"` and `role="gridcell"`), or the simpler `role="listbox"` + `aria-multiselectable="true"` with `role="option"`.
  - A justified layout is a 2-D *layout grid*. APG's grid pattern allows arrow-key wrapping across rows in layout grids [docs: APG].
  - Use **roving tabindex**: one cell has `tabindex=0`, the rest `-1`. Move DOM focus with arrows. Better for virtualization: the focused cell must stay mounted, so pin it with `rangeExtractor` [docs/assumption].
- `aria-selected` on cells. **`aria-rowcount`/`aria-rowindex`** (or `aria-setsize`/`aria-posinset` for listbox) so screen readers know the position in 10k items despite virtualization [docs: APG].
- Ctrl+A select all, Shift+arrow extend, PageUp/PageDown by a viewport of rows, Ctrl+Home/End first/last [docs: APG].
- `react-aria-components` 1.22 has a `GridList` with virtualization (`Virtualizer` + `GridLayout`/`WaterfallLayout`), multi-select, DnD, and typeahead. It's a credible headless alternative if building the a11y plumbing by hand is unattractive, but it brings a second component system alongside Mantine [source/assumption].

---

## 7. Drag and drop

### Use cases

1. Media (one or many selected) → folder in the left tree (FileBird assignment).
2. Folder → folder: reparent, plus reordering if FileBird supports ordering (Track on FileBird API).
3. Files from the desktop → grid or folder: upload, reusing the existing upload queue and `@mantine/dropzone`.
4. Optional: media reordering is not needed (WP has no manual media order).

### Best-practice behaviour [assumption]

- Dragging a selected item drags **the whole selection**. Dragging an unselected item drags just that item and doesn't change the selection (Finder).
- Drag preview: a stack of up to 3 thumbnails plus a **count badge** ("24").
- Drop target folders highlight. Hovering a collapsed folder for about 600 ms auto-expands it. The tree auto-scrolls near edges.
- Tree drop positions: *before / inside / after* (hitbox zones, typically top 25% / middle / bottom 25%). Disallow dropping a folder into its own descendant.
- After the drop, the moved items disappear from the current folder's grid optimistically, and an "Undo" toast appears (§9).
- Keyboard alternative (WCAG 2.5.7 dragging movements): a "Move to folder…" command (Cmd+Shift+M) opening a folder picker. Required for accessibility.

### Libraries

| Library | Version / date | React | Fit |
|---|---|---|---|
| **Pragmatic drag and drop** (`@atlaskit/pragmatic-drag-and-drop`) | core 4.0.0 (2026-09-24). hitbox 3.0.0, auto-scroll 3.2.1, react-accessibility 3.2.4. Not deprecated on npm | Framework-agnostic | Built on **native HTML5 DnD**, so **external file drops** (adapter), **custom native drag previews** (`setCustomNativeDragPreview` renders a React "24 items" preview), **tree-item hitbox** (`attachInstruction`: reorder-above, below, make-child, reparent), auto-scroll, and drop-indicator packages. Small core (lazy-loadable). Powers Trello, Jira, Confluence [docs/source]. Caveat: rapid majors in 2026 (2.0 in June, 3.0 in Aug, 4.0 in Sep); pin versions. Native DnD has no touch support on iOS < 15 and limited preview styling [docs/assumption] |
| **dnd-kit** | Classic `@dnd-kit/core` 6.3.1 (**2024-12**, frozen). New `@dnd-kit/react` 0.5.3 (2026-10, **pre-1.0**, ~32 kB gz) | 18/19 | Pointer-event based: great touch and keyboard sensors, smooth sortable animations. External OS file drops are **not** its domain (need native handlers alongside) [source/docs] |
| **Mantine 9 Tree** | 9.1+ adds `onDragDrop` + `moveTreeNode`, `allowDrop` (9.2), async `onLoadChildren`, `flattenTreeData` + `FlatTreeNode` for virtualization | **React ≥ 19.2** | Covers folder→folder within the tree. Media→folder drops from the grid would need custom wiring [docs]. **None of this exists in Mantine 8** [docs: v8 Tree page] |
| **Headless Tree** (`@headless-tree/core` + `react`) | 1.8.0 (2026-10), ~11.5 kB gz | any | Successor of react-complex-tree. Ordered/unordered DnD including **foreign (external) drags**, keyboard hotkeys, rename, async loading with cache, virtualization (100k+ items), typeahead search [docs] |
| **react-arborist** | 4.0.1 (2026-10) | ≥ 18 | Batteries-included virtualized tree, but peers on **react-dnd 16** (a legacy library) [source] |

**Fit [assumption]:**

- Pragmatic DnD as the single DnD layer covers all three use cases, including OS files and the count preview.
- For the tree, either Headless Tree (with its DnD), or Mantine 9 Tree, or a TanStack-Virtual-flattened custom tree with Pragmatic's tree hitbox.
- FileBird folder counts usually number in the hundreds, so tree virtualization is optional.

---

## 8. Keyboard shortcuts and command palette

### Shortcut set (Lightroom-inspired, illustrative) [assumption]

`G` grid, `E`/`Enter` detail, `Esc` back, `←/→` prev/next, `Space` toggle select or zoom, `Z` zoom 1:1, `I` info panel, `Tab` hide panels, `Cmd+A`/`Esc` select or deselect, `Delete` trash or delete, `Cmd+Z` undo, `/` focus search, `Cmd+K` command palette, `?` shortcut cheat-sheet.

### Libraries

| Library | Version / date | Size | Notes |
|---|---|---|---|
| **Mantine `useHotkeys`** | built-in | 0 | Global hotkeys, `mod+` support, and `getHotkeyHandler` for inputs. **Ignores** `INPUT`/`TEXTAREA`/`SELECT` by default (configurable tag list) [docs]. Simple. No scopes |
| **react-hotkeys-hook** | 5.4.0 (2026-11-09) | ~3 kB | Scopes (enable sets per mode: grid vs detail), `enableOnFormTags`, ref-scoped hotkeys [source] |
| **TanStack Hotkeys** | 0.27.2 (2026-11-21), **beta** | — | Scopes with precedence, sequences (`G G`), `Mod`, conflict detection, display formatting, devtools, cheat-sheet support [docs]. Attractive but pre-1.0 |
| **tinykeys** | 4.0.1 (2026-09) | ~1 kB | Minimal, framework-agnostic, sequences [source] |

### Command palette

- **Mantine Spotlight** (`@mantine/spotlight`): exists in 8 and 9 and matches the theme. Actions plus search. Good default if we stay on Mantine [docs].
- **cmdk** 1.1.1: last release **2025-03**, effectively done or slow-moving. Unstyled and composable. Fine, but not necessary with Spotlight [source].

### Conflicts with text inputs [assumption]

- Single-key shortcuts (`G`, `E`, `Delete`, arrows) must be suppressed when `event.target` is editable: `input`, `textarea`, `select`, `[contenteditable]`, and also Mantine `Combobox` / `TagsInput`. Also check `event.isComposing` (IME).
- Modifier shortcuts (`Mod+S` save, `Mod+K`, `Esc`) may stay active.
- In detail mode, ←/→ must not hijack caret movement in the title field. Blur the field on `Esc`.
- Prefer *mode-scoped* registration (grid scope vs detail scope vs dialog scope) over a global switch statement. Disable all app shortcuts while a modal is open.

---

## 9. Editing UX (metadata: title, alt, caption, description, folder)

### Save model [assumption, aligned with Lightroom, Google Photos, and Figma conventions]

- **Autosave per field on blur, plus a debounce of about 800 ms while typing.** Show a subtle "Saving… / Saved / Failed – retry" indicator per field or panel. Lightroom and Photos have no Save button, and for metadata fields autosave is the modern expectation.
- If an explicit Save is preferred for safety, keep a dirty indicator and *guard navigation* (prev/next in detail mode with unsaved edits should autosave, not block with a dialog).
- Batch edit (multiple selected): show "Mixed" placeholders. Apply on explicit "Apply to 24 items" (explicit is better here because blast radius is large).

### Optimistic updates with rollback [docs: TanStack Query optimistic updates]

- `useMutation` with `onMutate`:
  1. `cancelQueries` for the item and its list pages.
  2. Snapshot the previous value.
  3. `setQueryData` on the **item cache and every cached list page containing it** (use `queryClient.setQueriesData({queryKey: ['media']}, updater)`).
  4. On `onError`, restore. On `onSettled`, `invalidateQueries`.
- For "move to folder", optimistically remove the items from the current folder's pages and adjust counts (both grid total and tree folder counts).

### Delete

- WP deletes attachments **permanently** unless `MEDIA_TRASH` is defined (`true` in `wp-config.php`). REST `DELETE /wp/v2/media/:id` without `force=true` fails with `rest_trash_not_supported` (501) when trash isn't supported for attachments, because `WP_REST_Posts_Controller::delete_item` checks `EMPTY_TRASH_DAYS > 0 && MEDIA_TRASH` for attachments [source: WP core, from memory; verify against the installed WP version].
- So:
  - **Permanent delete → confirm dialog** stating count and irreversibility ("Delete 24 files permanently? This cannot be undone."). Type-to-confirm for large counts.
  - If `MEDIA_TRASH` is on, or for **reversible** actions (move to folder, metadata edit, remove from folder), use **an undo toast** instead of a confirm. "Moved 24 items to *Events* — Undo". Mantine `notifications` works, and keeps for about 8 s.
  - Alternative: a *delayed* delete. Hide the items optimistically, show an undo toast for about 8 s, then send the DELETE. This risks losing the action if the tab closes; mitigate with `pagehide` flush or a server-side pending-delete queue in the proxy [assumption].

### Conflict handling

- WP attachments have `modified_gmt`. Before PATCH, the proxy can compare the client's last-seen `modified_gmt` with the current one and return 409 on mismatch. WP has no native `If-Match`/ETag precondition for REST updates [assumption].
- For a single-user or small-team tool, "last write wins + refetch on focus" is probably acceptable. Surface a "This item changed elsewhere — reload?" banner on 409.

---

## 10. URL-addressable state

### What should be in the URL [assumption]

`folder`, `q` (search), `type` (mime filter), `sort`/`order`, `view=grid|detail`, `item` (current detail item), maybe `panel=info`. **Not** selection (ephemeral, potentially huge) and not scroll offset (use history state).

### The sub-path constraint (important)

- The client is built with `base: './'` (relative asset URLs), and the server serves `index.html` for `*` [source: `client/vite.config.ts`, `server/src/app.ts`].
- With **path-based routes**, a deep link like `<sub-path>/item/123` would resolve `./assets/x.js` to `<sub-path>/item/assets/x.js`. That request hits the SPA fallback and returns HTML, so the app breaks [assumption: standard relative-URL resolution].
- Options:
  1. **Query-parameter-only state:** the path always stays at the app root (`<sub-path>/?view=detail&item=123&folder=7`). Works under any prefix with zero config. **Recommended** [assumption].
  2. Path routes plus a server-injected `<base href="…">` derived from `X-Forwarded-Prefix` or config, plus `basepath`/`basename` set from `document.baseURI` at runtime. More moving parts.
  3. Hash routing (`#/item/123`). Robust but dated.

### Router options

| Option | Version | React | Notes |
|---|---|---|---|
| **TanStack Router** | 1.170.x (2026-10) | 18/19 | First-class *typed, validated search params* (`validateSearch` with Zod/Valibot), `useSearch`, `basepath`, scroll restoration incl. element-level, `viewTransition` support. Pairs naturally with TanStack Query [docs] |
| **React Router** 8 | 8.5.2 (2026-11-18) | **≥ 19.2.7** | `useSearchParams`, `basename`, `viewTransition` on links. v8 needs React 19 [source] |
| **nuqs** | 2.10.3 (2026-11) | ≥ 18.2 | Type-safe query-string state hooks with adapters for React Router, TanStack Router, or plain React (no router). Minimal option if the app stays router-less [source] |
| No router | — | — | `URLSearchParams` + `history.pushState/replaceState` + `popstate` in a small hook. Viable given a single screen [assumption] |

### Back-button behaviour [assumption]

- Opening detail: **push** (`?view=detail&item=123`). Back returns to the grid, with the morph back to the cell.
- Next/prev inside detail: **replace**. Otherwise Back would step through 50 photos, which is how Google Photos behaves: Back closes the viewer.
- Changing folder, search, or filter: **push** (they are navigations). Typing in search: replace while typing, push on commit.
- On `popstate` into detail for an item not in the loaded pages: fetch the item by ID (`/wp/v2/media/123`), show it immediately, and resolve its index in the list lazily. The filmstrip may show placeholders until the index is known.
- Run the VT/morph on popstate too (React 19.3: wrap the state update from `popstate` in `startTransition`).

---

## 11. Data fetching and caching

TanStack Query 5.108.x (2026-11, React 18/19, ~13 kB gz) [source].

### Query key design [assumption]

- `['media', 'list', filterKey, page]`: one query per WP page (`per_page=100`). `filterKey` holds folder, search, mime, sort, and order. `staleTime` of about 30–60 s.
- `['media', 'item', id]`: seeded from list results (`setQueryData` per item in the list `select`/`onSuccess`, or a normalized `Map` cache) so detail mode opens instantly.
- `['media', 'count', filterKey]`: from `X-WP-Total` (or from the first page).
- `['folders', 'tree']`: FileBird folder tree with counts.
- Visible pages: `useQueries({queries: visiblePages.map(p => listQuery(filterKey, p))})`. Keep `gcTime` high enough (about 5–10 min) that scrolling back is instant. Memory for 10k item records (trimmed with `_fields`) is a few MB, which is fine.
- `placeholderData: keepPreviousData` when the filter changes, to avoid flashing an empty grid.
- **Mutations:** optimistic as in §9. `invalidateQueries({queryKey: ['media','list', filterKey]})` after moves or deletes. Folder counts get invalidated too.
- **Prefetch:** on folder hover, prefetch page 1 of that folder. In detail mode, prefetch item data for neighbours (already in list pages).

### Server-side proxy caching considerations [assumption]

- The proxy authenticates every WP call with one Application Password. Responses are therefore not user-specific, so caching at the proxy is safe if the app has a single tenant.
- Short-TTL (about 10–30 s) in-memory cache for list pages, keyed by the full query string, with **explicit invalidation on any mutation through the proxy**. Out-of-band WP admin edits appear after the TTL.
- Image bytes: if images are proxied, stream them with long `Cache-Control: public, max-age=31536000, immutable`. WP sub-size URLs are content-stable per filename, but overwrite-in-place via image edit creates new filenames like `-e1700000000` [assumption]. Let the browser cache do the heavy lifting.
- Derived data (ThumbHash, dimension index for justified layout, per-folder counts): persistent cache (SQLite or a JSON file) keyed by `id + modified_gmt`, computed lazily or by background job. Must respect Track D's limits on WP concurrency (see memory note: WP thumbnail generation can take minutes under load, so don't hammer WP).
- Coalesce identical in-flight requests (singleflight) in the proxy. Concurrent viewport fetches from multiple tabs would otherwise multiply WP load.

---

## 12. Accessibility and theming

### Dark-first neutral theme [assumption + docs]

- Photo apps use **achromatic greys** so the UI doesn't bias colour perception: Lightroom's background is about `#1e1e1e`–`#2b2b2b` with adjustable "loupe background" greys; Google Photos' viewer is near-black.
  - The current `dark` tuple in `client/src/theme.ts` is blue-tinted (`#16202f`, `#0d1420`, …) for the cyberpunk look.
  - For the media manager, consider a neutral `dark` palette (Mantine's default `dark` is close to neutral) with the neon accent reserved for focus, selection, and primary actions.
  - Offer a detail-view background choice: black, dark grey, or mid grey.
- Thumbnail cells: no heavy borders. Selection uses a 2–3 px accent outline plus a check badge (not colour alone, per WCAG 1.4.1).
- Contrast: text ≥ 4.5:1. Focus indicators and UI component boundaries ≥ 3:1 against adjacent colours (WCAG 1.4.11, 2.4.13 focus appearance in WCAG 2.2 AAA, 2.4.11 focus not obscured AA) [docs: WCAG 2.2].
  - Overlaid controls on photos (check badge, hover actions) need their own scrim or shadow, because the photo behind is arbitrary.
- **Focus rings:** `:focus-visible` only. Ring *outside* the image (outline-offset) so it isn't lost on bright photos. Use a double ring (dark + light) for contrast on any background [assumption].
- `prefers-color-scheme`: Mantine supports `defaultColorScheme="auto"` and `light-dark()`. A light theme is optional for this app type. Dark-first with a manual toggle is common [docs: Mantine].
- `prefers-reduced-motion`: see §1. Also disable smooth scrolling (`scroll-behavior`) and filmstrip auto-centre animation under reduce.
- `prefers-contrast: more` / `forced-colors: active`: selection must stay visible in Windows High Contrast. Use `outline`, not only `box-shadow`.

### Screen-reader announcements [assumption + docs]

- A polite `aria-live` region (one global, visually hidden) for: "24 items selected", "Moved 24 items to Events", "Loading more…", "Item 3 401 of 10 212: IMG_2034.jpg".
- Pragmatic DnD's `react-accessibility` package and APG patterns cover DnD announcements [docs].
- Detail mode: when entered, move focus to the detail region (`role="region"` / `aria-label="Image viewer"`, or a non-modal `dialog`). On exit, restore focus to the grid cell of the current item.
- Image `alt` in the grid: use the WP `alt_text`, falling back to the title (with an empty alt the grid becomes a list of unnamed buttons).

---

## Is Mantine 8 a fit or a constraint?

**Fit:**

- Polished primitives for the chrome: `AppShell`, `ScrollArea`, `Notifications` (undo toasts), `Spotlight` (command palette), `Menu`/`ContextMenu`-like menus, `Modal` (confirm delete), forms for the edit panel, `useHotkeys`, `Dropzone` (already used).
- CSS-variable theming makes a neutral dark theme easy [docs].

**Constraints:**

1. **Mantine 8 is effectively frozen.** The last release was 8.3.18 (2026-03-17). Mantine 9.x (9.8.2, 2026-11-20) requires **React 19.2+** [source/docs].
2. **Tree:** Mantine 8's `Tree` lacks DnD, async loading, and virtualization helpers. All three arrived in 9.1/9.2 [docs]. Staying on 8 means a third-party tree (Headless Tree) for the FileBird column.
3. **No virtualized grid, no resizable splitter, no marquee selection, no image viewer/zoom.** These are the core of this app and come from elsewhere regardless (TanStack Virtual, hand-rolled or react-resizable-panels, Pragmatic DnD, react-zoom-pan-pinch) [docs/assumption].
4. **`ScrollArea`** renders a custom scrollbar on top of a native viewport. It works with virtualizers via `viewportRef`, but adds a layer to the hottest scroll path (the 10k grid). A plain `overflow: auto` div with styled native scrollbars (`scrollbar-color`, `scrollbar-width`, Baseline) is simpler and faster there. Keep `ScrollArea` for panels [assumption].

**Verdict [assumption]:** Mantine is a good *chrome* library for this app and not an obstacle, *provided* the project moves to React 19.3 + Mantine 9. The upgrade also unlocks React `<ViewTransition>`, `<Activity>`, Mantine 9 Tree DnD, viselect, and React Router 8. The media-specific heavy lifting (virtualized grid, filmstrip, transitions, DnD, selection) would be custom or headless libraries in any UI kit.

---

## Feasibility table

| Pattern | Feasible? | Effort | Risk | Candidate approach |
|---|---|---|---|---|
| Grid→detail shared-element morph | Yes | M | Med: virtualization + aspect change + return-to-different-item | Detail as overlay over `inert` grid. Same-document VT with a single dynamic `view-transition-name` (React 19.3 `<ViewTransition name>` or `startViewTransition` + `flushSync`). Fallback: Motion `layoutId` or WAAPI FLIP |
| Reduced-motion handling | Yes | S | Low | CSS media query on VT pseudos, Motion `reducedMotion="user"` |
| Square virtualized grid, 10k+ | Yes | S–M | Low | TanStack Virtual (rows), placeholder slots from `X-WP-Total`, sparse page fetching |
| Justified virtualized grid | Yes | L | Med–High: needs all dimensions or estimate/correct with scroll anchoring | Server-side dimension index in the proxy + custom/`react-photo-album` layout math + TanStack Virtual rows. Google Photos / Immich techniques |
| Scrubber / fast scroll | Yes | M | Med | Custom rail over total height. Debounced page loads (`scrollend`). Date labels from section metadata |
| Scroll restoration grid↔detail | Yes | S (overlay) / M (route swap) | Low | Overlay keeps the grid mounted. Else `takeSnapshot` + `initialOffset` / `scrollToIndex(current)` |
| Responsive sub-size selection | Yes | S | Low | `srcset` from `media_details.sizes`, explicit `sizes` from cell px, DPR cap 2 |
| Blur/colour placeholders | Yes | M | Low–Med: server CPU, WP load | ThumbHash via sharp in proxy + persistent cache. Or *Image Placeholders* plugin dominant colour |
| Detail preload + zoom/pan | Yes | M | Low | Neighbour preload with low priority. `react-zoom-pan-pinch` or hand-rolled. Swap to `-scaled` on deep zoom |
| Video / audio / PDF preview | Yes | S–M | Low | Native `<video>`/`<audio>`, WP PDF preview image + `<iframe>` or pdf.js |
| Filmstrip synced with grid | Yes | M | Low | TanStack Virtual horizontal, shared page cache, `scrollToIndex(center)` |
| Resizable / collapsible panels, fixed-px left column | Yes | S–M | Low | Hand-rolled CSS-grid + ARIA separator, or react-resizable-panels v4 (verify px units) |
| Selection model (click / shift / cmd / keyboard) | Yes | M | Low | ID-keyed set + anchor + focus index. Roving tabindex. APG grid/listbox semantics |
| Marquee in virtualized grid | Yes | M | Med | Geometric hit-test on layout model. `@air/react-drag-to-select` for the box, or hand-rolled |
| Select-all across pages | Yes | M | Med: bulk ops semantics | `{mode:'all', filterKey, excluded}` + server-side bulk endpoint in proxy |
| DnD media→folder, folder→folder, desktop→upload | Yes | M–L | Med: library churn (Pragmatic 4.x majors, dnd-kit 0.x) | Pragmatic DnD (native, file adapter, tree hitbox, count preview) + Headless Tree or Mantine 9 Tree. "Move to…" keyboard alternative |
| Shortcuts + command palette | Yes | S | Low | Mantine `useHotkeys` / react-hotkeys-hook scopes + Mantine Spotlight |
| Autosave + optimistic updates + undo | Yes | M | Med: delete is permanent without `MEDIA_TRASH` | TanStack Query `onMutate`/rollback. Undo toasts for reversible actions, confirm for permanent delete |
| Conflict detection | Partly | S–M | Low | Proxy compares `modified_gmt` and returns 409. Otherwise last-write-wins + refetch on focus |
| Deep links + Back behaviour under sub-path | Yes | S–M | Med if path-based (relative `base`) | Query-param state (TanStack Router search params, nuqs, or a small hook). Push on enter detail, replace on next/prev |
| Data caching | Yes | M | Low–Med | TanStack Query page-keyed lists + item cache. Short-TTL proxy cache with mutation invalidation + singleflight |
| Neutral dark theme, a11y, live regions | Yes | S–M | Low | Neutral `dark` tuple, accent for focus/selection only, `:focus-visible` double rings, one global `aria-live` region |
| Staying on React 18 + Mantine 8 | Possible | — | **High** (frozen UI lib, missing Tree features, several libs now React-19-only) | Plan a React 19.3 + Mantine 9 upgrade as step 0 — **done in #48** |

Effort: S ≈ ≤1 day, M ≈ 2–5 days, L ≈ 1–2+ weeks [assumption].

---

## Sources

**View transitions / animation**
- React 19.3 release (ViewTransition and Fragment Refs stable), 2026-09-09: https://react.dev/blog/2026/09/09/react-19-3
- React `<ViewTransition>` reference: https://react.dev/reference/react/ViewTransition
- React Labs: View Transitions, Activity: https://react.dev/blog/2025/04/23/react-labs-view-transitions-activity-and-more
- React 19.2 (Activity): https://react.dev/blog/2025/10/01/react-19-2 , https://react.dev/reference/react/Activity
- Same-document view transitions are Baseline Newly available (Firefox 144): https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available
- What's new in view transitions (2025 update): https://developer.chrome.com/blog/view-transitions-in-2025
- Element-scoped view transitions (Chrome 147): https://developer.chrome.com/blog/element-scoped-view-transitions , https://developer.chrome.com/docs/css-ui/view-transitions/element-scoped-view-transitions
- caniuse, View Transitions (single-document): https://caniuse.com/view-transitions
- Motion layout animations: https://motion.dev/docs/react-layout-animations ; animateView: https://motion.dev/docs/react-animate-view ; Motion on React's VT API: https://motion.dev/blog/reacts-experimental-view-transition-api
- MDN `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

**Grids / virtualization**
- TanStack Virtual, Virtualizer API: https://tanstack.com/virtual/latest/docs/api/virtualizer
- react-virtuoso README (VirtuosoGrid same-size items, Masonry): https://github.com/petyosi/react-virtuoso
- react-window: https://github.com/bvaughn/react-window
- Building the Google Photos Web UI (Google Design, 2018): https://medium.com/google-design/google-photos-45b714dfbed1
- How to implement Google Photos grid in JavaScript: https://dev.to/shaileshpandit/how-to-implement-google-photos-grid-in-javascript-575i
- Immich timeline architecture (DeepWiki): https://deepwiki.com/immich-app/immich/3.5-timeline-and-asset-display ; Immich "how to scroll like google": https://ark.sudovanilla.org/Infrastructure/immich/src/commit/d31b35873f357d2a58a68fef58b27c07e3e9fa4c/web/how-to-scroll-like-google.md
- Flickr justified-layout: https://github.com/flickr/justified-layout ; react-photo-album: https://react-photo-album.com
- `scrollend` Baseline (Safari 26.2): https://www.infoq.com/news/2026/04/safari-scrollend-support , https://developer.chrome.com/blog/scrollend-a-new-javascript-event

**WordPress**
- REST API pagination (`per_page` ≤ 100, `X-WP-Total`, `X-WP-TotalPages`, `offset`): https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/
- Image Placeholders plugin (WP Performance Team): https://wordpress.org/plugins/dominant-color-images/
- Dominant Color plugin (stale): https://wordpress.org/plugins/dominant-color

**Images**
- web.dev Optimize LCP (fetchpriority, don't lazy-load LCP): https://web.dev/articles/optimize-lcp
- `sizes="auto"` support: https://caniuse.com/wf-sizes-auto
- ThumbHash: https://github.com/evanw/thumbhash , https://evanw.github.io/thumbhash/
- react-zoom-pan-pinch: https://github.com/BetterTyped/react-zoom-pan-pinch
- yet-another-react-lightbox: https://yet-another-react-lightbox.com

**Selection / a11y**
- WAI-ARIA APG grid pattern: https://www.w3.org/WAI/ARIA/apg/patterns/grid/
- WAI-ARIA APG window splitter pattern: https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Viselect React: https://simonwep.github.io/viselect/pages/frameworks/react.html
- @air/react-drag-to-select: https://github.com/AirLabsTeam/react-drag-to-select
- React Aria GridList: https://react-spectrum.adobe.com/react-aria/GridList.html

**Drag and drop / trees**
- Pragmatic drag and drop: https://atlassian.design/components/pragmatic-drag-and-drop/about , optional packages: https://atlassian.design/components/pragmatic-drag-and-drop/optional-packages
- dnd-kit: https://github.com/clauderic/dnd-kit , https://dndkit.com
- Headless Tree: https://headless-tree.lukasbach.com/
- react-arborist: https://github.com/brimdata/react-arborist
- Mantine Tree (v9): https://mantine.dev/core/tree/ ; Mantine Tree (v8): https://v8.mantine.dev/core/tree/ ; Mantine 9.1 changelog: https://mantine.dev/changelog/9-1-0 ; 9.2: https://mantine.dev/changelog/9-2-0

**Panels / shortcuts / palette**
- react-resizable-panels: https://github.com/bvaughn/react-resizable-panels ; v4 release notes: https://newreleases.io/project/npm/react-resizable-panels/release/4.0.0
- TanStack Hotkeys: https://tanstack.com/hotkeys/latest/docs/overview
- react-hotkeys-hook: https://react-hotkeys-hook.vercel.app
- Mantine Spotlight: https://mantine.dev/x/spotlight/ ; cmdk: https://github.com/pacocoursey/cmdk

**Routing / data**
- TanStack Router scroll restoration: https://tanstack.com/router/latest/docs/guide/scroll-restoration ; search params: https://tanstack.com/router/latest/docs/framework/react/guide/search-params
- nuqs: https://nuqs.dev
- TanStack Query optimistic updates: https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates

**Mantine**
- Mantine 8→9 migration (React 19.2+ requirement): https://mantine.dev/guides/8x-to-9x ; v9.0.0 changelog: https://mantine.dev/changelog/9-0-0

**Registry data** (versions, dates, peer deps): `https://registry.npmjs.org/<package>`, queried 2026-11-22. Bundle sizes: `https://bundlephobia.com/api/size?package=<package>`.
