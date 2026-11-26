// The Info panel (inspector.md §2) for the M2 slice: a summary for nothing
// selected, a count for several items (batch editing comes with wave A), and
// for one item its name, meta line, preview and the autosaving Title and
// Alt text fields.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type {
  LibraryItemFull,
  LibraryItemTile,
  MediaKind,
} from '../../../../../shared/library-api'
import { useCollection, useItem } from '../../core/collection/hooks'
import { pictureFor } from '../../core/collection/renditions'
import { libraryKeys } from '../../core/data/keys'
import { useCan } from '../../core/perms'
import { plural } from '../../core/ui/announce'
import {
  ArchiveIcon,
  AudioIcon,
  FileIcon,
  LockIcon,
  PdfIcon,
  VideoIcon,
} from '../../core/ui/icons'
import { bridgeStore } from './bridge'
import { isImageLike, metaLine, splitFileName } from './format'
import classes from './Inspector.module.css'
import { MetaField } from './MetaField'

/** The preview's CSS box: the 312 px panel minus its padding, at 16:10. */
const PREVIEW_WIDTH = 280
const PREVIEW_HEIGHT = 175

export function NothingSelected() {
  const { total, status } = useCollection()
  return (
    <div className={classes.summary}>
      <h3 className={classes.heading}>Nothing selected</h3>
      <p className={classes.sub}>
        {status === 'pending' ? 'Loading…' : `${plural(total, 'item')} in view`}
      </p>
    </div>
  )
}

export function SeveralSelected({
  count,
  hidden,
}: {
  count: number
  hidden: number
}) {
  return (
    <div className={classes.summary}>
      <h3 className={classes.heading}>
        {count.toLocaleString('en')} items selected
      </h3>
      {hidden > 0 && (
        <p className={classes.sub}>
          {hidden.toLocaleString('en')} of them hidden by the filters
        </p>
      )}
      <p className={classes.notice}>
        Editing several items at once arrives in a later version. Select one
        item to edit its title and alt text.
      </p>
    </div>
  )
}

type AnyItem = LibraryItemTile | LibraryItemFull

/**
 * One item. The full view loads (from cache when the panel showed it
 * before); until then the grid's tile, if cached, fills in the fields.
 */
export function SingleItem({
  id,
  detailMode,
}: {
  id: number
  detailMode: boolean
}) {
  const queryClient = useQueryClient()
  const { item: full, status, missing } = useItem(id, 'full')
  const item: AnyItem | null =
    full ??
    queryClient.getQueryData<LibraryItemTile | null>(
      libraryKeys.item('tile', id),
    ) ??
    null

  // Commands (`A`) read the shown item's kind.
  useEffect(() => {
    if (item) {
      bridgeStore.getState().setShown({ id, kind: item.kind })
    }
  }, [id, item])

  if (missing) {
    return (
      <div className={classes.summary}>
        <p className={classes.sub}>This item no longer exists.</p>
      </div>
    )
  }
  if (!item) {
    return (
      <div className={classes.summary}>
        <p className={classes.sub}>
          {status === 'error' ? "Couldn't load this item." : 'Loading…'}
        </p>
      </div>
    )
  }
  return <ItemDetails item={item} detailMode={detailMode} />
}

function ItemDetails({
  item,
  detailMode,
}: {
  item: AnyItem
  detailMode: boolean
}) {
  const verdict = useCan('edit-meta', item)
  const { head, tail } = splitFileName(item.filename)
  const lockReason = verdict.ok
    ? null
    : item.perms.edit
      ? `${verdict.reason}.`
      : 'You can view but not edit media uploaded by others (Author role).'
  return (
    <div className={classes.single}>
      {!detailMode && <Preview item={item} />}
      <div>
        <h3
          className={classes.fileName}
          title={item.filename}
          data-testid='file-name'
        >
          {head && <span className={classes.nameHead}>{head}</span>}
          <span className={classes.nameTail}>{tail}</span>
        </h3>
        <p className={classes.sub}>{metaLine(item)}</p>
      </div>
      {lockReason && (
        <p className={classes.lock} data-testid='lock-notice'>
          <LockIcon size={16} aria-hidden className={classes.lockIcon} />
          <span>{lockReason}</span>
        </p>
      )}
      <MetaField
        id={item.id}
        field='title'
        current={item.title}
        locked={!item.perms.edit}
        refused={!verdict.ok}
        detailMode={detailMode}
      />
      {isImageLike(item.kind) && (
        <MetaField
          id={item.id}
          field='alt'
          current={item.alt}
          locked={!item.perms.edit}
          refused={!verdict.ok}
          flagMissing
          detailMode={detailMode}
        />
      )}
    </div>
  )
}

const KIND_ICONS: Partial<Record<MediaKind, typeof FileIcon>> = {
  video: VideoIcon,
  audio: AudioIcon,
  document: PdfIcon,
  archive: ArchiveIcon,
}

/** 16:10 on the stage colour, `contain`, so nothing shifts while it loads. */
function Preview({ item }: { item: AnyItem }) {
  const source = pictureFor(
    item,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
    window.devicePixelRatio || 1,
  )
  if (source) {
    return (
      <div
        className={classes.preview}
        data-kind={item.kind}
        data-testid='preview'
      >
        <img
          className={classes.previewImage}
          src={source}
          alt=''
          decoding='async'
          draggable={false}
        />
      </div>
    )
  }
  const Icon =
    item.kind === 'document' && item.mime !== 'application/pdf'
      ? FileIcon
      : (KIND_ICONS[item.kind] ?? FileIcon)
  return (
    <div
      className={classes.preview}
      data-kind={item.kind}
      data-testid='preview'
    >
      <Icon
        size={40}
        stroke={1.25}
        aria-hidden
        className={classes.previewIcon}
      />
    </div>
  )
}
