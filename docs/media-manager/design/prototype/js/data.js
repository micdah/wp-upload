// Sample library access. Images are served by Picsum (Unsplash photos) at
// sizes that mimic WordPress sub-sizes, so the prototype loads realistically.

export const SUB_SIZES = [300, 768, 1024, 1536, 2048]

export const KIND_LABELS = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  svg: 'SVG',
  archive: 'Archive',
}

export const KIND_ICONS = {
  image: 'photo',
  video: 'movie',
  audio: 'music',
  document: 'file-text',
  svg: 'file-vector',
  archive: 'file-zip',
}

export const library = {
  items: [],
  byId: new Map(),
  folders: [],
  folderById: new Map(),
}

export async function loadLibrary() {
  const [items, folders] = await Promise.all([
    fetch('data/media.json').then((response) => response.json()),
    fetch('data/folders.json').then((response) => response.json()),
  ])
  // ?scenario=empty simulates a brand-new site with no media.
  const empty = document.documentElement.dataset.scenario === 'empty'
  library.items = empty ? [] : items
  library.byId = new Map(items.map((item) => [item.id, item]))
  library.folders = folders
  library.folderById = new Map(folders.map((folder) => [folder.id, folder]))
}

// Width / height used for layout. Audio and archives have no picture, so
// they get square tiles.
export function aspectRatio(item) {
  if (item.kind === 'audio' || item.kind === 'archive') return 1
  if (item.kind === 'document') return 0.78
  return item.width / item.height
}

function pickSubSize(neededPx) {
  return SUB_SIZES.find((size) => size >= neededPx) ?? SUB_SIZES.at(-1)
}

// URL for a picture of the item whose long edge covers `neededPx` device
// pixels, or null when the item has no picture (audio, archive, document).
export function pictureUrl(item, neededPx) {
  if (item.kind === 'svg') return 'data/logo-mark.svg'
  const picsumId = item.kind === 'video' ? item.posterPicsumId : item.picsumId
  if (picsumId === undefined) return null
  const longEdge = pickSubSize(neededPx)
  const ratio = item.width / item.height
  const width = ratio >= 1 ? longEdge : Math.round(longEdge * ratio)
  const height = ratio >= 1 ? Math.round(longEdge / ratio) : longEdge
  return `https://picsum.photos/id/${picsumId}/${width}/${height}`
}

export function folderPath(folderId) {
  const path = []
  let folder = library.folderById.get(folderId)
  while (folder) {
    path.unshift(folder)
    folder = library.folderById.get(folder.parent)
  }
  return path
}

export function childFolders(parentId) {
  return library.folders
    .filter((folder) => folder.parent === parentId)
    .sort((a, b) => a.order - b.order)
}
