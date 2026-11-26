// The alt-text pass (inspector.md §4, S10):
//
// - **Start**: "Start alt-text pass" (summary or batch panel) turns on the
//   Missing alt filter, selects the first image without alt text and
//   focuses its alt field. Save & next (saveNext.ts) then walks the view;
//   each saved item leaves the filtered view, so the list shrinks as you go.
// - **Finish**: when a saved alt text empties the filtered view, the filter
//   switches off (the last item stays selected, its field focused) and one
//   toast celebrates. Only the save that turns the filter off toasts, so a
//   run celebrates once, not once per save.

import type { QueryClient } from '@tanstack/react-query'
import { rowsOf } from '../../core/collection/rows'
import { collectionQueryOptions } from '../../core/data/collection'
import { facetsQueryOptions } from '../../core/data/facets'
import { normaliseCollectionQuery } from '../../core/data/params'
import { coreStore, isInspectorOpen } from '../../core/state'
import { announce, plural } from '../../core/ui/announce'
import { toast } from '../../core/ui/toast'
import { collectionQueryOf, type UrlState } from '../../core/url/codec'
import { urlStore } from '../../core/url/useUrlState'
import { onFieldSaved } from './controller'
import { cachedFolderLabel } from './folderName'
import { moveTo } from './saveNext'

function currentQuery(state: UrlState = urlStore().get()) {
  return normaliseCollectionQuery(collectionQueryOf(state))
}

/** The Info tab must show for the alt field to take focus. */
function showInfo(): void {
  const core = coreStore.getState()
  if (!(isInspectorOpen(core) && core.panels.inspectorTab === 'info')) {
    core.selectInspectorTab('info')
  }
}

/**
 * Starts a pass: the Missing alt filter on, the first image selected and
 * its alt field focused. Resolves once it has moved there.
 */
export async function startAltPass(queryClient: QueryClient): Promise<void> {
  const url = urlStore()
  showInfo()
  if (url.get().alt !== 'missing') {
    url.navigate({ alt: 'missing' })
  }
  const query = currentQuery()
  let first: number | null = null
  let total = 0
  try {
    const snapshot = await queryClient.fetchQuery(collectionQueryOptions(query))
    const rows = rowsOf(snapshot)
    total = rows.length
    first = total > 0 ? rows.idAt(0) : null
  } catch {
    announce("Couldn't load the images without alt text")
    return
  }
  if (first === null) {
    url.navigate({ alt: null })
    announce('Every image here has alt text')
    return
  }
  moveTo(first, 'alt')
  announce(
    `Alt-text pass: ${plural(total, 'image')} without alt text. Enter saves and moves to the next.`,
  )
}

/**
 * After an alt text saved with the Missing alt filter on: if the view is
 * empty now, switch the filter off and celebrate.
 */
async function finishWhenDone(queryClient: QueryClient): Promise<void> {
  const url = urlStore()
  const before = url.get()
  if (before.alt !== 'missing') {
    return
  }
  const query = currentQuery(before)
  let total: number
  try {
    // The save's rev already invalidated this query; this joins the refetch.
    total = rowsOf(
      await queryClient.fetchQuery(collectionQueryOptions(query)),
    ).length
  } catch {
    return
  }
  const now = url.get()
  if (
    total > 0 ||
    now.alt !== 'missing' ||
    JSON.stringify(currentQuery(now)) !== JSON.stringify(query)
  ) {
    return
  }
  // Under a search or another filter the view may be done while the folder
  // isn't: the folder's own count (facets `folder`) decides the wording.
  let folderMissing: number | null = null
  try {
    const facets = await queryClient.fetchQuery(facetsQueryOptions(query))
    folderMissing = facets.folder.missingAlt
  } catch {
    // Without the count, claim only the view.
  }
  if (url.get().alt !== 'missing') {
    return
  }
  url.navigate({ alt: null })
  const folder = cachedFolderLabel(queryClient, query.folder)
  toast({
    tone: 'success',
    message: completionMessage(folder, folderMissing),
  })
}

/** The completion toast: the folder when it is done, else just the view. */
export function completionMessage(
  folder: string,
  folderMissing: number | null,
): string {
  if (folderMissing === 0) {
    return `Every image in ${folder} now has alt text — showing all files again`
  }
  return 'Every image in this view now has alt text — the Missing alt filter is off'
}

let installed = false

/** Watches alt saves for the end of a pass. Idempotent. */
export function installAltPass(): void {
  if (installed) {
    return
  }
  installed = true
  onFieldSaved((queryClient, _id, field) => {
    if (field === 'alt') {
      void finishWhenDone(queryClient)
    }
  })
}
