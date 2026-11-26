// The Edit tab's stub (inspector.md §6 "Other states"). The image editor
// (track B1, M4) registers the real panel with `registerEditPanel`
// (bridge.ts); until then the tab explains what editing will cover and says
// why an item can't be edited (several items, SVG, not an image, not
// allowed). The cases B1 doesn't change stay useful afterwards.

import { Button } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import type {
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import { useCollection, useItem } from '../../core/collection/hooks'
import { cachedItem } from '../../core/data/items'
import { useCan } from '../../core/perms'
import { coreStore } from '../../core/state'
import { LockIcon } from '../../core/ui/icons'
import { useBridge } from './bridge'
import classes from './Inspector.module.css'

const PROMISE = 'Saved in place — same file, same URL.'

export function EditPanel({ ids }: { ids: readonly number[] }) {
  const Registered = useBridge((state) => state.editPanel)
  if (Registered) {
    return <Registered ids={ids} />
  }
  if (ids.length === 0) {
    return (
      <div className={classes.summary}>
        <p className={classes.notice}>
          Select an image to crop, rotate, flip or scale it.
        </p>
        <p className={classes.hint}>{PROMISE}</p>
      </div>
    )
  }
  if (ids.length > 1) {
    return <SeveralToEdit ids={ids} />
  }
  return <OneToEdit id={ids[0] as number} />
}

/**
 * Several selected: the editor works on one image, so offer the first
 * raster image among them (kinds from the collection rows, else the cache).
 */
function SeveralToEdit({ ids }: { ids: readonly number[] }) {
  const queryClient = useQueryClient()
  const { rows } = useCollection()
  const first =
    ids.find((id) => {
      const index = rows.indexOf(id)
      const kind =
        index >= 0 ? rows.kindAt(index) : cachedItem(queryClient, id)?.kind
      return kind === 'image'
    }) ?? null
  const { item } = useItem(first, 'tile')
  return (
    <div className={classes.summary}>
      <p className={classes.notice}>
        Crop, rotate and flip work on one image at a time.
      </p>
      {first === null ? (
        <p className={classes.hint}>None of the selected items is an image.</p>
      ) : (
        item && (
          <Button
            variant='default'
            size='xs'
            className={classes.passButton}
            onClick={() => coreStore.getState().selectOnly(first)}
          >
            Edit “{item.title || item.filename}”
          </Button>
        )
      )}
    </div>
  )
}

function reasonFor(item: LibraryItemTile | LibraryItemFull): string | null {
  if (item.kind === 'svg') {
    return 'SVG images are vectors: they have no pixels to crop and no sizes to regenerate.'
  }
  if (item.kind !== 'image') {
    return 'Crop, rotate and flip are for images (JPEG, PNG, WebP, AVIF).'
  }
  return null
}

function OneToEdit({ id }: { id: number }) {
  const { item } = useItem(id, 'full')
  const verdict = useCan('edit-image', item ?? undefined)
  if (!item) {
    return <p className={classes.sub}>Loading…</p>
  }
  const reason = reasonFor(item)
  if (reason) {
    return <p className={classes.notice}>{reason}</p>
  }
  if (!item.perms.edit) {
    return (
      <p className={classes.lock} data-testid='lock-notice'>
        <LockIcon size={16} aria-hidden className={classes.lockIcon} />
        <span>
          Uploaded by {item.author.name || 'someone else'}. You can view but not
          edit media uploaded by others (Author role).
        </span>
      </p>
    )
  }
  return (
    <div className={classes.summary}>
      <p className={classes.notice}>
        {verdict.ok
          ? 'Cropping, rotating, flipping and scaling arrive with the image editor.'
          : `${verdict.reason}.`}
      </p>
      <p className={classes.hint}>{PROMISE}</p>
    </div>
  )
}
