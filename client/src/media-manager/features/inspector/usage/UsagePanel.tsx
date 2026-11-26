// The Usage tab's body (inspector.md §5, §7): where the targets are used
// (from the companion plugin's usage index) and what they are attached to
// ("Uploaded to" in wp-admin), with attach / detach through the post picker.
//
// - Nothing selected: used / not-used counts for the view (facets).
// - One item: its places, the featured-image warning, Attached to.
// - Several: places grouped with "N selected items" counts, "N of M
//   attached", Attach N to… and Detach all. Usage and full items load for
//   the first 500 selected items; a larger selection says so, and its
//   actions apply to those.
//
// The index can't see everything (theme files, custom CSS, other plugins'
// settings) and may still be building (D22); the footnote says both.
// Lives in the lazy panel chunk (Panel.tsx imports it).

import { ActionIcon, Button } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useMemo, useRef } from 'react'
import type {
  LibraryItemFull,
  PostRef,
  UsageContext,
  UsageRef,
} from '../../../../../../shared/library-api'
import { useCollection, useItem } from '../../../core/collection/hooks'
import { useFacets } from '../../../core/data/facets'
import { type UsageEntry, useUsage } from '../../../core/data/inspector'
import { chunkIds, useItemChunks } from '../../../core/data/items'
import { libraryKeys } from '../../../core/data/keys'
import { type CanResult, can, useCan } from '../../../core/perms'
import { useCore } from '../../../core/state'
import { plural } from '../../../core/ui/announce'
import {
  AlertIcon,
  DetachIcon,
  ExternalLinkIcon,
  FileIcon,
  LockIcon,
  PostIcon,
  RetryIcon,
  SiteIcon,
  UsageIcon,
} from '../../../core/ui/icons'
import { splitFileName } from '../format'
import inspectorClasses from '../Inspector.module.css'
import {
  changeAttachment,
  changeAttachments,
  failureReason,
  usePendingChange,
} from './attach'
import {
  batchUsedInLine,
  capIds,
  contextLabel,
  featuredCount,
  featuredWarning,
  groupUsage,
  mixedNotice,
  moreLine,
  refKey,
  statusLabel,
  unusedCount,
  usedInLine,
} from './model'
import { PostPicker } from './PostPicker'
import classes from './Usage.module.css'

/** Selections larger than this show (and act on) their first items only. */
export const USAGE_ITEM_CAP = 500

/** Places listed for several items; the rest are counted. */
const GROUP_ROWS = 50

const AUTHOR_NOTICE =
  'You can view but not edit media uploaded by others (Author role).'

const ATTACH_HINT =
  'Attaching links the file to one post (“Uploaded to” in WordPress). It doesn’t insert it anywhere.'

export function UsagePanel({ ids, hidden }: { ids: number[]; hidden: number }) {
  const verdict = useCan('view-usage')
  if (!verdict.ok && verdict.code === 'needs-plugin') {
    return (
      <p className={inspectorClasses.notice} data-testid='usage-unavailable'>
        Where files are used comes from the companion plugin’s usage index.{' '}
        {verdict.reason}.
      </p>
    )
  }
  if (ids.length === 0) {
    return <ViewSummary />
  }
  if (ids.length === 1) {
    const id = ids[0] as number
    return <SingleUsage key={id} id={id} />
  }
  return <BatchUsage ids={ids} hidden={hidden} />
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** The Author role can't edit others' media (core perms say so per item). */
function useIsAuthor(): boolean {
  return useCore((state) => {
    const site = state.bootstrap?.site
    return site ? !site.user.caps.editOthersPosts : false
  })
}

type AttachMode =
  | { kind: 'edit' }
  /** not the user's media: a notice, no controls */
  | { kind: 'readonly'; notice: string }
  /** allowed in principle, not now (offline, …): disabled, with the reason */
  | { kind: 'blocked'; reason: string }

function attachModeOf(verdict: CanResult, isAuthor: boolean): AttachMode {
  if (verdict.ok) {
    return { kind: 'edit' }
  }
  if (verdict.code === 'no-item-perm') {
    return {
      kind: 'readonly',
      notice: isAuthor ? AUTHOR_NOTICE : `${verdict.reason}.`,
    }
  }
  return { kind: 'blocked', reason: verdict.reason }
}

function LockNotice({ children }: { children: string }) {
  return (
    <p className={inspectorClasses.lock} data-testid='usage-lock-notice'>
      <LockIcon size={16} aria-hidden className={inspectorClasses.lockIcon} />
      <span>{children}</span>
    </p>
  )
}

function Footnote({
  complete,
  counts = false,
}: {
  complete: boolean
  counts?: boolean
}) {
  return (
    <div className={classes.footnote} data-testid='usage-footnote'>
      <p className={classes.hint}>
        Found in post content, blocks and featured images. Uses in theme files,
        custom CSS or other plugins’ settings aren’t detected.
      </p>
      {!complete && (
        <p className={classes.hint} data-testid='usage-incomplete'>
          The usage index is still being built, so{' '}
          {counts ? 'these counts' : 'this'} may be incomplete.
        </p>
      )}
    </div>
  )
}

function LoadError({
  what,
  error,
  onRetry,
}: {
  what: string
  error: unknown
  onRetry: () => void
}) {
  return (
    <div className={classes.error} data-testid='usage-error'>
      <span>
        Couldn’t load {what}: {failureReason(error)}.
      </span>
      <Button
        type='button'
        size='compact-xs'
        variant='default'
        className={classes.button}
        leftSection={<RetryIcon size={14} aria-hidden />}
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <h4 className={classes.sectionTitle}>{children}</h4>
}

/**
 * One post, page or site-level place: title (opens it when it is public),
 * "Post · Gallery block", and "Edit in WordPress" when the user may.
 */
function PlaceRow({
  place,
  contexts,
  items,
}: {
  place: UsageRef | PostRef
  contexts?: readonly UsageContext[]
  /** several items: how many of them use it */
  items?: number
}) {
  const site = place.postId === null
  const Icon = site ? SiteIcon : place.postType === 'page' ? FileIcon : PostIcon
  const status =
    !site && place.status !== 'publish' ? statusLabel(place.status) : null
  const shown = contexts ?? ('contexts' in place ? place.contexts : [])
  return (
    <li className={classes.row} data-testid='usage-row'>
      <span className={classes.rowIcon}>
        <Icon size={16} aria-hidden />
      </span>
      <span className={classes.rowText}>
        {place.viewUrl ? (
          <a
            className={classes.rowTitle}
            href={place.viewUrl}
            target='_blank'
            rel='noopener noreferrer'
            title={place.title}
          >
            {place.title}
          </a>
        ) : (
          <span className={classes.rowTitle} title={place.title}>
            {place.title}
          </span>
        )}
        <span className={classes.rowMeta}>
          {place.postTypeLabel}
          {status && ` · ${status}`}
          {shown.map((context, index) => (
            <Fragment key={context}>
              {index === 0 ? ' · ' : ', '}
              <span
                className={
                  context === 'featured' ? classes.featured : undefined
                }
              >
                {contextLabel(context)}
              </span>
            </Fragment>
          ))}
          {items !== undefined && ` · ${plural(items, 'selected item')}`}
        </span>
      </span>
      {place.editUrl && (
        <ActionIcon
          component='a'
          href={place.editUrl}
          target='_blank'
          rel='noopener noreferrer'
          variant='subtle'
          color='gray'
          size='md'
          className={classes.rowAction}
          aria-label={`Edit “${place.title}” in WordPress`}
          title='Edit in WordPress'
        >
          <ExternalLinkIcon size={16} aria-hidden />
        </ActionIcon>
      )}
    </li>
  )
}

/**
 * Attach / Change… and Detach for one item. Hidden for others' media
 * (Author); disabled with the reason when not possible right now.
 */
function AttachControls({
  item,
  compact = false,
}: {
  item: LibraryItemFull
  /** The Info panel's row: "Attach…" or Detach, no hint line. */
  compact?: boolean
}) {
  const queryClient = useQueryClient()
  const mode = attachModeOf(useCan('attach', item), useIsAuthor())
  const { pending, run } = usePendingChange()
  const pickerButton = useRef<HTMLButtonElement | null>(null)
  const detachButton = useRef<HTMLButtonElement | null>(null)
  const refocus = useRef(false)
  const refocusDetach = useRef(false)
  const attached = item.attachedTo !== null

  // Detach removes its own button (at once: the change is optimistic), so
  // focus moves to the picker's button instead of falling to the page. In
  // the compact row an attach removes the picker's button the same way:
  // focus moves to Detach.
  useEffect(() => {
    if (!attached && refocus.current) {
      refocus.current = false
      pickerButton.current?.focus()
    }
    if (attached && refocusDetach.current) {
      refocusDetach.current = false
      detachButton.current?.focus()
    }
  }, [attached])

  if (mode.kind === 'readonly') {
    return null
  }
  const blocked = mode.kind === 'blocked' ? mode.reason : null
  const busy = pending !== null
  const attach = (post: PostRef) => {
    refocusDetach.current = compact
    void run('attach', async () => {
      const ok = await changeAttachment(queryClient, item, post)
      if (!ok) {
        refocusDetach.current = false
      }
      return ok
    })
  }
  const detach = () => {
    if (busy) {
      return
    }
    refocus.current = true
    void run('detach', async () => {
      const ok = await changeAttachment(queryClient, item, null)
      if (!ok) {
        refocus.current = false
      }
      return ok
    })
  }
  const pickerLabel =
    pending === 'attach'
      ? 'Attaching…'
      : compact
        ? 'Attach…'
        : attached
          ? 'Change…'
          : 'Attach to…'
  const showPicker = !compact || !attached
  return (
    <>
      <div className={classes.actions}>
        {showPicker && (
          <PostPicker
            onPick={attach}
            disabled={blocked !== null}
            disabledReason={blocked ?? undefined}
            busy={busy}
            buttonRef={(element) => {
              pickerButton.current = element
            }}
            leftSection={<UsageIcon size={14} aria-hidden />}
            data-testid='attach-button'
          >
            {pickerLabel}
          </PostPicker>
        )}
        {attached && (
          <Button
            ref={detachButton}
            type='button'
            size='xs'
            variant='subtle'
            className={`${classes.button} ${classes.ghost}`}
            leftSection={<DetachIcon size={14} aria-hidden />}
            disabled={blocked !== null}
            title={blocked ?? undefined}
            aria-busy={pending === 'detach' || undefined}
            onClick={detach}
          >
            {pending === 'detach' ? 'Detaching…' : 'Detach'}
          </Button>
        )}
      </div>
      {blocked && !compact && <p className={classes.hint}>{blocked}.</p>}
    </>
  )
}

/**
 * "<post> | Detach" or "Not attached | Attach…": the value of the Info
 * panel's "Attached to" row (FileSections' `attachedSlot`, which renders the
 * label itself).
 */
export function AttachedToRow({ item }: { item: LibraryItemFull }) {
  const post = item.attachedTo
  return (
    <div className={classes.attachedRow} data-testid='attached-to-row'>
      <span
        className={classes.attachedValue}
        data-empty={post ? undefined : ''}
        title={post?.title}
      >
        {post === null ? (
          'Not attached'
        ) : post.viewUrl ? (
          <a href={post.viewUrl} target='_blank' rel='noopener noreferrer'>
            {post.title}
          </a>
        ) : (
          post.title
        )}
      </span>
      <AttachControls item={item} compact />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Nothing selected
// ---------------------------------------------------------------------------

function ViewSummary() {
  const collection = useCollection()
  const facets = useFacets(collection.query, { keepPrevious: true })
  const view = facets.data?.view
  return (
    <div className={inspectorClasses.single}>
      <div>
        <h3 className={inspectorClasses.heading}>Nothing selected</h3>
        <p className={inspectorClasses.sub}>
          {collection.status === 'pending'
            ? 'Loading…'
            : `${plural(collection.total, 'item')} in view`}
        </p>
      </div>
      {view ? (
        <dl className={classes.stats} data-testid='usage-stats'>
          <div className={classes.stat}>
            <dt className={classes.statLabel}>used in posts</dt>
            <dd className={classes.statValue}>
              {(view.total - view.unused).toLocaleString('en')}
            </dd>
          </div>
          <div className={classes.stat}>
            <dt className={classes.statLabel}>not used anywhere</dt>
            <dd className={classes.statValue}>
              {view.unused.toLocaleString('en')}
            </dd>
          </div>
        </dl>
      ) : facets.isError ? (
        <LoadError
          what='the counts'
          error={facets.error}
          onRetry={() => void facets.refetch()}
        />
      ) : (
        <p className={classes.empty}>Loading…</p>
      )}
      <p className={classes.hint}>
        Select an item to see which posts and pages use it, and to attach it to
        one.
      </p>
      <Footnote complete={facets.data?.usageComplete ?? true} counts />
    </div>
  )
}

// ---------------------------------------------------------------------------
// One item
// ---------------------------------------------------------------------------

function SingleUsage({ id }: { id: number }) {
  const { item, status, missing } = useItem(id, 'full')
  const ids = useMemo(() => [id], [id])
  const usage = useUsage(ids)
  const entry = usage.items.get(id)
  const isAuthor = useIsAuthor()
  const verdict = useCan('attach', item ?? undefined)

  if (missing) {
    return <p className={inspectorClasses.sub}>This item no longer exists.</p>
  }
  const mode = item ? attachModeOf(verdict, isAuthor) : null
  const featured = entry ? featuredCount(entry.refs) : 0
  const name = item ? splitFileName(item.filename) : null
  return (
    <div className={inspectorClasses.single}>
      <div>
        {item && name ? (
          <h3
            className={inspectorClasses.fileName}
            title={item.filename}
            data-testid='usage-file-name'
          >
            {name.head && (
              <span className={inspectorClasses.nameHead}>{name.head}</span>
            )}
            <span className={inspectorClasses.nameTail}>{name.tail}</span>
          </h3>
        ) : (
          <h3 className={inspectorClasses.heading}>
            {status === 'error' ? 'Couldn’t load this item' : 'Loading…'}
          </h3>
        )}
        <p className={inspectorClasses.sub} data-testid='usage-count'>
          {entry ? usedInLine(entry.count) : usage.error ? '' : 'Loading…'}
        </p>
      </div>
      {mode?.kind === 'readonly' && <LockNotice>{mode.notice}</LockNotice>}
      <section className={classes.section}>
        <SectionTitle>Used in</SectionTitle>
        {entry ? (
          <Places entry={entry} />
        ) : usage.error ? (
          <LoadError
            what='where this file is used'
            error={usage.error}
            onRetry={usage.refetch}
          />
        ) : (
          <p className={classes.empty}>Loading…</p>
        )}
      </section>
      {featured > 0 && (
        <p className={classes.warn} data-testid='featured-warning'>
          <AlertIcon size={16} aria-hidden className={classes.warnIcon} />
          <span>{featuredWarning(featured)}</span>
        </p>
      )}
      <section className={classes.section}>
        <SectionTitle>Attached to</SectionTitle>
        {item ? (
          <>
            {item.attachedTo ? (
              <ul className={classes.list} data-testid='attached-to'>
                <PlaceRow place={item.attachedTo} />
              </ul>
            ) : (
              <p className={classes.empty} data-testid='attached-to'>
                Not attached
              </p>
            )}
            <AttachControls item={item} />
            <p className={classes.hint}>{ATTACH_HINT}</p>
          </>
        ) : (
          <p className={classes.empty}>
            {status === 'error' ? 'Couldn’t load this item.' : 'Loading…'}
          </p>
        )}
      </section>
      <Footnote complete={usage.complete} />
    </div>
  )
}

function Places({ entry }: { entry: UsageEntry }) {
  if (entry.refs.length === 0) {
    return (
      <p className={classes.emptyCard} data-testid='usage-empty'>
        <UsageIcon size={16} aria-hidden className={classes.emptyIcon} />
        <span>No post or page uses this file.</span>
      </p>
    )
  }
  const more = moreLine(entry.count, entry.refs.length)
  return (
    <>
      <ul className={classes.list} data-testid='usage-list'>
        {entry.refs.map((ref) => (
          <PlaceRow key={refKey(ref)} place={ref} />
        ))}
      </ul>
      {more && <p className={classes.more}>{more}</p>}
    </>
  )
}

// ---------------------------------------------------------------------------
// Several items
// ---------------------------------------------------------------------------

function BatchUsage({ ids, hidden }: { ids: number[]; hidden: number }) {
  const queryClient = useQueryClient()
  const { ids: covered, capped } = useMemo(
    () => capIds(ids, USAGE_ITEM_CAP),
    [ids],
  )
  const usage = useUsage(covered)
  const chunks = useMemo(() => chunkIds(covered), [covered])
  const hydrated = useItemChunks(chunks, 'full')
  const isAuthor = useIsAuthor()
  // Re-renders when the app context (connectivity, bootstrap) changes.
  useCan('attach')
  const { pending, run } = usePendingChange()
  const pickerButton = useRef<HTMLButtonElement | null>(null)
  const refocus = useRef(false)

  const usages = useMemo(
    () =>
      covered.flatMap((id) => {
        const entry = usage.items.get(id)
        return entry ? [entry] : []
      }),
    [covered, usage.items],
  )
  const groups = useMemo(() => groupUsage(usages), [usages])
  const items = covered.flatMap((id) => {
    const item = hydrated.items.get(id)
    return item ? [item] : []
  })
  const itemsLoaded = !hydrated.pending

  // Who may be changed (D9): own media; others' stay as they are.
  const allowed: LibraryItemFull[] = []
  const notNow: { item: LibraryItemFull; reason: string }[] = []
  let foreign = 0
  for (const item of items) {
    const verdict = can('attach', item)
    if (verdict.ok) {
      allowed.push(item)
    } else if (verdict.code === 'no-item-perm') {
      foreign += 1
    } else {
      notNow.push({ item, reason: verdict.reason })
    }
  }
  const actionable = allowed.length + notNow.length
  const blocked = allowed.length === 0 ? (notNow[0]?.reason ?? null) : null
  const attachedCount = items.filter((item) => item.attachedTo !== null).length
  const toDetach = allowed.filter((item) => item.attachedTo !== null)
  const busy = pending !== null
  const count = allowed.length > 0 ? allowed.length : notNow.length

  // Detach all removes its own button once done: focus the picker's.
  const detachGone = toDetach.length === 0 && pending !== 'detach'
  useEffect(() => {
    if (detachGone && refocus.current) {
      refocus.current = false
      pickerButton.current?.focus()
    }
  }, [detachGone])

  const attachAll = (post: PostRef) => {
    void run('attach', () => changeAttachments(queryClient, allowed, post))
  }
  const detachAll = () => {
    if (!busy) {
      refocus.current = true
      void run('detach', async () => {
        const ok = await changeAttachments(queryClient, toDetach, null)
        if (!ok) {
          refocus.current = false
        }
        return ok
      })
    }
  }

  const shownGroups = groups.slice(0, GROUP_ROWS)
  const moreGroups = groups.length - shownGroups.length
  return (
    <div className={inspectorClasses.single}>
      <div>
        <h3 className={inspectorClasses.heading}>
          {ids.length.toLocaleString('en')} items selected
        </h3>
        <p className={inspectorClasses.sub} data-testid='usage-count'>
          {usages.length > 0
            ? batchUsedInLine(groups, unusedCount(usages))
            : usage.error
              ? ''
              : 'Loading…'}
        </p>
        {hidden > 0 && (
          <p className={inspectorClasses.sub}>
            {hidden.toLocaleString('en')} of them hidden by the filters
          </p>
        )}
      </div>
      {capped && (
        <p className={inspectorClasses.notice} data-testid='usage-capped'>
          Usage of the first {USAGE_ITEM_CAP.toLocaleString('en')} selected
          items. Attach and Detach apply to these too.
        </p>
      )}
      {itemsLoaded && foreign > 0 && actionable === 0 && (
        <LockNotice>
          {isAuthor ? AUTHOR_NOTICE : 'You can’t change these items.'}
        </LockNotice>
      )}
      {itemsLoaded && foreign > 0 && actionable > 0 && (
        <p className={inspectorClasses.notice} data-testid='usage-mixed'>
          {mixedNotice(actionable, foreign)}
        </p>
      )}
      <section className={classes.section}>
        <SectionTitle>Used in</SectionTitle>
        {usage.error && usages.length === 0 ? (
          <LoadError
            what='where these files are used'
            error={usage.error}
            onRetry={usage.refetch}
          />
        ) : usages.length === 0 ? (
          <p className={classes.empty}>Loading…</p>
        ) : groups.length === 0 ? (
          <p className={classes.emptyCard} data-testid='usage-empty'>
            <UsageIcon size={16} aria-hidden className={classes.emptyIcon} />
            <span>None of these items is used anywhere.</span>
          </p>
        ) : (
          <>
            <ul className={classes.list} data-testid='usage-list'>
              {shownGroups.map((group) => (
                <PlaceRow
                  key={group.key}
                  place={group.ref}
                  contexts={group.contexts}
                  items={group.items}
                />
              ))}
            </ul>
            {moreGroups > 0 && (
              <p className={classes.more}>
                and {plural(moreGroups, 'more place', 'more places')}
              </p>
            )}
          </>
        )}
      </section>
      <section className={classes.section}>
        <SectionTitle>Attached to</SectionTitle>
        {hydrated.errors.length > 0 && items.length === 0 ? (
          <LoadError
            what='the items'
            error={hydrated.errors[0]}
            onRetry={() =>
              void queryClient.refetchQueries({
                queryKey: libraryKeys.itemChunks('full'),
              })
            }
          />
        ) : !itemsLoaded ? (
          <p className={classes.empty}>Loading…</p>
        ) : (
          <>
            <p className={classes.empty} data-testid='attached-count'>
              {attachedCount.toLocaleString('en')} of{' '}
              {items.length.toLocaleString('en')} attached
            </p>
            {actionable > 0 && (
              <div className={classes.actions}>
                <PostPicker
                  onPick={attachAll}
                  disabled={blocked !== null}
                  disabledReason={blocked ?? undefined}
                  busy={busy}
                  buttonRef={(element) => {
                    pickerButton.current = element
                  }}
                  leftSection={<UsageIcon size={14} aria-hidden />}
                  data-testid='attach-button'
                >
                  {pending === 'attach'
                    ? 'Attaching…'
                    : `Attach ${count.toLocaleString('en')} to…`}
                </PostPicker>
                {(toDetach.length > 0 || pending === 'detach') && (
                  <Button
                    type='button'
                    size='xs'
                    variant='subtle'
                    className={`${classes.button} ${classes.ghost}`}
                    leftSection={<DetachIcon size={14} aria-hidden />}
                    disabled={blocked !== null}
                    title={blocked ?? undefined}
                    aria-busy={pending === 'detach' || undefined}
                    onClick={detachAll}
                  >
                    {pending === 'detach' ? 'Detaching…' : 'Detach all'}
                  </Button>
                )}
              </div>
            )}
            {blocked && <p className={classes.hint}>{blocked}.</p>}
          </>
        )}
        <p className={classes.hint}>{ATTACH_HINT}</p>
      </section>
      <Footnote complete={usage.complete} />
    </div>
  )
}
