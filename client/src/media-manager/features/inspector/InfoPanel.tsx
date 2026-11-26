// The Info panel for one item (inspector.md §2 "One item"): preview (grid
// mode only), name and meta line, the read-only notice, the autosaving
// fields (Title, Alt text for image-like items, Caption, Description), the
// alt pass's strip, then the File / Camera / Sizes sections and the
// actions. Nothing selected is Summary.tsx; several items BatchPanel.tsx.

import { UnstyledButton } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import type {
  LibraryItemFull,
  LibraryItemTile,
  MediaKind,
} from '../../../../../shared/library-api'
import { useItem } from '../../core/collection/hooks'
import { pictureFor } from '../../core/collection/renditions'
import { runCommand } from '../../core/commands/registry'
import { libraryKeys } from '../../core/data/keys'
import { useCan } from '../../core/perms'
import {
  ArchiveIcon,
  AudioIcon,
  FileIcon,
  LockIcon,
  PdfIcon,
  PlayIcon,
  VideoIcon,
} from '../../core/ui/icons'
import { bridgeStore } from './bridge'
import { isImageLike, metaLine, splitFileName } from './format'
import classes from './Inspector.module.css'
import { MetaField } from './MetaField'
import { AltPassStrip } from './Summary'

/** The preview's CSS box: the 312 px panel minus its padding, at 16:10. */
const PREVIEW_WIDTH = 280
const PREVIEW_HEIGHT = 175

type AnyItem = LibraryItemTile | LibraryItemFull

/** What the panel renders below one item's fields (sections, actions). */
export type ItemExtras = (item: LibraryItemFull) => ReactNode

/**
 * One item. The full view loads (from cache when the panel showed it
 * before); until then the grid's tile, if cached, fills in Title and Alt
 * text. Caption, Description and the sections wait for the full item.
 */
export function SingleItem({
  id,
  detailMode,
  extras,
}: {
  id: number
  detailMode: boolean
  extras?: ItemExtras
}) {
  const queryClient = useQueryClient()
  const { item: full, status, missing } = useItem(id, 'full')
  const item: AnyItem | null =
    full ??
    queryClient.getQueryData<LibraryItemTile | null>(
      libraryKeys.item('tile', id),
    ) ??
    null

  // Commands (`A`, `E`) read the shown item's kind.
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
  return <ItemDetails item={item} detailMode={detailMode} extras={extras} />
}

function ItemDetails({
  item,
  detailMode,
  extras,
}: {
  item: AnyItem
  detailMode: boolean
  extras?: ItemExtras
}) {
  const verdict = useCan('edit-meta', item)
  const { head, tail } = splitFileName(item.filename)
  const lockReason = verdict.ok
    ? null
    : item.perms.edit
      ? `${verdict.reason}.`
      : 'You can view but not edit media uploaded by others (Author role).'
  const full = item.view === 'full' ? item : null
  const fieldProps = {
    id: item.id,
    locked: !item.perms.edit,
    refused: !verdict.ok,
    detailMode,
  }
  const altMissing = item.alt.trim() === ''
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
      <MetaField {...fieldProps} field='title' current={item.title} />
      {isImageLike(item.kind) && (
        <MetaField
          {...fieldProps}
          field='alt'
          current={item.alt}
          flagMissing
          below={(focused) =>
            fieldProps.locked ? null : (
              <AltPassStrip
                id={item.id}
                focused={focused}
                missing={altMissing}
              />
            )
          }
        />
      )}
      {full && (
        <>
          <MetaField {...fieldProps} field='caption' current={full.caption} />
          <MetaField
            {...fieldProps}
            field='description'
            current={full.description}
          />
          {extras?.(full)}
        </>
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

/**
 * 16:10 on the stage colour, `contain`, so nothing shifts while it loads.
 * "Open" (= Enter) shows on hover and focus; "Edited" marks images edited
 * in place.
 */
function Preview({ item }: { item: AnyItem }) {
  const source = pictureFor(
    item,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
    window.devicePixelRatio || 1,
  )
  const Icon =
    item.kind === 'document' && item.mime !== 'application/pdf'
      ? FileIcon
      : (KIND_ICONS[item.kind] ?? FileIcon)
  const edited = item.view === 'full' && item.edited
  return (
    <div
      className={classes.preview}
      data-kind={item.kind}
      data-testid='preview'
    >
      {source ? (
        <img
          className={classes.previewImage}
          src={source}
          alt=''
          decoding='async'
          draggable={false}
        />
      ) : (
        <Icon
          size={40}
          stroke={1.25}
          aria-hidden
          className={classes.previewIcon}
        />
      )}
      {item.kind === 'video' && source && (
        <PlayIcon size={28} aria-hidden className={classes.previewPlay} />
      )}
      {edited && <span className={classes.editedBadge}>Edited</span>}
      <UnstyledButton
        className={classes.previewOpen}
        onClick={() => {
          void runCommand('detail.open', { id: item.id })
        }}
      >
        Open
      </UnstyledButton>
    </div>
  )
}
