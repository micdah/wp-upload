// The filter bar's rules (interaction-spec §3), as pure functions: labels,
// which chips show, the active extra filters, and the summary. The URL is
// the only state: every filter is a query parameter (§1), written with
// replace (D16).

import {
  type FacetCounts,
  ORIENTATIONS,
  type Orientation,
  SIZE_FILTERS,
  type SizeFilter,
  SORT_KEYS,
  type SortKey,
  type TypeFilter,
} from '../../../../../shared/library-api'
import type { UrlState } from '../../core/url/codec'

/** The sort menu (prototype `SORT_LABELS`). */
export const SORT_LABELS: Record<SortKey, string> = {
  'date-desc': 'Newest',
  'date-asc': 'Oldest',
  'title-asc': 'Title A–Z',
  'name-asc': 'File name A–Z',
  'size-desc': 'Largest file',
  'size-asc': 'Smallest file',
  'dimensions-desc': 'Largest dimensions',
  'type-asc': 'File type',
}

export const SORT_OPTIONS = SORT_KEYS.map((key) => ({
  key,
  label: SORT_LABELS[key],
}))

export const SIZE_LABELS: Record<SizeFilter, string> = {
  gt1: '> 1 MB',
  gt5: '> 5 MB',
}

export const ORIENTATION_LABELS: Record<Orientation, string> = {
  landscape: 'Landscape',
  portrait: 'Portrait',
  square: 'Square',
}

export const SIZE_OPTIONS = SIZE_FILTERS.map((key) => ({
  key,
  label: SIZE_LABELS[key],
}))

export const ORIENTATION_OPTIONS = ORIENTATIONS.map((key) => ({
  key,
  label: ORIENTATION_LABELS[key],
}))

/** "November 2026" for `2026-11` (English, like the rest of the UI). */
export function monthLabel(month: string): string {
  const [year, number] = month.split('-').map(Number)
  if (!year || !number) return month
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Bytes as "12.3 MB" (decimal units, like the size filters). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1000) {
    return `${Math.max(0, Math.round(bytes || 0))} B`
  }
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

export interface TypeChip {
  /** null is "All". */
  type: TypeFilter | null
  label: string
  count: number
  active: boolean
}

const TYPE_CHIPS: readonly { type: TypeFilter | null; label: string }[] = [
  { type: null, label: 'All' },
  { type: 'image', label: 'Images' },
  { type: 'video', label: 'Video' },
  { type: 'audio', label: 'Audio' },
  { type: 'document', label: 'Documents' },
]

/**
 * The type chips with the folder's counts (facets `folder` scope). A type
 * with no items in the folder is hidden, unless it is the active filter (so
 * it can still be turned off).
 */
export function typeChips(
  folder: FacetCounts,
  active: TypeFilter | null,
): TypeChip[] {
  return TYPE_CHIPS.flatMap(({ type, label }) => {
    const count = type === null ? folder.total : folder.types[type]
    const isActive = type === active
    if (type !== null && count === 0 && !isActive) return []
    return [{ type, label, count, active: isActive }]
  })
}

export type ExtraFilter = 'size' | 'orient' | 'month'

export interface ActiveChip {
  filter: ExtraFilter
  label: string
}

/** The active extra filters, as removable chips. */
export function activeExtraChips(
  state: Pick<UrlState, 'size' | 'orient' | 'month'>,
): ActiveChip[] {
  const chips: ActiveChip[] = []
  if (state.size !== null) {
    chips.push({ filter: 'size', label: SIZE_LABELS[state.size] })
  }
  if (state.orient !== null) {
    chips.push({ filter: 'orient', label: ORIENTATION_LABELS[state.orient] })
  }
  if (state.month !== null) {
    chips.push({ filter: 'month', label: monthLabel(state.month) })
  }
  return chips
}

/** `N items · total size` (the size once facets for this view are in). */
export function summaryText(total: number, bytes: number | null): string {
  const items = `${total.toLocaleString('en')} ${total === 1 ? 'item' : 'items'}`
  return bytes === null ? items : `${items} · ${formatBytes(bytes)}`
}
