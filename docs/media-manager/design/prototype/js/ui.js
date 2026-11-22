// Shared UI primitives for feature modules: an action bus, toasts (with
// undo), a confirm dialog and a popover menu. Visuals come from the design
// system classes in components.css (.toast, .dialog, .menu …).

import { announce, html, icon } from './util.js'

// --- Action bus ------------------------------------------------------------------
// Buttons anywhere can carry data-mm-action="name"; features listen with on().
// Known actions: upload, move-to-folder, edit-details, download, delete,
// remove-from-folder, new-folder, shortcuts, command-palette.

export function emit(name, detail = {}) {
  document.dispatchEvent(new CustomEvent(`mm:${name}`, { detail }))
}

export function on(name, handler) {
  const listener = (event) => handler(event.detail)
  document.addEventListener(`mm:${name}`, listener)
  return () => document.removeEventListener(`mm:${name}`, listener)
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-mm-action]')
  if (!trigger) return
  emit(trigger.dataset.mmAction, { source: trigger })
})

// --- Toasts ------------------------------------------------------------------------

function toastRegion() {
  let region = document.getElementById('toast-region')
  if (!region) {
    region = document.createElement('div')
    region.id = 'toast-region'
    region.className = 'toast-region'
    document.body.append(region)
  }
  return region
}

// showToast({ text, icon, actionLabel, onAction, duration }) → dismiss()
export function showToast({
  text,
  iconName = 'check',
  actionLabel,
  onAction,
  duration = 5000,
}) {
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.setAttribute('role', 'status')
  toast.innerHTML = String(
    html`${icon(iconName)}<span class="toast__text">${text}</span>${
      actionLabel
        ? html`<button class="btn btn--ghost btn--sm toast__action">${actionLabel}</button>`
        : ''
    }`,
  )
  const dismiss = () => toast.remove()
  toast.querySelector('.toast__action')?.addEventListener('click', () => {
    onAction?.()
    dismiss()
  })
  toastRegion().append(toast)
  announce(text)
  if (duration) setTimeout(dismiss, duration)
  return dismiss
}

// --- Confirm dialog ------------------------------------------------------------------

// confirmDialog({ title, text, notice, confirmLabel, danger }) → Promise<boolean>
export function confirmDialog({
  title,
  text,
  notice,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement
    const scrim = document.createElement('div')
    scrim.className = 'scrim'
    scrim.innerHTML =
      String(html`<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
      <h2 class="dialog__title" id="dialog-title">${title}</h2>
      ${text ? html`<p class="dialog__text">${text}</p>` : ''}
      ${
        notice
          ? html`<div class="notice ${danger ? 'notice--danger' : 'notice--warn'}">${icon('alert-triangle')}<span>${notice}</span></div>`
          : ''
      }
      <div class="dialog__actions">
        <button class="btn" data-answer="no">${cancelLabel}</button>
        <button class="btn ${danger ? 'btn--danger-solid' : 'btn--primary'}" data-answer="yes">${confirmLabel}</button>
      </div>
    </div>`)
    const close = (answer) => {
      scrim.remove()
      document.removeEventListener('keydown', onKey, true)
      previousFocus?.focus?.()
      resolve(answer)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(false)
      }
    }
    scrim.addEventListener('click', (event) => {
      const answer = event.target.closest('[data-answer]')?.dataset.answer
      if (answer) close(answer === 'yes')
      else if (event.target === scrim) close(false)
    })
    document.addEventListener('keydown', onKey, true)
    document.body.append(scrim)
    scrim.querySelector('[data-answer="no"]').focus()
  })
}

// --- Popover menu ------------------------------------------------------------------------

// openMenu({ x, y, label, items: [{ label, icon, kbd, danger, onSelect } | { heading } | 'separator'] })
// Items may set `checked: true` (shows a tick, aria-checked) or
// `disabled: true`. Esc or a selection returns focus to the opener.
export function openMenu({ x, y, label, items }) {
  closeMenu()
  const opener = document.activeElement
  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.id = 'popover-menu'
  menu.setAttribute('role', 'menu')
  menu.style.position = 'fixed'
  menu.innerHTML = String(
    html`${label ? html`<div class="menu__label">${label}</div>` : ''}${items.map(
      (entry, index) =>
        entry === 'separator'
          ? html`<div class="menu__separator" role="separator"></div>`
          : entry.heading
            ? html`<div class="menu__label">${entry.heading}</div>`
            : html`<button
                class="menu__item ${entry.danger ? 'menu__item--danger' : ''}"
                role="${entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}"
                ${entry.checked === undefined ? '' : `aria-checked="${Boolean(entry.checked)}"`}
                ${entry.disabled ? 'disabled' : ''}
                data-index="${index}"
              >
                ${entry.checked ? icon('check') : entry.icon ? icon(entry.icon) : ''}${entry.label}${entry.kbd ? html`<kbd>${entry.kbd}</kbd>` : ''}
              </button>`,
    )}`,
  )
  document.body.append(menu)
  const { width, height } = menu.getBoundingClientRect()
  menu.style.left = `${Math.min(x, innerWidth - width - 8)}px`
  menu.style.top = `${Math.min(y, innerHeight - height - 8)}px`
  menu.addEventListener('click', (event) => {
    const index = event.target.closest('[data-index]')?.dataset.index
    if (index === undefined || items[Number(index)].disabled) return
    closeMenu()
    opener?.focus?.()
    items[Number(index)].onSelect?.()
  })
  menu.addEventListener('keydown', (event) => {
    const buttons = [...menu.querySelectorAll('.menu__item:not(:disabled)')]
    const current = buttons.indexOf(document.activeElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      buttons[(current + step + buttons.length) % buttons.length].focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
      opener?.focus?.()
    }
  })
  setTimeout(() =>
    document.addEventListener('pointerdown', onOutsidePointer, true),
  )
  menu.querySelector('.menu__item:not(:disabled)')?.focus()
  return menu
}

function onOutsidePointer(event) {
  if (!event.target.closest('#popover-menu')) closeMenu()
}

export function closeMenu() {
  document.getElementById('popover-menu')?.remove()
  document.removeEventListener('pointerdown', onOutsidePointer, true)
}

// Notify views that sample data changed (re-renders grid, filters, folders).
export function libraryChanged() {
  document.dispatchEvent(new CustomEvent('library-changed'))
}
