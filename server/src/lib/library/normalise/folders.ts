import type {
  Folder,
  FolderDeleteResponse,
  FolderMutationResponse,
  FolderTree,
} from '../../../../../shared/library-api.ts'

// The plugin's folder answers → DTOs (server-api.md §7.11). The plugin already
// answers in the contract's shape; this keeps the invariants the client relies
// on even if a plugin build gets one wrong: the sort order, and colours that
// are lowercase `#rrggbb` and only ever shown when FileBird Pro is detected
// (D23).

const COLOR = /^#[0-9a-f]{6}$/i

/** Trims and collapses inner whitespace, as the plugin does with names. */
export function normaliseFolderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

function normaliseFolder(folder: Folder, pro: boolean): Folder {
  const color =
    pro && typeof folder.color === 'string' && COLOR.test(folder.color)
      ? folder.color.toLowerCase()
      : null
  return { ...folder, color }
}

/** Sorted by parent, then ord, then id; colours only with Pro. */
export function normaliseFolderTree(tree: FolderTree): FolderTree {
  const folders = tree.folders
    .map((folder) => normaliseFolder(folder, tree.mode.pro))
    .sort((a, b) => a.parent - b.parent || a.ord - b.ord || a.id - b.id)
  return { ...tree, folders }
}

export function normaliseFolderMutation(
  answer: FolderMutationResponse,
): FolderMutationResponse {
  return {
    ...answer,
    folder: normaliseFolder(answer.folder, answer.tree.mode.pro),
    tree: normaliseFolderTree(answer.tree),
  }
}

export function normaliseFolderDelete(
  answer: FolderDeleteResponse,
): FolderDeleteResponse {
  return { ...answer, tree: normaliseFolderTree(answer.tree) }
}
