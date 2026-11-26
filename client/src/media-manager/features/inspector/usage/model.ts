// Pure helpers of the Usage panel (inspector.md §5): human labels for usage
// contexts and post statuses, the lines the panel says ("Used in 2 places",
// the featured-image warning), and the aggregation of several items' usage
// into one list of posts with "N selected items" counts.

import type {
  ItemUsage,
  UsageContext,
  UsageRef,
} from '../../../../../../shared/library-api'
import { plural } from '../../../core/ui/announce'

/** How an item is used there, as the panel says it. */
export const CONTEXT_LABELS: Record<UsageContext, string> = {
  featured: 'Featured image',
  'image-block': 'Image block',
  'gallery-block': 'Gallery block',
  'file-block': 'File block',
  'cover-block': 'Cover block',
  'media-text': 'Media & text',
  'video-block': 'Video block',
  'audio-block': 'Audio block',
  content: 'In content',
  'shortcode-gallery': 'Gallery shortcode',
  'visual-portfolio': 'Visual Portfolio',
  'site-logo': 'Site logo',
  'site-icon': 'Site icon',
}

export function contextLabel(context: UsageContext): string {
  return CONTEXT_LABELS[context] ?? context
}

const STATUS_LABELS: Record<string, string> = {
  publish: 'Published',
  draft: 'Draft',
  private: 'Private',
  future: 'Scheduled',
  pending: 'Pending review',
}

/** "Published", "Draft", …; unknown statuses capitalised. */
export function statusLabel(status: string): string {
  const known = STATUS_LABELS[status]
  if (known) {
    return known
  }
  return status === '' ? '' : status[0]?.toUpperCase() + status.slice(1)
}

/** A site-level use (site logo, site icon, Visual Portfolio's placeholder). */
export function isSiteLevel(ref: Pick<UsageRef, 'postId'>): boolean {
  return ref.postId === null
}

/**
 * The parts of a ref's meta line: type, a status other than published, and
 * how it is used ("Post · Draft · Image block").
 */
export function refMeta(ref: UsageRef): {
  type: string
  status: string | null
  contexts: { context: UsageContext; label: string }[]
} {
  return {
    type: ref.postTypeLabel,
    status:
      isSiteLevel(ref) || ref.status === 'publish'
        ? null
        : statusLabel(ref.status),
    contexts: ref.contexts.map((context) => ({
      context,
      label: contextLabel(context),
    })),
  }
}

/** "Used in 2 places" / "Not used anywhere". */
export function usedInLine(count: number): string {
  return count > 0 ? `Used in ${plural(count, 'place')}` : 'Not used anywhere'
}

/** Refs that use the item as a featured image. */
export function featuredCount(refs: readonly UsageRef[]): number {
  return refs.filter((ref) => ref.contexts.includes('featured')).length
}

/** The amber notice above Attached to (and the delete confirm's). */
export function featuredWarning(count: number): string {
  const those = count === 1 ? 'that post shows' : 'those posts show'
  return `Featured image of ${plural(count, 'post')}. Deleting this file clears it there, and ${those} no image until a new one is set.`
}

/** "and 12 more" under a list capped at 200 refs. */
export function moreLine(count: number, shown: number): string | null {
  return count > shown
    ? `and ${(count - shown).toLocaleString('en')} more`
    : null
}

/** The first `cap` ids of a large selection. */
export function capIds(
  ids: readonly number[],
  cap: number,
): { ids: readonly number[]; capped: boolean } {
  return ids.length > cap
    ? { ids: ids.slice(0, cap), capped: true }
    : { ids, capped: false }
}

// ---------------------------------------------------------------------------
// Several items
// ---------------------------------------------------------------------------

/** One post (or site-level place) and how many of the items use it. */
export interface UsageGroup {
  key: string
  ref: UsageRef
  /** items of the selection that use it */
  items: number
  /** every way they use it, in first-seen order */
  contexts: UsageContext[]
}

/** The identity of a place: a post id, or the site-level use itself. */
export function refKey(ref: UsageRef): string {
  return ref.postId === null
    ? `site:${ref.title}:${[...ref.contexts].sort().join(',')}`
    : `post:${ref.postId}`
}

/**
 * Groups the items' refs by place, counting each item once per place.
 * Sorted by how many items use it, then site-level first, then by title.
 */
export function groupUsage(usages: readonly ItemUsage[]): UsageGroup[] {
  const groups = new Map<string, UsageGroup>()
  for (const usage of usages) {
    const seen = new Set<string>()
    for (const ref of usage.refs) {
      const key = refKey(ref)
      let group = groups.get(key)
      if (!group) {
        group = { key, ref, items: 0, contexts: [] }
        groups.set(key, group)
      }
      if (!seen.has(key)) {
        seen.add(key)
        group.items += 1
      }
      for (const context of ref.contexts) {
        if (!group.contexts.includes(context)) {
          group.contexts.push(context)
        }
      }
    }
  }
  const siteFirst = (group: UsageGroup) => (isSiteLevel(group.ref) ? 0 : 1)
  return [...groups.values()].sort(
    (a, b) =>
      b.items - a.items ||
      siteFirst(a) - siteFirst(b) ||
      a.ref.title.localeCompare(b.ref.title),
  )
}

/**
 * The batch summary line: "Used in 7 posts · 3 not used anywhere". Says
 * "places" when a site-level use is among them (it isn't a post).
 */
export function batchUsedInLine(
  groups: readonly UsageGroup[],
  unused: number,
): string {
  const unusedPart =
    unused > 0 ? `${unused.toLocaleString('en')} not used anywhere` : null
  if (groups.length === 0) {
    return unused > 0 ? 'None of them is used anywhere' : 'Not used anywhere'
  }
  const posts = groups.every((group) => !isSiteLevel(group.ref))
  const used = `Used in ${plural(groups.length, posts ? 'post' : 'place')}`
  return unusedPart ? `${used} · ${unusedPart}` : used
}

/** Items the usage index knows no use of. */
export function unusedCount(usages: readonly ItemUsage[]): number {
  return usages.filter((usage) => usage.count === 0).length
}

/** "Changes apply to the 5 items you uploaded. 7 uploaded by others stay as they are." */
export function mixedNotice(own: number, others: number): string {
  const stay = others === 1 ? 'stays as it is' : 'stay as they are'
  return `Changes apply to the ${plural(own, 'item')} you uploaded. ${others.toLocaleString('en')} uploaded by others ${stay}.`
}
