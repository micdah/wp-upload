import axios from 'axios'
import { filebirdAxios } from '../config/filebirdClient.ts'
import { isWpError, normaliseWpError, type WpError } from './wpUpload.ts'

export interface FolderNode {
  id: number
  name: string
  children: FolderNode[]
}

interface RawFolder {
  id?: unknown
  text?: unknown
  children?: unknown
}

// FileBird appends " (1)" ... " (15)" to a duplicate folder name, then gives
// up and creates a folder with an empty name (Folder::findUniqueFolderName).
const MAX_AUTO_RENAME_SUFFIX = 15

const ENTITY_PATTERN = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

// WordPress's kses entity-encodes folder names when FileBird saves them, so
// "Tom & Jerry" comes back as "Tom &amp; Jerry" and "a > b" as "a &gt; b".
// Decodes the entities kses produces in a single pass, so "&amp;lt;" becomes
// "&lt;" rather than "<". Other named entities are left alone: kses keeps
// them only when the user typed them literally.
function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (entity, ref: string) => {
    const lowerRef = ref.toLowerCase()
    const named = NAMED_ENTITIES[lowerRef]
    if (named !== undefined) return named
    const codePoint = lowerRef.startsWith('#x')
      ? Number.parseInt(lowerRef.slice(2), 16)
      : Number.parseInt(lowerRef.slice(1), 10)
    const isValid =
      codePoint > 0 &&
      codePoint <= 0x10ffff &&
      (codePoint < 0xd800 || codePoint > 0xdfff)
    return isValid ? String.fromCodePoint(codePoint) : entity
  })
}

// FileBird returns ids as numbers from /folders but as strings elsewhere
// (e.g. /folder), so everything is coerced rather than trusted. Nodes without
// a usable positive id are dropped instead of failing the whole tree.
function mapFolders(raw: unknown): FolderNode[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item: RawFolder): FolderNode[] => {
    const id = Number(item?.id)
    if (!Number.isInteger(id) || id <= 0) return []
    return [
      {
        id,
        name:
          typeof item.text === 'string'
            ? decodeEntities(item.text)
            : `Folder ${id}`,
        children: mapFolders(item.children),
      },
    ]
  })
}

// PHP's trim()/ltrim() character set, which unlike JS's trim() includes NUL
// and excludes non-ASCII spaces.
const PHP_TRIM_CHARS = ' \\t\\r\\n\\0\\x0B'
const PHP_TRIM = new RegExp(`^[${PHP_TRIM_CHARS}]+|[${PHP_TRIM_CHARS}]+$`, 'g')
const EXCEL_SIGILS = new RegExp(`^[${PHP_TRIM_CHARS}=+\\-@|]+`)

// Best-effort approximation of WordPress's sanitize_text_field(), which
// FileBird applies to a new folder's name: drop <script>/<style> blocks and
// other tags, collapse whitespace, trim, and drop percent-encoded octets.
function sanitizeTextField(name: string): string {
  let text = name
    .replace(/<(script|style)[^>]*?>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\r\n\t ]+/g, ' ')
    .replace(PHP_TRIM, '')
  while (/%[0-9a-f]{2}/i.test(text)) {
    text = text.replace(/%[0-9a-f]{2}/gi, '')
  }
  return text.replace(/ +/g, ' ').replace(PHP_TRIM, '')
}

// Best-effort approximation of the name FileBird stores for a new folder:
// sanitize_text_field(), then FileBird's sanitize_for_excel(), which strips
// leading whitespace and = + - @ | (Controller/Api.php publicRestApiNewFolder,
// Model/Folder.php newFolder, Classes/Helpers.php). FileBird checks for an
// empty name *before* sanitize_for_excel runs, so a name like "==" would
// otherwise create a folder with an empty name.
export function filebirdStoredName(name: string): string {
  return sanitizeTextField(name).replace(EXCEL_SIGILS, '')
}

// MySQL's usual utf8mb4 collations compare names case- and accent-
// insensitively, and so do FileBird's duplicate-name lookups there.
function collationKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

// FileBird's public API reports its own errors via wp_send_json_error(), as
// HTTP 200 with { success: false, data: { mess: '...' } }. Other shapes are
// accepted too, in case a future version or another route differs.
function filebirdErrorMessage(response: {
  data?: unknown
  message?: unknown
}): string {
  const data =
    typeof response.data === 'object' && response.data !== null
      ? (response.data as { mess?: unknown; message?: unknown })
      : null
  return (
    nonEmptyString(data?.mess) ??
    nonEmptyString(data?.message) ??
    nonEmptyString(response.message) ??
    nonEmptyString(response.data) ??
    'FileBird reported an error.'
  )
}

// FileBird wraps every response as { success, data } and reports its own
// failures (e.g. missing or invalid parameters) with HTTP 200 and
// success: false. Only auth failures are real HTTP errors (401
// rest_forbidden), handled in normaliseFilebirdError.
function unwrap(body: unknown): Record<string, unknown> {
  const response = (body ?? {}) as {
    success?: unknown
    data?: unknown
    message?: unknown
  }
  if (response.success !== true) {
    throw {
      status: 502,
      code: 'filebird_error',
      message: filebirdErrorMessage(response),
    } satisfies WpError
  }
  return (response.data ?? {}) as Record<string, unknown>
}

export function normaliseFilebirdError(err: unknown): WpError {
  // Errors this module raised itself pass through unchanged. Axios errors
  // carry status/code/message too, so they're excluded explicitly.
  if (isWpError(err) && !axios.isAxiosError(err)) return err

  if (axios.isAxiosError(err) && err.response) {
    const { status, data } = err.response
    if (status === 401 || status === 403) {
      return {
        status: 502,
        code: 'filebird_unauthorized',
        message: 'FileBird rejected the configured API key (FILEBIRD_API_KEY).',
      }
    }
    if (status === 404 && data?.code === 'rest_no_route') {
      return {
        status: 502,
        code: 'filebird_unavailable',
        message:
          'The FileBird API was not found - is the FileBird plugin installed and active?',
      }
    }
  }

  return normaliseWpError(err)
}

export async function listFolders(): Promise<FolderNode[]> {
  try {
    const { data } = await filebirdAxios.get('/folders')
    return mapFolders(unwrap(data).folders)
  } catch (err) {
    throw normaliseFilebirdError(err)
  }
}

function findFolder(folders: FolderNode[], id: number): FolderNode | null {
  for (const folder of folders) {
    if (folder.id === id) return folder
    const found = findFolder(folder.children, id)
    if (found) return found
  }
  return null
}

// FileBird creates a folder under any parent_id, even one that doesn't exist
// (it then never appears in the tree), and turns a duplicate name into an
// empty one once " (1)" ... " (15)" are taken. Both are checked against the
// current tree first. This is best effort: the tree can change in between.
// Throws an already-normalised WpError.
async function checkCanCreateFolder(
  name: string,
  parentId: number,
): Promise<void> {
  const tree = await listFolders()
  const parent = parentId === 0 ? null : findFolder(tree, parentId)
  if (parentId !== 0 && !parent) {
    throw {
      status: 404,
      code: 'parent_folder_not_found',
      message: 'The parent folder no longer exists - refresh the folder list.',
    } satisfies WpError
  }

  // FileBird looks for duplicates using the name *before* sanitize_for_excel
  // (Folder::newUniqueFolder), so " -Cats" never collides with "Cats". It
  // also compares the " (n)" candidates unencoded against entity-encoded
  // stored names, so names with & < > never run out; flagging those here
  // anyway only costs a 409 where FileBird would add another "Name (1)".
  const siblingKeys = new Set(
    (parent?.children ?? tree).map((folder) => collationKey(folder.name)),
  )
  const baseName = sanitizeTextField(name)
  const candidates = [baseName]
  for (let suffix = 1; suffix <= MAX_AUTO_RENAME_SUFFIX; suffix++) {
    candidates.push(`${baseName} (${suffix})`)
  }
  const exhausted = candidates.every((candidate) =>
    siblingKeys.has(collationKey(candidate)),
  )
  if (exhausted) {
    throw {
      status: 409,
      code: 'folder_name_exhausted',
      message: `There are too many folders named "${baseName}" here - choose a different name.`,
    } satisfies WpError
  }
}

// FileBird (6.5.2+) auto-renames a duplicate name to "Name (1)" etc. and may
// sanitise it further, but only returns the new id - callers must look the
// folder up by id to learn its actual name.
export async function createFolder(
  name: string,
  parentId: number,
): Promise<{ id: number }> {
  await checkCanCreateFolder(name, parentId)
  try {
    const { data } = await filebirdAxios.post('/folders', {
      name,
      parent_id: parentId,
    })
    // A failed insert comes back as success: true with id: null.
    const id = Number(unwrap(data).id)
    if (!Number.isInteger(id) || id <= 0) {
      throw {
        status: 502,
        code: 'filebird_error',
        message: 'FileBird did not return the new folder id.',
      } satisfies WpError
    }
    return { id }
  } catch (err) {
    throw normaliseFilebirdError(err)
  }
}

// FileBird's set-attachment doesn't check the folder exists: it removes the
// file from its current folder and files it under the missing id, which
// leaves it effectively Uncategorized while reporting success. So the folder
// (e.g. deleted in wp-admin since it was picked) is looked up first.
export async function assignToFolder(
  attachmentId: number,
  folderId: number,
): Promise<void> {
  let folder: unknown
  try {
    const { data } = await filebirdAxios.get('/folder', {
      params: { folder_id: folderId },
    })
    folder = unwrap(data).folder
  } catch (err) {
    throw normaliseFilebirdError(err)
  }
  if (!folder) {
    throw {
      status: 404,
      code: 'filebird_folder_not_found',
      message: 'The FileBird folder no longer exists (deleted in wp-admin?).',
    } satisfies WpError
  }

  try {
    const { data } = await filebirdAxios.post('/folder/set-attachment', {
      folder: folderId,
      ids: [attachmentId],
    })
    unwrap(data)
  } catch (err) {
    throw normaliseFilebirdError(err)
  }
}
