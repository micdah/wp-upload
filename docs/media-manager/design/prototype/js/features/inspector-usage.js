// The Usage panel: where an item is used (from the companion plugin's
// index), what it is attached to ("Uploaded to" in wp-admin), attach and
// detach with a small post picker, and what deleting would break.

import { library } from '../data.js'
import { targetItems } from '../selection.js'
import { collection } from '../store.js'
import { libraryChanged, showToast } from '../ui.js'
import { announce, html, icon, truncateMiddle } from '../util.js'
import {
  canEdit,
  fakeRequest,
  knownPosts,
  plural,
  postEditUrl,
  postUrl,
  READ_ONLY_NOTICE,
  registerInspectorAction,
  requestRender,
  usageContext,
} from './inspector-shared.js'

const TYPE_LABELS = { post: 'Post', page: 'Page' }

// --- Panels ---------------------------------------------------------------------

function postRow(post, { context, count } = {}) {
  return html`<li class="usage-row">
    <span class="usage-row__icon">${icon(post.type === 'page' ? 'file' : 'file-text', 'icon--sm')}</span>
    <span class="usage-row__text">
      <a class="usage-row__title" href="${postUrl(post)}" target="_blank" rel="noopener">${post.title}</a>
      <span class="usage-row__meta">
        ${TYPE_LABELS[post.type]}${context ? html` · <span class="${context === 'Featured image' ? 'usage-row__featured' : ''}">${context}</span>` : ''}${count ? html` · <span class="num">${plural(count, 'selected item')}</span>` : ''}
      </span>
    </span>
    <a class="icon-btn usage-row__action" href="${postEditUrl(post)}" target="_blank" rel="noopener"
      title="Edit in WordPress" aria-label="Edit ${post.title} in WordPress">${icon('external-link', 'icon--sm')}</a>
  </li>`
}

function attachedCard(item, editable) {
  const post = item.attachedTo
  return html`<section class="section">
    <h3 class="section__title">Attached to</h3>
    ${
      post
        ? html`<ul class="usage-list">${postRow(post)}</ul>`
        : html`<p class="usage-empty">Not attached to a post.</p>`
    }
    ${
      editable
        ? html`<div class="actions">
            <button class="btn btn--sm" data-insp="attach">${icon('link', 'icon--sm')}${post ? 'Change…' : 'Attach to…'}</button>
            ${post ? html`<button class="btn btn--sm btn--ghost" data-insp="detach">Detach</button>` : ''}
          </div>`
        : ''
    }
    <p class="field__hint">Attaching links the file to one post (“Uploaded to” in WordPress). It doesn’t insert it anywhere.</p>
  </section>`
}

function singleUsage(item) {
  const editable = canEdit(item)
  const featured = item.usedIn.filter(
    (post) => usageContext(item, post) === 'Featured image',
  )
  return html`<div class="inspector__body" data-ids="${item.id}">
    <div>
      <h2 class="inspector__heading" title="${item.filename}">${truncateMiddle(item.filename, 36)}</h2>
      <p class="inspector__sub">
        ${item.usedIn.length ? `Used in ${plural(item.usedIn.length, 'place')}` : 'Not used anywhere'}
      </p>
    </div>
    ${editable ? '' : html`<div class="notice insp-lock mm-readonly" role="note">${icon('lock')}<span>${READ_ONLY_NOTICE}</span></div>`}
    <section class="section">
      <h3 class="section__title">Used in</h3>
      ${
        item.usedIn.length
          ? html`<ul class="usage-list">
              ${item.usedIn.map((post) => postRow(post, { context: usageContext(item, post) }))}
            </ul>`
          : html`<div class="usage-empty usage-empty--card">
              ${icon('link')}
              <span>No post or page uses this file.</span>
            </div>`
      }
    </section>
    ${
      featured.length
        ? html`<div class="notice notice--warn" role="note">
            ${icon('alert-triangle')}
            <span>Featured image of ${plural(featured.length, 'post')}. Deleting this file clears it there, and ${featured.length === 1 ? 'that post shows' : 'those posts show'} no image until a new one is set.</span>
          </div>`
        : ''
    }
    ${attachedCard(item, editable)}
    <p class="field__hint usage-footnote">
      Found in post content, blocks and featured images. Uses in theme files, custom CSS or other plugins’ settings aren’t detected.
    </p>
  </div>`
}

function batchUsage(items) {
  const byPost = new Map()
  for (const item of items) {
    for (const post of item.usedIn) {
      const entry = byPost.get(post.id) ?? { post, count: 0 }
      entry.count++
      byPost.set(post.id, entry)
    }
  }
  const unused = items.filter((item) => item.usedIn.length === 0).length
  const editable = items.filter(canEdit)
  const attached = editable.filter((item) => item.attachedTo).length
  const rows = [...byPost.values()].sort((a, b) => b.count - a.count)
  return html`<div class="inspector__body" data-ids="${items.map((item) => item.id).join(',')}">
    <div>
      <h2 class="inspector__heading">${items.length} items</h2>
      <p class="inspector__sub">
        Used in ${plural(rows.length, 'post')} · ${unused} not used anywhere
      </p>
    </div>
    <section class="section">
      <h3 class="section__title">Used in</h3>
      ${
        rows.length
          ? html`<ul class="usage-list">${rows.map(({ post, count }) => postRow(post, { count }))}</ul>`
          : html`<p class="usage-empty">None of these items is used anywhere.</p>`
      }
    </section>
    <section class="section">
      <h3 class="section__title">Attached to</h3>
      <p class="usage-empty num">${attached} of ${editable.length} attached</p>
      ${
        editable.length
          ? html`<div class="actions">
              <button class="btn btn--sm" data-insp="attach">${icon('link', 'icon--sm')}Attach ${editable.length} to…</button>
              ${attached ? html`<button class="btn btn--sm btn--ghost" data-insp="detach">Detach all</button>` : ''}
            </div>`
          : html`<div class="notice insp-lock mm-readonly" role="note">${icon('lock')}<span>${READ_ONLY_NOTICE}</span></div>`
      }
    </section>
  </div>`
}

function emptyUsage() {
  const items = collection()
  const unused = items.filter((item) => item.usedIn.length === 0).length
  return html`<div class="inspector__body">
    <div>
      <h2 class="inspector__heading">Usage</h2>
      <p class="inspector__sub">Nothing selected</p>
    </div>
    <div class="stat-grid">
      <div class="stat">
        <div class="stat__value num">${items.length - unused}</div>
        <div class="stat__label">used in posts</div>
      </div>
      <div class="stat">
        <div class="stat__value num">${unused}</div>
        <div class="stat__label">not used anywhere</div>
      </div>
    </div>
    <p class="field__hint">Select an item to see which posts and pages use it, and to attach it to one.</p>
  </div>`
}

export function usagePanel(items) {
  if (items.length === 0) return emptyUsage()
  if (items.length === 1) return singleUsage(items[0])
  return batchUsage(items)
}

// --- Attach / detach ------------------------------------------------------------------

async function setAttachment(items, post) {
  const previous = new Map(items.map((item) => [item.id, item.attachedTo]))
  for (const item of items) item.attachedTo = post
  requestRender()
  try {
    await fakeRequest()
  } catch {
    for (const item of items) item.attachedTo = previous.get(item.id)
    requestRender()
    showToast({
      text: 'Couldn’t change the attachment — WordPress didn’t respond',
      iconName: 'alert-circle',
    })
    return
  }
  libraryChanged()
  const what =
    items.length === 1 ? `“${items[0].title}”` : plural(items.length, 'item')
  showToast({
    text: post ? `Attached ${what} to ${post.title}` : `Detached ${what}`,
    iconName: 'link',
    actionLabel: 'Undo',
    onAction: () => {
      for (const item of items) item.attachedTo = previous.get(item.id)
      libraryChanged()
      requestRender()
      announce('Attachment restored')
    },
  })
}

// A small searchable picker in the menu style. Arrow keys move, Enter
// picks, Esc closes and returns focus to the button that opened it.
function openPostPicker(anchor, onPick) {
  closePostPicker()
  const posts = knownPosts()
  const picker = document.createElement('div')
  picker.className = 'menu post-picker'
  picker.id = 'post-picker'
  picker.setAttribute('role', 'dialog')
  picker.setAttribute('aria-label', 'Attach to a post or page')
  picker.innerHTML = String(html`
    <div class="menu__label">Attach to</div>
    <div class="post-picker__search">
      ${icon('search', 'icon--sm')}
      <input class="input" type="search" placeholder="Search posts and pages" aria-label="Search posts and pages"
        aria-controls="post-picker-list" />
    </div>
    <div class="post-picker__list" id="post-picker-list" role="listbox"></div>
  `)
  const list = picker.querySelector('.post-picker__list')
  const search = picker.querySelector('input')
  let active = 0
  let matches = posts
  const renderList = () => {
    const query = search.value.trim().toLowerCase()
    matches = posts.filter((post) => post.title.toLowerCase().includes(query))
    active = Math.min(active, Math.max(0, matches.length - 1))
    list.innerHTML = matches.length
      ? matches
          .map((post, index) =>
            String(html`<button type="button" class="menu__item ${index === active ? 'is-active' : ''}"
              role="option" aria-selected="${String(index === active)}" data-index="${index}">
              ${icon(post.type === 'page' ? 'file' : 'file-text')}<span class="post-picker__title">${post.title}</span>
              <span class="post-picker__type">${TYPE_LABELS[post.type]}</span>
            </button>`),
          )
          .join('')
      : String(
          html`<p class="post-picker__empty">No posts match “${search.value}”.</p>`,
        )
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }
  const pick = (post) => {
    closePostPicker()
    anchor.focus?.()
    onPick(post)
  }
  search.addEventListener('input', () => {
    active = 0
    renderList()
  })
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      active = (active + step + matches.length) % Math.max(1, matches.length)
      renderList()
    } else if (event.key === 'Enter' && matches[active]) {
      event.preventDefault()
      pick(matches[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closePostPicker()
      anchor.focus?.()
    }
  })
  list.addEventListener('click', (event) => {
    const index = event.target.closest('[data-index]')?.dataset.index
    if (index !== undefined) pick(matches[Number(index)])
  })
  document.body.append(picker)
  renderList()
  const rect = anchor.getBoundingClientRect()
  const width = picker.getBoundingClientRect().width
  picker.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`
  picker.style.top = `${Math.min(rect.bottom + 4, innerHeight - picker.offsetHeight - 8)}px`
  search.focus()
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true))
}

function onOutside(event) {
  if (!event.target.closest('#post-picker')) closePostPicker()
}

export function closePostPicker() {
  document.getElementById('post-picker')?.remove()
  document.removeEventListener('pointerdown', onOutside, true)
}

function editableTargets() {
  return targetItems().filter(canEdit)
}

export function initUsageActions() {
  registerInspectorAction('attach', (button) => {
    openPostPicker(button, (post) => setAttachment(editableTargets(), post))
  })
  registerInspectorAction('detach', () => {
    const items = editableTargets().filter((item) => item.attachedTo)
    if (items.length) setAttachment(items, null)
  })
}

// Usage count for the rail badge.
export function usageCount(items) {
  if (items.length !== 1) return 0
  return library.byId.get(items[0].id)?.usedIn.length ?? 0
}
