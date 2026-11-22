// The living design-system page: tokens and every component in every state,
// rendered with the same CSS as the prototype. ?theme=dark|light.

import { library, loadLibrary } from './data.js'
import { tileHtml } from './grid.js'
import { brandMark } from './toolbar.js'
import { html, icon, raw } from './util.js'

const root = document.documentElement
const params = new URLSearchParams(location.search)
root.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark'

const SEMANTIC_GROUPS = {
  Surfaces: [
    '--surface-app',
    '--surface-panel',
    '--surface-raised',
    '--surface-overlay',
    '--surface-input',
    '--surface-stage',
    '--surface-tile',
    '--surface-filmstrip',
    '--surface-hover',
    '--surface-active',
    '--scrim',
  ],
  Text: [
    '--text-1',
    '--text-2',
    '--text-3',
    '--text-accent',
    '--text-on-accent',
    '--text-on-select',
    '--text-on-warn',
  ],
  'Lines & signals': [
    '--line-1',
    '--line-2',
    '--line-input',
    '--accent',
    '--accent-hover',
    '--accent-subtle',
    '--accent-line',
    '--focus-ring',
    '--select-ring',
    '--select-tint',
  ],
  Status: [
    '--ok',
    '--warn',
    '--warn-fill',
    '--warn-subtle',
    '--danger',
    '--danger-fill',
    '--danger-fill-hover',
    '--text-on-danger',
    '--danger-subtle',
    '--info',
  ],
}

const GRAYS = [
  '1000',
  '950',
  '925',
  '900',
  '850',
  '800',
  '700',
  '600',
  '500',
  '400',
  '300',
  '200',
  '150',
  '100',
  '50',
  '0',
]
const CYANS = [
  '50',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '950',
]

const tokenValue = (name) =>
  getComputedStyle(root).getPropertyValue(name).trim()

function section(id, title, intro, body) {
  return html`<section class="system-section" id="${id}">
    <h2>${title}</h2>
    ${intro ? html`<p>${intro}</p>` : ''} ${body}
  </section>`
}

function item(label, content) {
  return html`<div class="specimen__item">
    ${content}<span class="specimen__label">${label}</span>
  </div>`
}

// --- Foundations -----------------------------------------------------------------

function colours() {
  const groups = Object.entries(SEMANTIC_GROUPS).map(
    ([group, names]) => html`<h3 class="section__title">${group}</h3>
      <div class="swatches">
        ${names.map(
          (name) => html`<div class="swatch">
            <div class="swatch__chip" style="background:var(${name})"></div>
            <div class="swatch__meta">
              <span>${name}</span><span class="swatch__value">${tokenValue(name)}</span>
            </div>
          </div>`,
        )}
      </div>`,
  )
  const scale = (prefix, steps, darkFrom) =>
    html`<div class="scale">
      ${steps.map(
        (step, index) =>
          html`<div style="background:var(--${prefix}-${step});color:${index < darkFrom ? '#fff' : '#000'}">${step}</div>`,
      )}
    </div>`
  return section(
    'colour',
    'Colour',
    'Chrome is achromatic; cyan is a signal (focus, selection, primary action, active navigation, brand). Components only use the semantic tokens; primitives below feed them.',
    html`<div class="specimen specimen--column">
      ${groups}
      <h3 class="section__title">Primitives — greys</h3>
      ${scale('gray', GRAYS, 8)}
      <h3 class="section__title">Primitives — neon cyan</h3>
      ${scale('cyan', CYANS, -1)}
    </div>`,
  )
}

function typography() {
  const rows = [
    [
      '--fs-24 / 600',
      'font-size:var(--fs-24);font-weight:600',
      'Media library',
    ],
    [
      '--fs-20 / 600',
      'font-size:var(--fs-20);font-weight:600',
      'Editing 12 items',
    ],
    [
      '--fs-16 / 600',
      'font-size:var(--fs-16);font-weight:600',
      'Delete permanently?',
    ],
    [
      '--fs-14 / 600',
      'font-size:var(--fs-14);font-weight:600',
      'coast-caleb-ralston-869.jpg',
    ],
    [
      '--fs-13 / 400 (body)',
      'font-size:var(--fs-13)',
      'Describe the image for screen readers.',
    ],
    [
      '--fs-12 / 500',
      'font-size:var(--fs-12);font-weight:500',
      'Alt text · Caption · Description',
    ],
    [
      '--fs-11 mono',
      'font-family:var(--font-mono);font-size:var(--fs-11)',
      '93 ITEMS · 237 MB · 1572 × 1179',
    ],
    [
      'display (labels)',
      'font-family:var(--font-display);font-size:var(--fs-11);letter-spacing:var(--display-tracking);text-transform:var(--display-transform);color:var(--text-3)',
      'Folders · Info · File',
    ],
    [
      'brand',
      'font-family:var(--font-brand);font-size:var(--fs-13);letter-spacing:.06em;text-transform:uppercase',
      'wp-upload',
    ],
  ]
  return section(
    'type',
    'Typography',
    'Geist for the interface, Geist Mono for small labels, counts and dimensions (tabular), Orbitron only in the wordmark.',
    html`<div class="specimen specimen--column">
      ${rows.map(
        ([label, style, text]) => html`<div class="type-row">
          <span class="specimen__label">${label}</span><span style="${style}">${text}</span>
        </div>`,
      )}
    </div>`,
  )
}

function shapeAndMotion() {
  const spaces = [1, 2, 3, 4, 5, 6, 7, 8]
  const radii = ['xs', 'sm', 'md', 'lg', 'pill']
  const durations = [
    ['--dur-1', 'fades, hovers'],
    ['--dur-2', 'panels, selection'],
    ['--dur-3', 'overlays'],
    ['--dur-morph', 'grid ↔ detail'],
  ]
  return section(
    'shape',
    'Spacing, radius, elevation, motion',
    'A 4 px spacing grid. Tight 2 px gaps between images; generous 16–24 px padding in panels. Hover the motion row to play the durations (ease-out).',
    html`<div class="specimen specimen--column">
        ${spaces.map(
          (step) => html`<div class="type-row">
            <span class="specimen__label">--space-${step} · ${tokenValue(`--space-${step}`)}</span>
            <div class="space-bar" style="width:var(--space-${step})"></div>
          </div>`,
        )}
      </div>
      <div class="specimen">
        ${radii.map((name) =>
          item(
            `--radius-${name}`,
            html`<div class="radius-box" style="border-radius:var(--radius-${name})"></div>`,
          ),
        )}
        ${[1, 2, 3].map((level) =>
          item(
            `--shadow-${level}`,
            html`<div class="shadow-box" style="border-radius:var(--radius-md);box-shadow:var(--shadow-${level})"></div>`,
          ),
        )}
        ${item('--glow-accent', html`<button class="btn btn--primary">${icon('upload')}Upload</button>`)}
      </div>
      <div class="specimen specimen--column">
        ${durations.map(([name, use]) =>
          item(
            `${name} · ${tokenValue(name)} · ${use}`,
            html`<div class="motion-box" style="transition:transform var(${name}) var(--ease-out)"></div>`,
          ),
        )}
      </div>`,
  )
}

async function icons() {
  const sprite = await fetch('icons.svg').then((response) => response.text())
  const names = [...sprite.matchAll(/id="i-([^"]+)"/g)].map((match) => match[1])
  return section(
    'icons',
    'Icons',
    `Tabler Icons (outline, MIT) at 1.75 stroke, 18 px default. ${names.length} icons in the sprite.`,
    html`<div class="specimen">
      <div class="icon-grid">
        ${names.map(
          (name) =>
            html`<div class="icon-cell">${icon(name, 'icon--lg')}<span>${name}</span></div>`,
        )}
      </div>
    </div>`,
  )
}

// --- Components ------------------------------------------------------------------

function buttons() {
  return section(
    'buttons',
    'Buttons and controls',
    'One primary action per view. Pressed toggles are neutral (a state, not a signal); the inspector rail uses the accent because it marks where you are.',
    html`<div class="specimen">
        ${item('primary', html`<button class="btn btn--primary">${icon('upload')}Upload</button>`)}
        ${item('primary · hover', html`<button class="btn btn--primary state-hover">${icon('upload')}Upload</button>`)}
        ${item('default', html`<button class="btn">${icon('copy')}Copy URL</button>`)}
        ${item('default · hover', html`<button class="btn state-hover">${icon('copy')}Copy URL</button>`)}
        ${item('default · focus', html`<button class="btn state-focus">${icon('copy')}Copy URL</button>`)}
        ${item('ghost', html`<button class="btn btn--ghost">${icon('folder')}Move to folder</button>`)}
        ${item('danger', html`<button class="btn btn--ghost btn--danger">${icon('trash')}Delete</button>`)}
        ${item('danger solid', html`<button class="btn btn--danger-solid">Delete permanently</button>`)}
        ${item('danger solid · hover', html`<button class="btn btn--danger-solid state-hover">Delete permanently</button>`)}
        ${item('small', html`<button class="btn btn--sm">Undo</button>`)}
        ${item('disabled', html`<button class="btn" disabled>${icon('refresh')}Regenerate</button>`)}
      </div>
      <div class="specimen">
        ${item('icon', html`<button class="icon-btn">${icon('zoom-in')}</button>`)}
        ${item('icon · hover', html`<button class="icon-btn state-hover">${icon('zoom-in')}</button>`)}
        ${item('icon · pressed', html`<button class="icon-btn" aria-pressed="true">${icon('layout-sidebar')}</button>`)}
        ${item('rail · active', html`<nav class="rail" style="border:0;width:auto"><button class="icon-btn" aria-pressed="true">${icon('info-circle')}</button></nav>`)}
        ${item('segmented', html`<div class="segmented"><button class="icon-btn" aria-pressed="true">${icon('layout-board')}</button><button class="icon-btn" aria-pressed="false">${icon('layout-grid')}</button></div>`)}
        ${item('tooltip', html`<span class="tooltip">Inspector <kbd>I</kbd></span>`)}
        ${item('kbd', html`<span style="display:flex;gap:4px"><kbd>Ctrl</kbd><kbd>K</kbd> <kbd>?</kbd> <kbd>←</kbd><kbd>→</kbd></span>`)}
      </div>`,
  )
}

function inputs() {
  const field = (label, extraClass, control, status = '', hint = '') =>
    html`<label class="field ${extraClass}" style="width:260px">
      <span class="field__label">${label}${status}</span>${control}${hint ? html`<span class="field__hint">${hint}</span>` : ''}
    </label>`
  const saved = html`<span class="field__status field__status--saved is-visible">${icon('check', 'icon--sm')}Saved</span>`
  const saving = html`<span class="field__status is-visible">Saving…</span>`
  const failed = html`<span class="field__status field__status--error is-visible">${icon('alert-circle', 'icon--sm')}Not saved</span>`
  return section(
    'inputs',
    'Inputs and fields',
    'Fields autosave on blur or Ctrl/Cmd+Enter; the status sits quietly in the label row. Field edges meet 3:1 (WCAG 1.4.11).',
    html`<div class="specimen">
        ${field('Title', '', html`<input class="input" value="coast-caleb-ralston-869" />`)}
        ${field('Title · focus', '', html`<input class="input state-focus" value="coast-caleb-ralston-869" />`)}
        ${field('Caption', '', html`<input class="input" value="Photo: Caleb Ralston / Unsplash" />`, saving)}
        ${field('Caption', '', html`<input class="input" value="Photo: Caleb Ralston / Unsplash" />`, saved)}
        ${field('Description', 'field--error', html`<input class="input" value="Night sky over the ridge" />`, failed, 'WordPress could not be reached. Retrying…')}
        ${field('Alt text', 'field--warn', html`<input class="input" placeholder="Describe the image for screen readers" />`, '', 'Missing — images need alt text to be accessible.')}
        ${field('Alt text · batch', 'field--mixed', html`<input class="input" placeholder="Mixed (12)" />`, '', 'Leave empty to keep each item’s own value.')}
        ${field('Notes', '', html`<textarea class="input" rows="3"></textarea>`)}
      </div>
      <div class="specimen">
        ${item('search', html`<label class="search" style="width:280px">${icon('search')}<input class="input" placeholder="Search title, file name, caption, alt…" /></label>`)}
        ${item('select', html`<select class="select"><option>Newest first</option></select>`)}
        ${item('density', html`<input class="density" type="range" min="0" max="4" value="2" />`)}
      </div>`,
  )
}

function chipsAndBars() {
  return section(
    'chips',
    'Filter chips, breadcrumb, selection bar',
    'Chips are borderless toggles; the active filter uses the accent. With ≥ 2 items selected the toolbar becomes the selection bar (neon underline).',
    html`<div class="specimen specimen--app">
        ${item(
          'chips',
          html`<div class="filterbar" style="padding:0">
            <button class="chip" aria-pressed="true">All<span class="chip__count">93</span></button>
            <button class="chip">Images<span class="chip__count">87</span></button>
            <button class="chip state-hover">Video<span class="chip__count">2</span></button>
            <button class="chip">${icon('accessible', 'icon--sm')}Missing alt<span class="chip__count">18</span></button>
            <button class="chip" aria-pressed="true">Larger than 2 MB<span class="chip__remove">${icon('x', 'icon--sm')}</span></button>
          </div>`,
        )}
        ${item(
          'breadcrumb',
          html`<nav class="breadcrumb">Blog ${icon('chevron-right', 'icon--sm')} 2026 ${icon('chevron-right', 'icon--sm')}<span class="breadcrumb__current">Spring campaign</span></nav>`,
        )}
      </div>
      <div class="specimen specimen--app" style="padding:0;overflow:hidden">
        <header class="toolbar is-selection" style="width:100%;height:48px">
          <div class="selection-bar">
            <button class="icon-btn">${icon('x')}</button>
            <span class="selection-bar__count">12 selected</span>
            <button class="btn btn--ghost">${icon('folder')}Move to folder</button>
            <button class="btn btn--ghost">${icon('pencil')}Edit details</button>
            <span class="toolbar__spacer"></span>
            <button class="btn btn--ghost btn--danger">${icon('trash')}Delete</button>
          </div>
        </header>
      </div>`,
  )
}

function tiles() {
  const images = library.items.filter((entry) => entry.kind === 'image')
  const byKind = (kind) => library.items.find((entry) => entry.kind === kind)
  const withAlt = images.find((entry) => entry.alt)
  const withoutAlt = images.find((entry) => !entry.alt)
  const progress = html`<div class="tile__progress"><div class="progress-ring" style="--progress:.42">42%</div></div>`
  const tile = (
    entry,
    label,
    { extraClass = '', selected = false, after = '' } = {},
  ) => {
    let markup = String(
      tileHtml(entry, {
        width: 180,
        height: 130,
        extraClass: `tile-specimen ${extraClass}`,
      }),
    ).replace('aria-selected="false"', `aria-selected="${selected}"`)
    // Overlay content (e.g. a progress ring) goes just before the tile closes.
    const end = markup.lastIndexOf('</div>')
    markup = `${markup.slice(0, end)}${after}${markup.slice(end)}`
    return item(label, raw(markup))
  }
  return section(
    'tiles',
    'Media tiles',
    'Quiet at rest. Hover reveals the check circle and file name; selection shrinks the image inside a neon ring on a neutral cell; keyboard focus is a separate ring.',
    html`<div class="specimen specimen--app">
      ${tile(withAlt, 'rest')}
      ${tile(withAlt, 'hover', { extraClass: 'is-hover' })}
      ${tile(withAlt, 'focus', { extraClass: 'is-focus' })}
      ${tile(withAlt, 'selected', { selected: true })}
      ${tile(withAlt, 'selected + focus', { selected: true, extraClass: 'is-focus' })}
      ${tile(withoutAlt, 'missing alt badge')}
      ${tile(byKind('video'), 'video')}
      ${tile(byKind('audio'), 'audio')}
      ${tile(byKind('document'), 'document')}
      ${tile(byKind('svg'), 'svg (checkerboard)')}
      ${tile(withAlt, 'uploading', { extraClass: 'is-uploading', after: progress })}
      ${tile(withoutAlt, 'error', { extraClass: 'is-error' })}
    </div>
    <div class="specimen specimen--app">
      ${item(
        'progress ring',
        html`<div style="position:relative;width:72px;height:72px;background:var(--surface-tile)">${progress}</div>`,
      )}
      ${item('badges', html`<span style="display:flex;gap:6px"><span class="badge badge--warn">${icon('accessible', 'icon--sm')}Alt</span><span class="badge">${icon('movie', 'icon--sm')}1:34</span><span class="badge">PDF · 3 p</span><span class="badge badge--danger">Failed</span></span>`)}
    </div>`,
  )
}

function tree() {
  const row = (
    label,
    name,
    count,
    extra = '',
    depth = 0,
    iconName = 'folder',
    style = '',
  ) =>
    html`<button class="tree__row ${extra}" style="--depth:${depth};${style}" ${extra === 'current' ? 'aria-current="true"' : ''}>
      <span class="tree__twisty tree__twisty--empty"></span>${icon(iconName, 'icon--sm')}
      <span class="tree__name">${name}</span><span class="tree__count">${count}</span>
    </button>${label ? html`<span class="specimen__label" style="padding:0 16px">${label}</span>` : ''}`
  return section(
    'tree',
    'Folder tree',
    'FileBird folders: counts in mono, current folder in neon with a leading bar. Folder colours only appear when FileBird Pro is detected.',
    html`<div class="specimen">
      <div class="tree-specimen">
        ${row('rest', 'Brand', 1)}
        ${row('hover', 'Blog', 1, 'state-hover')}
        ${html`<button class="tree__row" aria-current="true" style="--depth:1"><span class="tree__twisty tree__twisty--empty"></span>${icon('folder-open', 'icon--sm')}<span class="tree__name">2026</span><span class="tree__count">8</span></button><span class="specimen__label" style="padding:0 16px">current</span>`}
        ${row('drop target', 'Spring campaign', 10, 'is-drop-target', 2)}
        ${html`<div class="tree__row" style="--depth:1"><span class="tree__twisty tree__twisty--empty"></span>${icon('folder', 'icon--sm')}<input class="input tree__rename state-focus" value="Summer 2026" /></div><span class="specimen__label" style="padding:0 16px">inline rename</span>`}
        ${html`<button class="tree__row"><span class="tree__twisty tree__twisty--empty"></span><span class="tree__color" style="--folder-color:#ff7a59">${icon('folder', 'icon--sm')}</span><span class="tree__name">Events</span><span class="tree__count">0</span></button><span class="specimen__label" style="padding:0 16px">Pro colour</span>`}
      </div>
      ${item(
        'context menu',
        html`<div class="menu">
          <div class="menu__label">Folder</div>
          <button class="menu__item">${icon('folder-plus')}New subfolder<kbd>N</kbd></button>
          <button class="menu__item state-hover">${icon('pencil')}Rename</button>
          <button class="menu__item">${icon('folders')}Move to…</button>
          <div class="menu__separator"></div>
          <button class="menu__item menu__item--danger">${icon('trash')}Delete folder</button>
        </div>`,
      )}
    </div>`,
  )
}

function inspector() {
  const image = library.items.find(
    (entry) => entry.kind === 'image' && entry.exif,
  )
  return section(
    'inspector',
    'Inspector',
    'One panel slot with an icon rail. Content follows the selection: folder summary (none), fields (one), batch with “Mixed” (many).',
    html`<div class="specimen">
      <div class="panel-specimen">
        <nav class="rail">
          <button class="icon-btn" aria-pressed="true">${icon('info-circle')}</button>
          <button class="icon-btn">${icon('crop')}</button>
          <button class="icon-btn">${icon('link')}</button>
        </nav>
        <div class="inspector__panel">
          <div class="panel-header"><span class="panel-header__title">Info</span></div>
          <div class="inspector__body">
            <div>
              <h2 class="inspector__heading">Editing 12 items</h2>
              <p class="inspector__sub">8.4 MB · changes apply to all selected items</p>
            </div>
            <label class="field field--mixed"><span class="field__label">Alt text</span><input class="input" placeholder="Mixed (12)" /></label>
            <label class="field"><span class="field__label">Caption<span class="field__status field__status--saved is-visible">${icon('check', 'icon--sm')}Saved</span></span><input class="input" value="Photo: Unsplash" /></label>
            <div class="notice notice--warn">${icon('alert-triangle')}<span>4 of these images have no alt text.</span></div>
          </div>
        </div>
      </div>
      <div class="panel-specimen" style="flex-direction:column;padding:16px;gap:16px">
        <section class="section">
          <h3 class="section__title">File</h3>
          <dl class="meta">
            <dt>Folder</dt><dd>Blog / 2026</dd>
            <dt>Uploaded</dt><dd>7 Nov 2025 by Jonas Holm</dd>
            <dt>Dimensions</dt><dd>${image.width} × ${image.height}</dd>
          </dl>
        </section>
        <section class="section">
          <h3 class="section__title">Camera</h3>
          <dl class="meta">
            <dt>Camera</dt><dd>${image.exif.camera}</dd>
            <dt>Exposure</dt><dd>${image.exif.focalLength} mm · f/${image.exif.aperture} · ISO ${image.exif.iso}</dd>
          </dl>
        </section>
        <div class="stat-grid">
          <div class="stat"><div class="stat__value">93</div><div class="stat__label">items</div></div>
          <div class="stat"><div class="stat__value">18</div><div class="stat__label">missing alt text</div></div>
        </div>
        <div class="notice">${icon('info-circle')}<span>Used in 2 posts. Deleting it removes it there too.</span></div>
      </div>
    </div>`,
  )
}

function filmstrip() {
  const strip = library.items
    .filter((entry) => entry.kind === 'image')
    .slice(0, 9)
  const cells = strip.map((entry, index) => {
    let markup = String(tileHtml(entry, { width: 0, height: 80 }))
    if (index === 3)
      markup = markup.replace('class="tile ', 'class="tile is-current ')
    if (index === 5 || index === 6 || index === 3) {
      markup = markup.replace('aria-selected="false"', 'aria-selected="true"')
    }
    return markup
  })
  return section(
    'filmstrip',
    'Filmstrip',
    'Detail mode only. Neighbours are dimmed; the current item has a neutral outline; selected items keep their neon ring and check — both can show at once (4th cell).',
    html`<div class="specimen specimen--stage">
      <div class="filmstrip filmstrip--specimen">${raw(cells.join(''))}</div>
    </div>`,
  )
}

function overlays() {
  const image = library.items.find((entry) => entry.kind === 'image')
  return section(
    'overlays',
    'Overlays and feedback',
    'Reversible actions get an undo toast; permanent ones a confirm dialog that shows where the item is used. Uploads appear in a compact tray; dropping files anywhere shows a full-window target.',
    html`<div class="specimen specimen--app">
        ${item(
          'toast with undo',
          html`<div class="toast">${icon('check')}<span class="toast__text">Moved 3 items to “Spring campaign”</span><button class="btn btn--ghost btn--sm toast__action">Undo</button></div>`,
        )}
        ${item(
          'upload tray',
          html`<div class="tray">
            <div class="tray__header">${icon('cloud-upload')}Uploading 3 of 5<span class="toolbar__spacer"></span><button class="icon-btn">${icon('chevron-down')}</button></div>
            <ul class="tray__list">
              <li class="tray__item"><img class="tray__thumb" src="https://picsum.photos/id/${image.picsumId}/64/64" alt="" /><div><div class="tray__name">IMG_4821.jpg</div><div class="tray__bar" style="--progress:.7"><span></span></div></div><span class="specimen__label">70%</span></li>
              <li class="tray__item"><span class="tray__thumb"></span><div><div class="tray__name">studio-tour-final.mp4</div><div class="tray__bar" style="--progress:.15"><span></span></div></div><span class="specimen__label">15%</span></li>
              <li class="tray__item"><span class="tray__thumb"></span><div class="tray__name">menu-card.pdf</div><span style="color:var(--ok)">${icon('circle-check', 'icon--sm')}</span></li>
            </ul>
          </div>`,
        )}
      </div>
      <div class="specimen specimen--app">
        <div class="scrim">
          <div class="dialog" role="dialog" aria-label="Delete permanently">
            <h2 class="dialog__title">Delete 2 items permanently?</h2>
            <p class="dialog__text">This site has no media trash, so this can’t be undone.</p>
            <div class="notice notice--danger">${icon('alert-triangle')}<span>Used in “Spring newsletter” and “Home”. They will show a broken image.</span></div>
            <div class="dialog__actions">
              <button class="btn">Cancel</button>
              <button class="btn btn--danger-solid">Delete permanently</button>
            </div>
          </div>
        </div>
      </div>
      <div class="specimen specimen--app">
        <div class="drop-overlay">
          <div class="drop-overlay__target">${icon('cloud-upload')}Drop to upload to “Spring campaign”</div>
        </div>
      </div>
      <div class="specimen specimen--app specimen--column">
        <span class="specimen__label">skeleton (loading)</span>
        <div class="skeleton-row">
          <div class="skeleton" style="flex:1.5"></div><div class="skeleton" style="flex:0.7"></div><div class="skeleton" style="flex:1.3"></div><div class="skeleton" style="flex:1"></div>
        </div>
        <span class="specimen__label">empty state</span>
        <div class="empty">
          <div class="empty__art">${icon('photo')}</div>
          <h3 class="empty__title">This folder is empty</h3>
          <p class="empty__text">Drop files here, or move media into it from another folder.</p>
          <button class="btn btn--primary">${icon('upload')}Upload</button>
        </div>
      </div>`,
  )
}

// --- Page --------------------------------------------------------------------------

const NAV = [
  ['colour', 'Colour'],
  ['type', 'Type'],
  ['shape', 'Shape & motion'],
  ['icons', 'Icons'],
  ['buttons', 'Buttons'],
  ['inputs', 'Inputs'],
  ['chips', 'Chips'],
  ['tiles', 'Tiles'],
  ['tree', 'Tree'],
  ['inspector', 'Inspector'],
  ['filmstrip', 'Filmstrip'],
  ['overlays', 'Overlays'],
]

function renderHeader() {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
  document.getElementById('system-header').innerHTML = String(html`
    <a class="brand" href="./">${brandMark()}<span class="brand__wordmark">wp-upload</span></a>
    <span class="breadcrumb__current">Design system</span>
    <nav>${NAV.map(([id, label]) => html`<a class="btn btn--ghost btn--sm" href="#${id}">${label}</a>`)}</nav>
    <span class="toolbar__spacer"></span>
    <a class="btn btn--sm" href="?theme=${next}">${icon(next === 'light' ? 'sun' : 'moon')}${next === 'light' ? 'Light' : 'Dark'} theme</a>
    <a class="btn btn--sm" href="./">Prototype</a>
  `)
}

async function start() {
  renderHeader()
  await loadLibrary()
  const parts = [
    colours(),
    typography(),
    shapeAndMotion(),
    await icons(),
    buttons(),
    inputs(),
    chipsAndBars(),
    tiles(),
    tree(),
    inspector(),
    filmstrip(),
    overlays(),
  ]
  document.getElementById('system-main').innerHTML = parts.join('')
  // The reference page is short enough to load every specimen image eagerly
  // (lazy images never load in full-page screenshots).
  for (const img of document.querySelectorAll('.tile img')) {
    img.loading = 'eager'
    if (img.complete) img.classList.add('is-loaded')
    else img.addEventListener('load', () => img.classList.add('is-loaded'))
  }
}

start()
