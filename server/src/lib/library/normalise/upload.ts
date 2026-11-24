import {
  type DuplicateMatch,
  LIMITS,
} from '../../../../../shared/library-api.ts'
import {
  currentNormaliseContext,
  normaliseTile,
  type WpMedia,
} from './items.ts'

// `/wp/v2/media?slug=` → the matches of `upload/check` (server-api.md
// §7.15).

/** Existing items that look like the file about to be uploaded (at most 5). */
export function toDuplicateMatches(media: WpMedia[]): DuplicateMatch[] {
  const context = currentNormaliseContext()
  return media.slice(0, LIMITS.duplicateMatches).map((entry) => {
    const tile = normaliseTile(entry, context)
    return {
      id: tile.id,
      title: tile.title,
      filename: tile.filename,
      thumb: tile.thumb,
    }
  })
}
