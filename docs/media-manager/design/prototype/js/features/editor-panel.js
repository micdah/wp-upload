// The Edit panel in the inspector: crop ratios and size, rotate and flip,
// scale, "apply to", plus file maintenance — restore original, regenerate
// thumbnails, replace file. The canvas lives in editor-overlay.js.

import { KIND_LABELS, library } from '../data.js'
import { selectOnly, targetItems } from '../selection.js'
import { confirmDialog, libraryChanged, showToast } from '../ui.js'
import { announce, formatBytes, formatDate, html, icon, raw } from '../util.js'
import {
  APPLY_TO,
  cropSize,
  flip,
  isDirty,
  onSessionChange,
  output,
  RATIOS,
  resetAll,
  rotate,
  session,
  setApplyTo,
  setCropSize,
  setRatio,
  setScale,
  togglePortrait,
} from './editor-session.js'
import {
  canEdit,
  fakeRequest,
  isEditableImage,
  plural,
  READ_ONLY_NOTICE,
  registerInspectorAction,
  requestRender,
  subSizes,
  subtype,
} from './inspector-shared.js'

// A running maintenance task (regenerate, restore, replace), shown in place
// of its button: { kind, ids, done, total, label }.
let task = null

// --- Building blocks ---------------------------------------------------------------------

function numberInput(name, label, value, max) {
  return html`<label class="ed-num">
    <span class="ed-num__label">${label}</span>
    <input class="input" type="number" inputmode="numeric" min="1" max="${max}" value="${value}"
      data-ed-input="${name}" aria-label="${name.startsWith('crop') ? 'Crop' : 'Scale'} ${label === 'W' ? 'width' : 'height'} in pixels" />
  </label>`
}

function taskProgress() {
  return html`<div class="ed-task" role="status">
    <div class="ed-task__row"><span>${task.label}</span><span class="num" data-task-count>${task.done} / ${task.total}</span></div>
    <div class="meter meter--progress-static"><span class="meter__fill" data-task-fill style="--value:${task.total ? task.done / task.total : 0}"></span></div>
  </div>`
}

function regenerateHint(ids) {
  if (ids.length > 1) {
    return `Rebuilds every size of ${plural(ids.length, 'image')} from the full images.`
  }
  const item = library.byId.get(ids[0])
  if (!isEditableImage(item)) {
    return 'Rebuilds the preview images WordPress makes from the first page.'
  }
  return `Rebuilds ${plural(subSizes(item).length, 'size')} from the full image — after a theme adds sizes, or if thumbnails look wrong.`
}

function regenerateButton(ids, { disabled = false } = {}) {
  const pdf = ids.length === 1 && !isEditableImage(library.byId.get(ids[0]))
  return html`<div class="ed-maint">
    <button class="btn" data-insp="ed-regenerate" ${disabled ? raw('disabled') : ''}>
      ${icon('refresh')}${pdf ? 'Regenerate preview' : 'Regenerate thumbnails'}${ids.length > 1 ? html` <span class="num">(${ids.length})</span>` : ''}
    </button>
    <p class="field__hint">${regenerateHint(ids)}</p>
  </div>`
}

function restoreButton(item, disabled) {
  if (!item.edit) return ''
  return html`<div class="ed-maint">
    <button class="btn" data-insp="ed-restore" ${disabled ? raw('disabled') : ''}>${icon('arrow-back-up')}Restore original</button>
    <p class="field__hint">Edited ${formatDate(item.edit.at)}. Undoes every saved edit; the URL stays the same.</p>
  </div>`
}

function replaceZone(item, disabled) {
  return html`<div class="ed-maint">
    <div class="dropzone ${disabled ? 'is-disabled' : ''}" data-drop-zone="replace" data-insp-drop>
      ${icon('replace')}
      <div class="dropzone__text">
        <strong>Replace file</strong>
        <span>Drop a ${subtype(item)} here, or
          <button type="button" class="link-btn" data-insp="ed-replace-pick" ${disabled ? raw('disabled') : ''}>choose a file</button></span>
      </div>
      <input type="file" class="sr-only" data-ed-file accept="${item.mime}" tabindex="-1" aria-hidden="true" />
    </div>
    <p class="field__hint">Keeps the ID and URL, so every post using it shows the new file.</p>
  </div>`
}

function maintenance(item, { dirty = false } = {}) {
  const editable = canEdit(item)
  const blocked = dirty || !editable
  return html`<section class="section ed-maintenance">
    <h3 class="section__title">File</h3>
    ${
      task?.ids.includes(item.id)
        ? taskProgress()
        : html`${restoreButton(item, blocked)}
          ${isEditableImage(item) || item.mime === 'application/pdf' ? regenerateButton([item.id], { disabled: blocked }) : ''}
          ${replaceZone(item, blocked)}`
    }
    ${dirty ? html`<p class="field__hint ed-maint__blocked">${icon('info-circle', 'icon--sm')}Save or cancel your edits first.</p>` : ''}
  </section>`
}

// --- Panels --------------------------------------------------------------------------------

function sessionPanel(item) {
  const crop = cropSize()
  const out = output()
  const dirty = isDirty()
  return html`<div class="inspector__body editor-panel" data-edit-panel>
    <div>
      <h2 class="inspector__heading">Crop &amp; rotate</h2>
      <p class="inspector__sub num" data-ed-out>${item.width} × ${item.height}${dirty ? ` → ${out.w} × ${out.h}` : ''}</p>
    </div>
    <section class="section">
      <h3 class="section__title">Aspect ratio</h3>
      <div class="ratio-grid" role="group" aria-label="Aspect ratio">
        ${RATIOS.map(
          (
            ratio,
          ) => html`<button type="button" class="chip ratio-chip" data-insp="ed-ratio" data-ratio="${ratio.key}"
            aria-pressed="${String(session.ratio === ratio.key)}">${ratio.label}</button>`,
        )}
      </div>
      <div class="ed-row">
        ${numberInput('crop-w', 'W', crop.w, item.width)}
        <span class="ed-row__times" aria-hidden="true">×</span>
        ${numberInput('crop-h', 'H', crop.h, item.height)}
        <button type="button" class="icon-btn" data-insp="ed-portrait" aria-pressed="${String(session.portrait)}"
          ${['free', '1:1'].includes(session.ratio) ? raw('disabled') : ''}
          title="Swap orientation (portrait / landscape)" aria-label="Portrait orientation">${icon('dimensions')}</button>
      </div>
    </section>
    <section class="section">
      <h3 class="section__title">Rotate &amp; flip</h3>
      <div class="tool-row">
        <button type="button" class="tool" data-insp="ed-rotate" data-dir="-1">${icon('rotate')}<span>Left</span></button>
        <button type="button" class="tool" data-insp="ed-rotate" data-dir="1">${icon('rotate-clockwise')}<span>Right</span></button>
        <button type="button" class="tool" data-insp="ed-flip" data-axis="h" aria-pressed="${String(session.flipH)}">${icon('flip-horizontal')}<span>Flip H</span></button>
        <button type="button" class="tool" data-insp="ed-flip" data-axis="v" aria-pressed="${String(session.flipV)}">${icon('flip-vertical')}<span>Flip V</span></button>
      </div>
    </section>
    <section class="section">
      <h3 class="section__title">Scale</h3>
      <div class="ed-row">
        ${numberInput('scale-w', 'W', out.w, crop.w)}
        <span class="ed-row__times" aria-hidden="true">×</span>
        ${numberInput('scale-h', 'H', out.h, crop.h)}
        <span class="ed-lock" title="Scaling keeps the proportions">${icon('lock', 'icon--sm')}</span>
      </div>
      <p class="field__hint">Down only, proportional. Largest is the crop: <span class="num" data-ed-max>${crop.w} × ${crop.h}</span>.</p>
    </section>
    <section class="section">
      <h3 class="section__title">Apply to</h3>
      <div class="radio-list" role="radiogroup" aria-label="Apply changes to">
        ${APPLY_TO.map(
          (option) => html`<label class="radio">
            <input type="radio" name="apply-to" value="${option.value}" data-insp="ed-apply"
              ${session.applyTo === option.value ? raw('checked') : ''} />
            <span class="radio__text"><span>${option.label}</span><span class="radio__hint">${option.hint}</span></span>
          </label>`,
        )}
      </div>
    </section>
    <div class="ed-footer">
      <button class="btn btn--ghost btn--sm" data-insp="ed-reset" ${dirty ? '' : raw('disabled')}>${icon('arrow-back-up', 'icon--sm')}Reset changes</button>
      <span class="field__hint">Saved in place — same file, same URL.</span>
    </div>
    ${maintenance(item, { dirty })}
  </div>`
}

function notImagePanel(item) {
  const svg = item.kind === 'svg'
  return html`<div class="inspector__body editor-panel" data-edit-panel>
    <div>
      <h2 class="inspector__heading">Edit image</h2>
      <p class="inspector__sub">${KIND_LABELS[item.kind]} · ${subtype(item)} · ${formatBytes(item.filesize)}</p>
    </div>
    <div class="notice" role="note">
      ${icon('info-circle')}
      <span>${
        svg
          ? 'SVG is a vector format: it has no pixels to crop or rotate, and WordPress doesn’t make sizes of it. Edit it in a vector app, then replace the file here.'
          : `Crop, rotate and flip are for images (JPEG, PNG, WebP, AVIF). You can still replace this ${KIND_LABELS[item.kind].toLowerCase()}${item.mime === 'application/pdf' ? ' or regenerate its preview' : ''}.`
      }</span>
    </div>
    ${canEdit(item) ? maintenance(item) : html`<div class="notice insp-lock mm-readonly" role="note">${icon('lock')}<span>${READ_ONLY_NOTICE}</span></div>`}
  </div>`
}

function readOnlyPanel(item) {
  return html`<div class="inspector__body editor-panel" data-edit-panel>
    <div>
      <h2 class="inspector__heading">Edit image</h2>
      <p class="inspector__sub">${item.width} × ${item.height} · uploaded by ${item.author}</p>
    </div>
    <div class="notice insp-lock mm-readonly" role="note">
      ${icon('lock')}
      <span>${READ_ONLY_NOTICE} Ask ${item.author} or an Editor to crop or replace it.</span>
    </div>
    <ul class="ed-disabled-list" aria-label="Unavailable tools">
      <li>${icon('crop', 'icon--sm')}Crop and aspect ratio</li>
      <li>${icon('rotate-clockwise', 'icon--sm')}Rotate and flip</li>
      <li>${icon('dimensions', 'icon--sm')}Scale</li>
      <li>${icon('replace', 'icon--sm')}Replace file</li>
    </ul>
  </div>`
}

function multiPanel(items) {
  const images = items.filter((item) => isEditableImage(item) && canEdit(item))
  return html`<div class="inspector__body editor-panel" data-edit-panel>
    <div>
      <h2 class="inspector__heading">Edit image</h2>
      <p class="inspector__sub">${items.length} items selected</p>
    </div>
    <div class="notice" role="note">${icon('info-circle')}<span>Crop, rotate and flip work on one image at a time.</span></div>
    ${
      images.length
        ? html`<button class="btn" data-insp="ed-edit-one" data-id="${images[0].id}">${icon('crop')}Edit “${images[0].title}”</button>
          <section class="section">
            <h3 class="section__title">All ${plural(images.length, 'image')}</h3>
            ${
              task && task.ids.length > 1
                ? taskProgress()
                : regenerateButton(images.map((item) => item.id))
            }
          </section>`
        : html`<p class="field__hint">None of the selected items is an image you can edit.</p>`
    }
  </div>`
}

function emptyPanel() {
  return html`<div class="inspector__body editor-panel">
    <div>
      <h2 class="inspector__heading">Edit image</h2>
      <p class="inspector__sub">Nothing selected</p>
    </div>
    <div class="ed-empty">
      <div class="empty__art">${icon('crop')}</div>
      <p>Select an image to crop, rotate, flip or scale it.</p>
      <p class="field__hint">Edits are saved in place: the file keeps its URL, so every post using it updates. You can always restore the original.</p>
    </div>
  </div>`
}

export function editPanel(items) {
  if (items.length === 0) return emptyPanel()
  if (items.length > 1) return multiPanel(items)
  const item = items[0]
  if (!isEditableImage(item)) return notImagePanel(item)
  if (!canEdit(item)) return readOnlyPanel(item)
  if (session?.itemId === item.id) return sessionPanel(item)
  return emptyPanel()
}

// --- Keeping the panel in sync with the canvas ---------------------------------------------
// Dragging the crop box updates the numbers without rebuilding the panel
// (which would steal focus from a field being typed in).

function syncNumbers() {
  const panel = document.querySelector('#inspector [data-edit-panel]')
  if (!panel || !session) return
  const crop = cropSize()
  const out = output()
  const values = {
    'crop-w': crop.w,
    'crop-h': crop.h,
    'scale-w': out.w,
    'scale-h': out.h,
  }
  for (const [name, value] of Object.entries(values)) {
    const input = panel.querySelector(`[data-ed-input="${name}"]`)
    if (input && document.activeElement !== input) input.value = value
  }
  const max = panel.querySelector('[data-ed-max]')
  if (max) max.textContent = `${crop.w} × ${crop.h}`
  const summary = panel.querySelector('[data-ed-out]')
  if (summary) {
    summary.textContent = `${session.width} × ${session.height}${isDirty() ? ` → ${out.w} × ${out.h}` : ''}`
  }
}

onSessionChange((kind) => {
  if (!session) return
  if (kind === 'geometry') syncNumbers()
  else requestRender()
})

// --- Maintenance tasks ---------------------------------------------------------------------

// Runs a fake multi-step job, updating the progress bar in place.
async function runTask(kind, ids, label, steps) {
  task = { kind, ids, done: 0, total: steps, label }
  requestRender()
  for (let step = 1; step <= steps; step++) {
    await new Promise((resolve) => setTimeout(resolve, 160))
    task.done = step
    const fill = document.querySelector('#inspector [data-task-fill]')
    const count = document.querySelector('#inspector [data-task-count]')
    if (fill) fill.style.setProperty('--value', String(step / steps))
    if (count) count.textContent = `${step} / ${steps}`
  }
  try {
    await fakeRequest(200)
  } catch (error) {
    task = null
    requestRender()
    throw error
  }
  task = null
}

async function regenerate() {
  const items = targetItems().filter(
    (item) =>
      canEdit(item) &&
      (isEditableImage(item) || item.mime === 'application/pdf'),
  )
  if (items.length === 0) return
  const ids = items.map((item) => item.id)
  const steps =
    items.length === 1 ? Math.max(1, subSizes(items[0]).length) : items.length
  try {
    await runTask(
      'regenerate',
      ids,
      items.length === 1 ? 'Regenerating sizes…' : 'Regenerating thumbnails…',
      steps,
    )
  } catch {
    showToast({
      text: 'Thumbnails weren’t regenerated — WordPress didn’t respond',
      iconName: 'alert-circle',
    })
    return
  }
  libraryChanged()
  requestRender()
  showToast({
    text:
      items.length > 1
        ? `Thumbnails regenerated for ${plural(items.length, 'image')}`
        : isEditableImage(items[0])
          ? `Thumbnails regenerated (${plural(steps, 'size')})`
          : 'Preview regenerated',
    iconName: 'refresh',
  })
}

export async function restoreOriginal(item, { confirm = true } = {}) {
  if (!item?.edit) return
  if (confirm) {
    const ok = await confirmDialog({
      title: 'Restore the original image?',
      text: `This undoes every saved edit to “${item.title}” (crop, rotation, flips and scaling) and regenerates its sizes. The URL stays the same.`,
      confirmLabel: 'Restore original',
    })
    if (!ok) return
  }
  try {
    await runTask('restore', [item.id], 'Restoring original…', 4)
  } catch {
    showToast({
      text: 'Original not restored — WordPress didn’t respond',
      iconName: 'alert-circle',
    })
    return
  }
  item.width = item.edit.from.width
  item.height = item.edit.from.height
  item.edit = null
  item.modified = new Date().toISOString()
  libraryChanged()
  requestRender()
  showToast({
    text: 'Original restored — thumbnails regenerated',
    iconName: 'arrow-back-up',
  })
}

function sameType(file, item) {
  const normalise = (type) => type.replace('image/jpg', 'image/jpeg')
  return normalise(file.type) === normalise(item.mime)
}

async function replaceFile(item, file) {
  if (!sameType(file, item)) {
    showToast({
      text: `That’s a ${file.type || 'different kind of'} file. Choose a ${subtype(item)} so the URL stays the same.`,
      iconName: 'alert-circle',
      duration: 7000,
    })
    return
  }
  const used = item.usedIn.length
  const ok = await confirmDialog({
    title: `Replace “${item.title}”?`,
    text: `${file.name} (${formatBytes(file.size)}) replaces the current file. The ID and URL stay the same and all sizes are regenerated.`,
    notice: used
      ? `Used in ${plural(used, 'post')} — ${used === 1 ? 'it shows' : 'they show'} the new file right away. The old file can’t be brought back.`
      : 'The old file can’t be brought back.',
    confirmLabel: 'Replace file',
  })
  if (!ok) return
  try {
    await runTask('replace', [item.id], `Uploading ${file.name}…`, 6)
  } catch {
    showToast({
      text: 'File not replaced — WordPress didn’t respond',
      iconName: 'alert-circle',
    })
    return
  }
  item.filesize = file.size
  item.modified = new Date().toISOString()
  item.edit = null
  libraryChanged()
  requestRender()
  showToast({
    text: 'File replaced — thumbnails regenerated',
    iconName: 'replace',
  })
}

function currentItem() {
  const items = targetItems()
  return items.length === 1 ? items[0] : null
}

// --- Wiring --------------------------------------------------------------------------------

function applyNumber(input) {
  const value = Number(input.value)
  if (!session || !Number.isFinite(value) || value < 1) {
    syncNumbers()
    return
  }
  const [kind, axis] = input.dataset.edInput.split('-')
  if (kind === 'crop') setCropSize(axis, value)
  else setScale(axis, value)
  announce(
    `${kind === 'crop' ? 'Crop' : 'Output'} ${output().w} by ${output().h}`,
  )
}

export function initEditorPanel(root) {
  registerInspectorAction('ed-ratio', (button) =>
    setRatio(button.dataset.ratio),
  )
  registerInspectorAction('ed-portrait', () => togglePortrait())
  registerInspectorAction('ed-rotate', (button) =>
    rotate(Number(button.dataset.dir)),
  )
  registerInspectorAction('ed-flip', (button) => flip(button.dataset.axis))
  registerInspectorAction('ed-apply', (input) => setApplyTo(input.value))
  registerInspectorAction('ed-reset', () => resetAll())
  registerInspectorAction('ed-regenerate', () => regenerate())
  registerInspectorAction('ed-restore', () => restoreOriginal(currentItem()))
  registerInspectorAction('ed-edit-one', (button) =>
    selectOnly(Number(button.dataset.id)),
  )
  registerInspectorAction('ed-replace-pick', (button) => {
    button.closest('.dropzone').querySelector('[data-ed-file]').click()
  })

  root.addEventListener('change', (event) => {
    if (event.target.matches('[data-ed-input]')) applyNumber(event.target)
    if (event.target.name === 'apply-to') setApplyTo(event.target.value)
    if (event.target.matches('[data-ed-file]') && event.target.files[0]) {
      const item = currentItem()
      if (item) replaceFile(item, event.target.files[0])
    }
  })
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('[data-ed-input]')) {
      event.preventDefault()
      applyNumber(event.target)
    }
  })
  // The replace drop zone. stopPropagation keeps the window-wide upload
  // drop overlay from treating this drop as a new upload.
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    root.addEventListener(type, (event) => {
      const zone = event.target.closest?.('[data-insp-drop]')
      if (!zone || zone.classList.contains('is-disabled')) return
      event.preventDefault()
      event.stopPropagation()
      zone.classList.toggle(
        'is-over',
        type === 'dragenter' || type === 'dragover',
      )
      if (type === 'drop' && event.dataTransfer.files[0]) {
        const item = currentItem()
        if (item) replaceFile(item, event.dataTransfer.files[0])
      }
    })
  }
}
