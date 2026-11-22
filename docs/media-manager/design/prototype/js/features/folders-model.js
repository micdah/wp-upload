// FileBird folder model for the prototype: scenario flags, per-user prefs,
// counts, sorting and every mutation (create, rename, delete, reparent,
// assign media). Mutations change the sample library in place and then
// publish one store update, so every view re-renders from the same data —
// the real app would call the companion plugin's REST API at the same points.

import { library } from '../data.js'
import { collection, state, update } from '../store.js'

// --- Scenario flags -------------------------------------------------------------
// FileBird is optional. Pro adds colours and folder sorting. In per-user mode
// we only see the signed-in account's tree, so editing is switched off.

export function foldersEnabled() {
  return state.scenario !== 'no-filebird' && state.scenario !== 'no-plugin'
}

export function isPro() {
  return state.scenario === 'pro'
}

export function isPerUser() {
  return state.scenario === 'per-user'
}

export function foldersEditable() {
  return foldersEnabled() && !isPerUser()
}

// --- Per-user preferences (FileBird keeps these per WordPress user) ----------

const PREFS_KEY = 'mm-proto-folder-prefs'

export const prefs = {
  countMode: 'direct', // 'direct' | 'nested'
  sort: 'manual', // 'manual' | 'name-asc' | 'name-desc' (Pro only)
}

export function loadPrefs() {
  try {
    Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'))
  } catch {
    // Unavailable or corrupt storage: keep the defaults.
  }
}

export function setPref(name, value) {
  prefs[name] = value
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Storage can be unavailable (private mode); the choice just isn't kept.
  }
  update({}, ['folders'])
}

// --- Tree queries -----------------------------------------------------------------

const naturalCompare = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
}).compare

// Children of a folder in display order. Name sorting is a Pro feature, so
// without Pro the manual (drag) order always applies.
export function sortedChildren(parentId) {
  const children = library.folders.filter(
    (folder) => folder.parent === parentId,
  )
  const sort = isPro() ? prefs.sort : 'manual'
  if (sort === 'name-asc') {
    return children.sort((a, b) => naturalCompare(a.name, b.name))
  }
  if (sort === 'name-desc') {
    return children.sort((a, b) => naturalCompare(b.name, a.name))
  }
  return children.sort((a, b) => a.order - b.order)
}

export function descendantIds(folderId) {
  const ids = []
  const walk = (parentId) => {
    for (const child of library.folders) {
      if (child.parent !== parentId) continue
      ids.push(child.id)
      walk(child.id)
    }
  }
  walk(folderId)
  return ids
}

export function isSelfOrDescendant(folderId, candidateId) {
  return (
    folderId === candidateId || descendantIds(folderId).includes(candidateId)
  )
}

export function folderName(folderId) {
  if (folderId === 0) return 'Uncategorized'
  if (folderId === 'all') return 'All files'
  return library.folderById.get(folderId)?.name ?? 'Unknown folder'
}

// Depth-first list of every folder with its depth, in display order.
export function flatTree(parentId = 0, depth = 0, out = []) {
  for (const folder of sortedChildren(parentId)) {
    out.push({ folder, depth })
    flatTree(folder.id, depth + 1, out)
  }
  return out
}

// --- Counts ---------------------------------------------------------------------
// FileBird offers two counters: files directly in a folder (default) or
// including every subfolder. Both are computed live, so moves show at once.

export function directCounts() {
  const counts = new Map()
  for (const item of library.items) {
    const folder = item.folder || 0
    counts.set(folder, (counts.get(folder) ?? 0) + 1)
  }
  return counts
}

export function folderCount(folderId, counts = directCounts()) {
  if (folderId === 'all') return library.items.length
  const own = counts.get(folderId) ?? 0
  if (folderId === 0 || prefs.countMode === 'direct') return own
  return descendantIds(folderId).reduce(
    (sum, id) => sum + (counts.get(id) ?? 0),
    own,
  )
}

export function filesInSubtree(folderId) {
  const ids = new Set([folderId, ...descendantIds(folderId)])
  return library.items.filter((item) => ids.has(item.folder)).length
}

// --- Names ----------------------------------------------------------------------

export const MAX_NAME_LENGTH = 200

// FileBird auto-suffixes a duplicate name within the same parent:
// "Blog" → "Blog (1)" → "Blog (2)". Comparison ignores case.
export function uniqueName(parentId, wanted, exceptId = null) {
  const taken = new Set(
    library.folders
      .filter((folder) => folder.parent === parentId && folder.id !== exceptId)
      .map((folder) => folder.name.toLowerCase()),
  )
  if (!taken.has(wanted.toLowerCase())) return wanted
  let suffix = 1
  while (taken.has(`${wanted} (${suffix})`.toLowerCase())) suffix++
  return `${wanted} (${suffix})`
}

export function cleanName(value) {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
}

// --- Publishing changes --------------------------------------------------------------

function reindex() {
  library.folderById = new Map(
    library.folders.map((folder) => [folder.id, folder]),
  )
}

// One store update for any folder or assignment change. `extra` patches
// selection/focus when moved items leave the current view.
function publish(extra = {}) {
  update(extra, ['collection', 'folders', 'library', ...Object.keys(extra)])
}

function nextOrder() {
  return Math.max(-1, ...library.folders.map((folder) => folder.order)) + 1
}

function nextId() {
  return Math.max(0, ...library.folders.map((folder) => folder.id)) + 1
}

// --- Folder mutations ---------------------------------------------------------------

// Returns { folder, renamed } where renamed says the name was auto-suffixed.
export function createFolder(parentId, wantedName) {
  const name = uniqueName(parentId, wantedName)
  const folder = {
    id: nextId(),
    name,
    parent: parentId,
    order: nextOrder(),
    count: 0,
  }
  library.folders.push(folder)
  reindex()
  const expandedFolders = new Set(state.expandedFolders)
  if (parentId) expandedFolders.add(parentId)
  publish({ expandedFolders })
  return { folder, renamed: name !== wantedName }
}

export function renameFolder(folderId, wantedName) {
  const folder = library.folderById.get(folderId)
  const previous = folder.name
  const name = uniqueName(folder.parent, wantedName, folderId)
  folder.name = name
  publish()
  return { previous, name, renamed: name !== wantedName }
}

export function setFolderColor(folderId, color) {
  const folder = library.folderById.get(folderId)
  if (color) folder.color = color
  else delete folder.color
  publish()
}

// Deletes the folder and its whole subtree; their files fall back to
// Uncategorized. If you were inside the subtree you land in Uncategorized.
export function deleteFolder(folderId) {
  const removed = new Set([folderId, ...descendantIds(folderId)])
  let movedFiles = 0
  for (const item of library.items) {
    if (!removed.has(item.folder)) continue
    item.folder = 0
    movedFiles++
  }
  library.folders = library.folders.filter((folder) => !removed.has(folder.id))
  reindex()
  const extra = {}
  if (removed.has(state.folder)) {
    Object.assign(extra, {
      folder: 0,
      selection: new Set(),
      focus: null,
      anchor: null,
    })
  }
  publish(extra)
  return { folders: removed.size, movedFiles }
}

// Snapshot of parent + order for every folder, so a tree move can be undone.
export function treeSnapshot() {
  return library.folders.map(({ id, parent, order }) => ({ id, parent, order }))
}

export function restoreTree(snapshot) {
  for (const { id, parent, order } of snapshot) {
    const folder = library.folderById.get(id)
    if (!folder) continue
    folder.parent = parent
    folder.order = order
  }
  publish()
}

// Moves a folder under `parentId`, optionally before/after a sibling. A
// folder can't move into itself or its own subtree (FileBird rejects that too).
export function moveFolder(folderId, parentId, { before, after } = {}) {
  if (parentId !== 0 && isSelfOrDescendant(folderId, parentId)) return false
  const folder = library.folderById.get(folderId)
  const siblings = library.folders
    .filter((other) => other.parent === parentId && other.id !== folderId)
    .sort((a, b) => a.order - b.order)
  let index = siblings.length
  if (before !== undefined) {
    index = siblings.findIndex((other) => other.id === before)
  } else if (after !== undefined) {
    index = siblings.findIndex((other) => other.id === after) + 1
  }
  siblings.splice(Math.max(0, index), 0, folder)
  folder.parent = parentId
  // Re-number the siblings into the gaps the old order values leave.
  const orders = siblings.map((other) => other.order).sort((a, b) => a - b)
  siblings.forEach((other, position) => {
    other.order = orders[position] ?? nextOrder() + position
  })
  const expandedFolders = new Set(state.expandedFolders)
  if (parentId) expandedFolders.add(parentId)
  publish({ expandedFolders })
  return true
}

// --- Media assignment ------------------------------------------------------------------

// Moves items into a folder (0 = Uncategorized). FileBird keeps one folder
// per file, so this replaces any previous folder. Returns an undo function,
// or null when nothing changed.
export function assignItems(ids, targetFolder) {
  const before = new Map()
  for (const id of ids) {
    const item = library.byId.get(id)
    if (!item || (item.folder || 0) === targetFolder) continue
    before.set(id, item.folder || 0)
  }
  if (before.size === 0) return null
  const extra = focusAfterLeaving([...before.keys()], targetFolder)
  for (const id of before.keys()) library.byId.get(id).folder = targetFolder
  publish(extra)
  return {
    count: before.size,
    undo: () => {
      for (const [id, folder] of before) library.byId.get(id).folder = folder
      publish()
    },
  }
}

// When moved items leave the folder being viewed, they drop out of the
// selection and focus moves to the nearest item that stays, so keyboard
// flow (M → Enter → M …) continues where you were.
function focusAfterLeaving(movedIds, targetFolder) {
  const leaves = state.folder !== 'all' && state.folder !== targetFolder
  if (!leaves) return {}
  const moved = new Set(movedIds)
  const items = collection()
  const index = items.findIndex((item) => item.id === state.focus)
  const staying = (item) => !moved.has(item.id)
  const next =
    items.slice(Math.max(0, index)).find(staying) ??
    items.slice(0, Math.max(0, index)).reverse().find(staying)
  const selection = new Set([...state.selection].filter((id) => !moved.has(id)))
  const focus = moved.has(state.focus) ? (next?.id ?? null) : state.focus
  return {
    selection,
    focus,
    anchor: moved.has(state.anchor) ? focus : state.anchor,
  }
}
