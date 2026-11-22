// The Info panel: folder summary (nothing selected), metadata fields and
// file details (one item), and batch editing with "Mixed" values (many).

import { KIND_ICONS, KIND_LABELS, pictureUrl } from '../data.js'
import { selectOnly } from '../selection.js'
import {
  collection,
  folderItems,
  isImageLike,
  state,
  update,
} from '../store.js'
import { showToast } from '../ui.js'
import { writeUrl } from '../url.js'
import {
  formatBytes,
  formatDate,
  formatDuration,
  html,
  icon,
  raw,
  truncateMiddle,
} from '../util.js'
import {
  fieldStatus,
  renderStatus,
  startAltPass,
  statusClass,
  statusKey,
} from './inspector-autosave.js'
import {
  canEdit,
  copyText,
  fileUrl,
  folderName,
  isAuthorRole,
  isEditableImage,
  isScaled,
  needsAlt,
  originalFilename,
  plural,
  READ_ONLY_NOTICE,
  registerInspectorAction,
  requestRender,
  subSizes,
  subtype,
  ui,
} from './inspector-shared.js'

// --- Building blocks ------------------------------------------------------------

// One editable field. Its autosave status lives in inspector-autosave.js,
// keyed by item ids + field name, so it survives re-renders.
export function field({
  ids,
  name,
  label,
  value,
  multiline = false,
  rows = 3,
  placeholder = '',
  readOnly = false,
  mixed = false,
  warn = false,
  flag = '',
  hint = '',
  after = '',
  mode,
}) {
  const key = statusKey(ids, name)
  const entry = fieldStatus(key)
  const error = entry?.state === 'error'
  // A failed save keeps the text the user typed, so Retry has something to send.
  const shown = error ? entry.value : value
  const id = `insp-${name}`
  const attributes = html`id="${id}" name="${name}" data-original="${value}"
    placeholder="${placeholder}" ${readOnly ? raw('readonly') : ''}
    ${mode ? html`data-mode="${mode}"` : ''} aria-describedby="${id}-hint"`
  const control = multiline
    ? html`<textarea class="input" rows="${rows}" ${attributes}>${shown}</textarea>`
    : html`<input class="input" value="${shown}" ${attributes} />`
  const modifiers = [
    warn && !error ? 'field--warn' : '',
    mixed ? 'field--mixed' : '',
    error ? 'field--error' : '',
    readOnly ? 'field--readonly' : '',
  ].join(' ')
  return html`<div class="field ${modifiers}" data-field="${name}">
    <span class="field__label">
      <label for="${id}">${label}</label>${flag}
      <span class="${statusClass(entry)}" data-status-for="${key}">${raw(renderStatus(key))}</span>
    </span>
    ${control}
    <span class="field__hint field__hint--error" id="${id}-hint" ${error ? '' : raw('hidden')}>
      Not saved — WordPress didn't respond. Your text is kept here.
    </span>
    ${hint ? html`<span class="field__hint">${hint}</span>` : ''} ${after}
  </div>`
}

function section(id, title, body, { count } = {}) {
  const open = !ui.collapsed.has(id)
  return html`<details class="section insp-section" data-section="${id}" ${open ? raw('open') : ''}>
    <summary class="insp-section__summary">
      <span class="section__title">${title}</span>
      ${count !== undefined ? html`<span class="insp-section__count num">${count}</span>` : ''}
      ${icon('chevron-down', 'icon--sm insp-section__chevron')}
    </summary>
    <div class="insp-section__body">${body}</div>
  </details>`
}

function readOnlyNotice() {
  return html`<div class="notice insp-lock mm-readonly" role="note">
    ${icon('lock')}<span>${READ_ONLY_NOTICE}</span>
  </div>`
}

// A thin progress meter (alt-text coverage). Uses --ok, not the accent:
// it reports a state, it isn't a control.
function meter(done, total, label) {
  const value = total ? done / total : 1
  return html`<div
    class="meter"
    role="meter"
    aria-label="${label}"
    aria-valuemin="0"
    aria-valuemax="${total}"
    aria-valuenow="${done}"
  >
    <span class="meter__fill" style="--value:${value.toFixed(3)}"></span>
  </div>`
}

function scopeName() {
  return state.folder === 'all' ? 'All files' : folderName(state.folder)
}

function altCoverage() {
  const images = folderItems().filter(isImageLike)
  const missing = images.filter((item) => !item.alt).length
  return { total: images.length, done: images.length - missing, missing }
}

function kindLine(item) {
  const parts = [
    KIND_LABELS[item.kind],
    subtype(item),
    formatBytes(item.filesize),
  ]
  if (item.width > 1 && item.kind !== 'audio') {
    parts.push(`${item.width} × ${item.height}`)
  }
  if (item.duration) parts.push(formatDuration(item.duration))
  if (item.pages) parts.push(plural(item.pages, 'page'))
  return parts.join(' · ')
}

// --- Nothing selected: folder summary -----------------------------------------------------

function typeBreakdown(items) {
  const groups = [
    ['Images', items.filter(isImageLike).length, 'photo'],
    ['Videos', items.filter((item) => item.kind === 'video').length, 'movie'],
    ['Audio', items.filter((item) => item.kind === 'audio').length, 'music'],
    [
      'Documents',
      items.filter(
        (item) => item.kind === 'document' || item.kind === 'archive',
      ).length,
      'file-text',
    ],
  ].filter(([, count]) => count > 0)
  return html`<ul class="breakdown">
    ${groups.map(
      ([label, count, iconName]) =>
        html`<li>${icon(iconName, 'icon--sm')}<span>${label}</span><span class="num">${count}</span></li>`,
    )}
  </ul>`
}

export function summaryPanel() {
  const items = collection()
  const total = items.reduce((sum, item) => sum + item.filesize, 0)
  const missingAlt = items.filter(needsAlt).length
  const unused = items.filter((item) => item.usedIn.length === 0).length
  const coverage = altCoverage()
  const editable = items.filter(canEdit).length
  return html`<div class="inspector__body insp-summary">
    <div>
      <h2 class="inspector__heading">${scopeName()}</h2>
      <p class="inspector__sub">Nothing selected · ${plural(items.length, 'item')} in view</p>
    </div>
    <div class="stat-grid">
      <div class="stat">
        <div class="stat__value num">${items.length}</div>
        <div class="stat__label">${items.length === 1 ? 'item' : 'items'}</div>
      </div>
      <div class="stat">
        <div class="stat__value num">${formatBytes(total)}</div>
        <div class="stat__label">total size</div>
      </div>
      <button class="stat stat--action ${missingAlt ? 'stat--warn' : ''}" data-insp="filter-missing-alt"
        ${missingAlt ? '' : raw('disabled')} title="Show only images without alt text">
        <div class="stat__value num">${missingAlt}</div>
        <div class="stat__label">missing alt text</div>
      </button>
      <div class="stat">
        <div class="stat__value num">${unused}</div>
        <div class="stat__label">not used anywhere</div>
      </div>
    </div>
    ${
      coverage.total
        ? html`<section class="section">
            <h3 class="section__title">Alt text</h3>
            <div class="alt-coverage">
              <div class="alt-coverage__row">
                <span><strong class="num">${coverage.done}</strong> of <span class="num">${coverage.total}</span> images in ${scopeName()} have alt text</span>
                <span class="num alt-coverage__pct">${Math.round((coverage.done / coverage.total) * 100)}%</span>
              </div>
              ${meter(coverage.done, coverage.total, 'Alt text coverage')}
              ${
                coverage.missing
                  ? html`<button class="btn" data-insp="start-alt-pass">${icon('accessible')}Start alt-text pass</button>
                    <p class="field__hint">Walks through the ${plural(coverage.missing, 'image')} without alt text. <kbd>Enter</kbd> saves and moves to the next.</p>`
                  : html`<p class="alt-coverage__done">${icon('circle-check', 'icon--sm')}Every image here has alt text.</p>`
              }
            </div>
          </section>`
        : ''
    }
    <section class="section">
      <h3 class="section__title">In this view</h3>
      ${typeBreakdown(items)}
    </section>
    ${
      isAuthorRole()
        ? html`<div class="notice">${icon('lock')}<span>You can edit ${editable} of ${plural(items.length, 'item')} here — the ones you uploaded. Others are view-only for the Author role.</span></div>`
        : ''
    }
    <p class="field__hint">Select an item to see its details. <kbd>Enter</kbd> opens it, <kbd>E</kbd> edits an image.</p>
  </div>`
}

// --- One item --------------------------------------------------------------------------------

function preview(item) {
  // Detail mode already shows the image large; repeating it wastes space.
  if (state.view === 'detail') return ''
  const src = pictureUrl(item, 768)
  const edited = item.edit
    ? html`<span class="badge insp-preview__badge">${icon('crop', 'icon--sm')}Edited</span>`
    : ''
  const open = html`<button class="icon-btn insp-preview__open" data-insp="open-detail" title="Open (Enter)" aria-label="Open ${item.title}">
    ${icon('arrows-maximize')}
  </button>`
  if (item.kind === 'svg') {
    return html`<div class="inspector__preview insp-preview insp-preview--svg">
      <img src="${src}" alt="" />${open}
    </div>`
  }
  // Fresh uploads have no picture yet; the upload feature fills one in.
  if (!src && item.kind === 'image') return ''
  if (!src) {
    return html`<div class="inspector__preview insp-preview insp-preview--doc">
      ${icon(KIND_ICONS[item.kind], 'icon--lg')}
      <span>${KIND_LABELS[item.kind]}${item.pages ? ` · ${plural(item.pages, 'page')}` : ''}${item.duration ? ` · ${formatDuration(item.duration)}` : ''}</span>
      ${open}
    </div>`
  }
  return html`<div class="inspector__preview insp-preview">
    <img src="${src}" alt="" />${edited}
    ${item.kind === 'video' ? html`<span class="insp-preview__play">${icon('player-play')}</span>` : ''}
    ${open}
  </div>`
}

function altPass(item) {
  const coverage = altCoverage()
  if (!coverage.total || (coverage.missing === 0 && !state.missingAlt))
    return ''
  const items = collection()
  const index = items.findIndex((entry) => entry.id === item.id)
  return html`<div class="alt-pass ${state.missingAlt ? 'alt-pass--active' : ''}">
    <div class="alt-pass__row">
      <span class="num">${coverage.missing === 0 ? icon('circle-check', 'icon--sm') : ''}${coverage.missing} missing</span>
      <span class="alt-pass__scope">in ${scopeName()}</span>
      <span class="alt-pass__pos num">${index + 1} / ${items.length}</span>
    </div>
    ${meter(coverage.done, coverage.total, `Alt text coverage in ${scopeName()}`)}
    <div class="alt-pass__keys">
      <span><kbd>Enter</kbd> save &amp; next</span>
      <span><kbd>Shift</kbd><kbd>Enter</kbd> previous</span>
      <span><kbd>Esc</kbd> revert</span>
    </div>
  </div>`
}

function attachedRow(item, editable) {
  if (item.attachedTo) {
    return html`<dd class="meta__with-action">
      <span class="meta__value" title="${item.attachedTo.title}">${item.attachedTo.title}</span>
      ${editable ? html`<button class="btn btn--ghost btn--sm" data-insp="detach">Detach</button>` : ''}
    </dd>`
  }
  return html`<dd class="meta__with-action">
    <span class="meta__value meta__value--muted">Not attached</span>
    ${editable ? html`<button class="btn btn--ghost btn--sm" data-insp="attach">Attach…</button>` : ''}
  </dd>`
}

function fileSection(item, editable) {
  const url = fileUrl(item)
  const scaled = isScaled(item)
  return section(
    'file',
    'File',
    html`<dl class="meta">
        <dt>Folder</dt>
        <dd>${folderName(item.folder)}</dd>
        <dt>Uploaded</dt>
        <dd>${formatDate(item.uploaded)} by ${item.author}</dd>
        ${
          item.edit
            ? html`<dt>Edited</dt><dd>${formatDate(item.edit.at)}</dd>`
            : ''
        }
        <dt>Attached to</dt>
        ${attachedRow(item, editable)}
        <dt>File name</dt>
        <dd title="${item.filename}">${truncateMiddle(item.filename, 30)}</dd>
        <dt>Type</dt>
        <dd>${item.mime}</dd>
        <dt>Size</dt>
        <dd class="num">${formatBytes(item.filesize)}</dd>
        ${
          item.width > 1 && item.kind !== 'audio'
            ? html`<dt>Dimensions</dt><dd class="num">${item.width} × ${item.height}</dd>`
            : ''
        }
        ${
          scaled
            ? html`<dt>Original</dt>
              <dd class="meta__with-action">
                <span class="meta__value num" title="${originalFilename(item)}">${item.originalWidth} × ${item.originalHeight}</span>
                <button class="btn btn--ghost btn--sm" data-insp="copy-url" data-url="${fileUrl(item, originalFilename(item))}" data-label="Original image URL">Copy URL</button>
              </dd>`
            : ''
        }
      </dl>
      ${
        scaled
          ? html`<p class="field__hint">WordPress scaled this upload down to 2560 px. The original is kept for printing and restores.</p>`
          : ''
      }
      <div class="copy-field">
        <input class="input" readonly value="${url}" aria-label="File URL" />
        <button class="btn" data-insp="copy-url" data-url="${url}" data-label="URL">${icon('copy')}Copy</button>
      </div>`,
  )
}

function cameraSection(item) {
  const exif = item.exif
  if (!exif) return ''
  return section(
    'camera',
    'Camera',
    html`<dl class="meta">
      <dt>Camera</dt>
      <dd title="${exif.camera}">${exif.camera}</dd>
      <dt>Lens</dt>
      <dd title="${exif.lens}">${exif.lens}</dd>
      <dt>Exposure</dt>
      <dd class="num">${exif.focalLength} mm · f/${exif.aperture} · ${exif.shutter} s · ISO ${exif.iso}</dd>
      ${exif.taken ? html`<dt>Taken</dt><dd>${formatDate(exif.taken)}</dd>` : ''}
    </dl>`,
  )
}

function sizesSection(item) {
  const sizes = subSizes(item)
  if (sizes.length === 0) return ''
  const rows = [
    ...sizes.map((size) => ({
      label: size.label,
      dims: `${size.width} × ${size.height}`,
      url: fileUrl(item, size.filename),
    })),
    {
      label: isScaled(item) ? 'Full (scaled)' : 'Full size',
      dims: `${item.width} × ${item.height}`,
      url: fileUrl(item),
    },
  ]
  return section(
    'sizes',
    'Sizes',
    html`<ul class="size-list">
      ${rows.map(
        (row) => html`<li>
          <span class="size-list__name">${row.label}</span>
          <span class="size-list__dims num">${row.dims}</span>
          <button class="icon-btn size-list__copy" data-insp="copy-url" data-url="${row.url}" data-label="${row.label} URL"
            title="Copy URL of ${row.label}" aria-label="Copy URL of ${row.label}">${icon('copy', 'icon--sm')}</button>
        </li>`,
      )}
    </ul>`,
    { count: rows.length },
  )
}

export function singlePanel(item) {
  const editable = canEdit(item)
  const missing = needsAlt(item)
  const ids = [item.id]
  return html`<div class="inspector__body" data-ids="${item.id}" data-item="${item.id}">
    ${preview(item)}
    <div>
      <h2 class="inspector__heading" title="${item.filename}">${truncateMiddle(item.filename, 36)}</h2>
      <p class="inspector__sub num">${kindLine(item)}</p>
    </div>
    ${editable ? '' : readOnlyNotice()}
    ${field({ ids, name: 'title', label: 'Title', value: item.title, readOnly: !editable })}
    ${
      isImageLike(item)
        ? field({
            ids,
            name: 'alt',
            label: 'Alt text',
            value: item.alt,
            warn: missing,
            readOnly: !editable,
            multiline: true,
            rows: 2,
            placeholder: 'Describe the image for people who can’t see it',
            flag: missing
              ? html`<span class="field__flag">${icon('accessible', 'icon--sm')}Missing</span>`
              : '',
            hint: missing ? 'Screen readers skip images without alt text.' : '',
            after: editable ? altPass(item) : '',
          })
        : ''
    }
    ${field({
      ids,
      name: 'caption',
      label: 'Caption',
      value: item.caption,
      multiline: true,
      rows: 2,
      readOnly: !editable,
    })}
    ${field({
      ids,
      name: 'description',
      label: 'Description',
      value: item.description,
      multiline: true,
      readOnly: !editable,
    })}
    ${fileSection(item, editable)} ${cameraSection(item)} ${sizesSection(item)}
    <div class="actions">
      ${
        isEditableImage(item)
          ? html`<button class="btn" data-insp="open-editor" ${editable ? '' : raw('disabled title="Only the uploader or an Editor can edit this image"')}>
              ${icon('crop')}Edit image<kbd>E</kbd>
            </button>`
          : ''
      }
      <button class="btn" data-mm-action="download">${icon('download')}Download</button>
      ${
        editable
          ? html`<button class="btn btn--ghost btn--danger" data-mm-action="delete">${icon('trash')}Delete</button>`
          : ''
      }
    </div>
  </div>`
}

// --- Several items ---------------------------------------------------------------------------

function mixedState(items, key) {
  const values = new Set(items.map((item) => item[key]))
  return values.size === 1
    ? { value: [...values][0], mixed: false, distinct: 1 }
    : { value: '', mixed: true, distinct: values.size }
}

function batchThumbs(items) {
  const shown = items.slice(0, 6)
  const rest = items.length - shown.length
  return html`<div class="batch-thumbs" role="list" aria-label="Selected items">
    ${shown.map((item) => {
      const src = pictureUrl(item, 150)
      return html`<button class="batch-thumbs__item" role="listitem" data-insp="select-one" data-id="${item.id}"
        title="${item.title} — select only this" aria-label="Select only ${item.title}">
        ${src ? html`<img src="${src}" alt="" />` : icon(KIND_ICONS[item.kind], 'icon--sm')}
      </button>`
    })}
    ${rest > 0 ? html`<span class="batch-thumbs__more num">+${rest}</span>` : ''}
  </div>`
}

function batchField(
  items,
  ids,
  { name, label, multiline, readOnly, extraLabel = '' },
) {
  const { value, mixed, distinct } = mixedState(items, name)
  const append = name === 'description' && ui.descriptionMode === 'append'
  return field({
    ids,
    name,
    label: html`${label}${extraLabel}`,
    value: append ? '' : value,
    mixed: mixed && !append,
    multiline,
    rows: 2,
    readOnly,
    mode: append ? 'append' : undefined,
    placeholder: append
      ? `Added to the end of each description`
      : mixed
        ? `Mixed — ${distinct} different values`
        : '',
    hint:
      mixed && !append && !readOnly
        ? 'Leave empty to keep each item’s own text.'
        : '',
  })
}

function descriptionMode() {
  const option = (mode, label) =>
    html`<button type="button" class="segmented__option" data-insp="description-mode" data-mode="${mode}"
      aria-pressed="${String(ui.descriptionMode === mode)}">${label}</button>`
  return html`<div class="segmented segmented--text" role="group" aria-label="How the description is applied">
    ${option('replace', 'Replace')}${option('append', 'Append')}
  </div>`
}

export function batchPanel(items) {
  const editableItems = items.filter(canEdit)
  const readOnly = editableItems.length === 0
  // Fields write only to items the user may edit; ids carry just those.
  const ids = editableItems.map((item) => item.id)
  const fieldItems = readOnly ? items : editableItems
  const images = fieldItems.filter(isImageLike)
  const missing = images.filter((item) => !item.alt).length
  const total = items.reduce((sum, item) => sum + item.filesize, 0)
  const others = items.length - items.filter(isImageLike).length
  const idsAttribute = (readOnly ? items : editableItems)
    .map((item) => item.id)
    .join(',')
  return html`<div class="inspector__body" data-ids="${idsAttribute}">
    ${batchThumbs(items)}
    <div>
      <h2 class="inspector__heading">Editing ${items.length} items</h2>
      <p class="inspector__sub num">
        ${formatBytes(total)} · ${plural(items.length - others, 'image')}${others ? `, ${plural(others, 'other file')}` : ''}
      </p>
    </div>
    ${
      readOnly
        ? readOnlyNotice()
        : editableItems.length < items.length
          ? html`<div class="notice notice--warn mm-readonly" role="note">${icon('lock')}<span>Changes apply to the <strong>${editableItems.length}</strong> items you uploaded. ${items.length - editableItems.length} uploaded by others stay as they are (Author role).</span></div>`
          : html`<p class="insp-batch-rule">${icon('info-circle', 'icon--sm')}Edits apply to all ${fieldItems.length} items. Mixed fields left empty stay as they are.</p>`
    }
    ${batchField(fieldItems, ids, { name: 'title', label: 'Title', readOnly })}
    ${
      images.length
        ? batchField(images, ids, {
            name: 'alt',
            label: 'Alt text',
            multiline: true,
            readOnly,
            extraLabel: html`<span class="field__label-note num">· ${plural(images.length, 'image')}</span>`,
          })
        : ''
    }
    ${
      missing && !readOnly
        ? html`<div class="notice notice--warn insp-alt-note">
            ${icon('accessible')}
            <div>
              <p><strong>${missing} of ${images.length}</strong> images have no alt text. Alt text should describe each image, so one shared text is rarely right.</p>
              <button class="btn btn--sm" data-insp="start-alt-pass">Start alt-text pass</button>
            </div>
          </div>`
        : ''
    }
    ${batchField(fieldItems, ids, { name: 'caption', label: 'Caption', multiline: true, readOnly })}
    <div class="insp-desc">
      ${readOnly ? '' : descriptionMode()}
      ${batchField(fieldItems, ids, { name: 'description', label: 'Description', multiline: true, readOnly })}
    </div>
    <div class="actions">
      <button class="btn" data-mm-action="move-to-folder">${icon('folder')}Move to folder</button>
      <button class="btn" data-mm-action="download">${icon('download')}Download</button>
      ${
        readOnly
          ? ''
          : html`<button class="btn btn--ghost btn--danger" data-mm-action="delete">${icon('trash')}Delete</button>`
      }
    </div>
  </div>`
}

// --- Actions ---------------------------------------------------------------------------------

export function initInfoActions() {
  registerInspectorAction('copy-url', async (button) => {
    await copyText(button.dataset.url)
    showToast({
      text: `${button.dataset.label ?? 'URL'} copied`,
      iconName: 'copy',
      duration: 2500,
    })
  })
  registerInspectorAction('start-alt-pass', () => startAltPass())
  registerInspectorAction('filter-missing-alt', () => {
    update({ missingAlt: true }, ['collection'])
    writeUrl()
  })
  registerInspectorAction('description-mode', (button) => {
    ui.descriptionMode = button.dataset.mode
    requestRender()
  })
  registerInspectorAction('select-one', (button) => {
    selectOnly(Number(button.dataset.id))
  })
}
