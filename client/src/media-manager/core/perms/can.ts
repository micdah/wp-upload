// One permission check in front of every mutation (interaction-spec §13.2,
// system.md §9 request 5): can(action, item?) → ok, or a code and a sentence
// for the disabled control's tooltip. partition() splits a mixed selection
// (an Author's own media vs other people's).
//
// It is fed by the bootstrap (WordPress caps, FileBird mode and Pro, trash,
// image editor, the plugin's features[]), the connectivity state, and each
// item's `perms` (the plugin's `wpu.perms`).

import type {
  Bootstrap,
  ItemPerms,
  MediaKind,
  PluginFeature,
  TrashState,
} from '../../../../../shared/library-api'

export const PERM_ACTIONS = [
  'upload',
  'edit-meta',
  'attach',
  'trash',
  'delete',
  'restore',
  'empty-trash',
  'move-to-folder',
  'folder-create',
  'folder-rename',
  'folder-move',
  'folder-delete',
  'folder-color',
  'folder-sort',
  'edit-image',
  'regenerate',
  'replace',
  'download',
  'view-usage',
] as const
export type PermAction = (typeof PERM_ACTIONS)[number]

export const DENY_CODES = [
  'not-ready',
  'offline',
  'needs-plugin',
  'no-filebird',
  'filebird-per-user',
  'not-pro',
  'trash-disabled',
  'no-cap',
  'no-item-perm',
  'unsupported-type',
  'processing',
  'trashed',
  'not-trashed',
] as const
export type DenyCode = (typeof DENY_CODES)[number]

export type CanResult =
  | { ok: true }
  | { ok: false; code: DenyCode; reason: string }

/** What can() needs to know about an item (tiles and full items both fit). */
export interface PermItem {
  id: number
  perms: ItemPerms
  kind?: MediaKind
  mime?: string
  sizesPending?: boolean
  trash?: TrashState | null
}

export interface PermContext {
  bootstrap: Bootstrap | null
  online: boolean
}

const OK: CanResult = Object.freeze({ ok: true })

function deny(code: DenyCode, reason: string): CanResult {
  return { ok: false, code, reason }
}

/** The plugin feature each action's routes need (plugin-api.md §2.2). */
const FEATURE_OF: Partial<Record<PermAction, PluginFeature>> = {
  'edit-meta': 'media-batch',
  attach: 'media-batch',
  trash: 'trash',
  delete: 'trash',
  restore: 'trash',
  'empty-trash': 'trash',
  'move-to-folder': 'folders',
  'folder-create': 'folders',
  'folder-rename': 'folders',
  'folder-move': 'folders',
  'folder-delete': 'folders',
  'folder-color': 'folder-colors',
  'folder-sort': 'folders',
  'edit-image': 'image-edit',
  regenerate: 'image-regenerate',
  replace: 'image-replace',
  'view-usage': 'usage',
}

const FOLDER_ACTIONS: ReadonlySet<PermAction> = new Set([
  'move-to-folder',
  'folder-create',
  'folder-rename',
  'folder-move',
  'folder-delete',
  'folder-color',
  'folder-sort',
])

/** Folder mutations FileBird's per-user mode refuses (D25). */
const PER_USER_REFUSED = FOLDER_ACTIONS

const PRO_ACTIONS: ReadonlySet<PermAction> = new Set([
  'folder-color',
  'folder-sort',
])

/** Actions that change an item and need `perms.edit`. */
const NEEDS_EDIT: ReadonlySet<PermAction> = new Set([
  'edit-meta',
  'attach',
  'move-to-folder',
  'edit-image',
  'regenerate',
  'replace',
])

/** Actions that need `perms.delete`. */
const NEEDS_DELETE: ReadonlySet<PermAction> = new Set([
  'trash',
  'delete',
  'restore',
])

/** Actions on items in the Trash. Everything else refuses trashed items. */
const TRASH_ACTIONS: ReadonlySet<PermAction> = new Set([
  'restore',
  'delete',
  'download',
  'view-usage',
])

const IMAGE_ACTIONS: ReadonlySet<PermAction> = new Set([
  'edit-image',
  'regenerate',
])

function pluginLacks(bootstrap: Bootstrap, feature: PluginFeature): boolean {
  const plugin = bootstrap.plugin
  if (!plugin) {
    return true
  }
  return (
    !plugin.features.includes(feature) ||
    plugin.missingFeatures.includes(feature)
  )
}

function needsPluginReason(bootstrap: Bootstrap): string {
  const bundled = bootstrap.plugin?.bundled?.version
  return bundled ? `Needs plugin ${bundled}` : 'Needs a newer companion plugin'
}

function itemDenial(
  context: PermContext,
  action: PermAction,
  item: PermItem,
): CanResult | null {
  const site = context.bootstrap?.site
  if (item.trash && !TRASH_ACTIONS.has(action)) {
    return deny('trashed', 'This item is in the Trash')
  }
  if (action === 'restore' && !item.trash) {
    return deny('not-trashed', 'This item is not in the Trash')
  }
  const needsEdit = NEEDS_EDIT.has(action) && !item.perms.edit
  const needsDelete = NEEDS_DELETE.has(action) && !item.perms.delete
  if (needsEdit || needsDelete) {
    const author =
      site !== null && site !== undefined && !site.user.caps.editOthersPosts
    return deny(
      'no-item-perm',
      author
        ? 'You can only change your own media'
        : "You don't have permission to change this item",
    )
  }
  if (IMAGE_ACTIONS.has(action)) {
    const editable =
      (item.kind === undefined || item.kind === 'image') &&
      (item.mime === undefined ||
        (site?.imageEditor.mimes.includes(item.mime) ?? false))
    if (!editable) {
      return deny('unsupported-type', "This file type can't be edited here")
    }
    if (item.sizesPending) {
      return deny('processing', 'Still processing; try again in a moment')
    }
  }
  return null
}

/** The pure check. Prefer can() / useCan(), which supply the context. */
export function evaluate(
  context: PermContext,
  action: PermAction,
  item?: PermItem,
): CanResult {
  const bootstrap = context.bootstrap
  const site = bootstrap?.site
  if (!bootstrap || !site) {
    return deny('not-ready', 'Still loading')
  }
  if (!context.online) {
    return deny('offline', 'WordPress is unreachable right now')
  }
  const feature = FEATURE_OF[action]
  if (feature && pluginLacks(bootstrap, feature)) {
    return deny('needs-plugin', needsPluginReason(bootstrap))
  }
  if (FOLDER_ACTIONS.has(action)) {
    if (!site.filebird?.active) {
      return deny('no-filebird', "FileBird isn't active")
    }
    if (site.filebird.perUser && PER_USER_REFUSED.has(action)) {
      return deny(
        'filebird-per-user',
        'Folders are read-only in FileBird per-user mode',
      )
    }
    if (PRO_ACTIONS.has(action) && !site.filebird.pro) {
      return deny('not-pro', 'Needs FileBird Pro')
    }
  }
  if (action === 'trash' && !site.trash.enabled) {
    return deny('trash-disabled', 'The Trash is turned off on this site')
  }
  if (!site.user.caps.uploadFiles) {
    return deny('no-cap', 'Your WordPress account cannot manage media')
  }
  if (item) {
    return itemDenial(context, action, item) ?? OK
  }
  return OK
}

export interface Partition<T extends PermItem> {
  allowed: T[]
  denied: { item: T; result: Extract<CanResult, { ok: false }> }[]
}

/** Splits items into those the action may touch and those it may not. */
export function partitionWith<T extends PermItem>(
  context: PermContext,
  action: PermAction,
  items: readonly T[],
): Partition<T> {
  const result: Partition<T> = { allowed: [], denied: [] }
  for (const item of items) {
    const verdict = evaluate(context, action, item)
    if (verdict.ok) {
      result.allowed.push(item)
    } else {
      result.denied.push({ item, result: verdict })
    }
  }
  return result
}
