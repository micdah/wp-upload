// The fake library's own records. They hold what WordPress, FileBird and the
// companion plugin would store; library.ts turns them into the contract's
// DTOs per request, for the current viewer and scenario.
//
// Files under mocks/fake/ import with `.ts` extensions so plain Node can run
// them (spike C5's measurement script, server-live's contract suite).

import type {
  ExifInfo,
  MediaFileInfo,
  MediaKind,
  UsageContext,
} from '../../../../../shared/library-api.ts'

export interface FakeItem {
  id: number
  kind: MediaKind
  mime: string
  title: string
  /** original upload's basename (never `-scaled`) */
  filename: string
  /** of the file `url` points to; 0 = unknown */
  width: number
  height: number
  filesize: number | null
  alt: string
  caption: string
  description: string
  /** ms since epoch */
  uploadedAt: number
  modifiedAt: number
  authorId: number
  /** FileBird folder; 0 = Uncategorized */
  folder: number
  /** attached-to post id (`post_parent`); null = unattached */
  postParent: number | null
  /** WordPress status: `inherit` (normal) or `trash` */
  status: 'inherit' | 'trash'
  trashedAt: number | null
  /** the untouched upload when WordPress scaled it (`-scaled`) */
  original: { width: number; height: number } | null
  duration: number | null
  pages: number | null
  exif: ExifInfo | null
  media: MediaFileInfo | null
  edited: boolean
  editedAt: number | null
  undoable: boolean
  restorable: boolean
  sizesPending: boolean
  /** dimensions before the last in-place edit (for Undo) */
  beforeEdit: { width: number; height: number } | null
  /** dimensions of the file `url` pointed to at upload (Restore original) */
  pristine: { width: number; height: number } | null
  /** where it is used (posts, site logo, …) */
  usage: FakeUsage[]
  /** stable seed for placeholder images (a picsum id for prototype items) */
  imageSeed: string
  /** bytes of an uploaded file, served back by the media route */
  blob?: Blob
}

export interface FakeUsage {
  /** null for site-level uses (logo, icon) */
  postId: number | null
  contexts: UsageContext[]
}

export interface FakeFolder {
  id: number
  name: string
  parent: number
  ord: number
  /** stored colour; only shown with FileBird Pro */
  color: string | null
}

export interface FakePost {
  id: number
  type: 'post' | 'page'
  title: string
  status: 'publish' | 'draft' | 'private' | 'pending'
  /** ms since epoch; "most recent" order of the post picker */
  date: number
  authorId: number
}

export interface FakeUser {
  id: number
  name: string
}

/** Everything a fake library starts from. */
export interface FakeDataset {
  items: FakeItem[]
  folders: FakeFolder[]
  posts: FakePost[]
  users: FakeUser[]
}
