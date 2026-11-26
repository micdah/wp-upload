// The grid's empty states (interaction-spec §2, system.md §3; screens.md S8
// and S14–S15): no media matches the filters (Clear filters), an empty
// folder, and an empty library. Those that offer Upload are drop zones
// (dashed art); the Upload action is B2's `upload.pick`. A lazy chunk
// (GridView.tsx).

import { Button } from '@mantine/core'
import type { ReactNode } from 'react'
import { useCommand } from '../../core/commands/useCommand'
import {
  CloseIcon,
  FolderOpenIcon,
  SearchIcon,
  UploadArtIcon,
  UploadIcon,
} from '../../core/ui/icons'
import { hasActiveFilters } from '../../core/url/codec'
import { urlStore, useUrlState } from '../../core/url/useUrlState'
import classes from './Empty.module.css'

/** Clears search and every filter, keeping folder and sort (replaces). */
export function clearFilters(): void {
  urlStore().navigate({
    q: null,
    type: null,
    alt: null,
    size: null,
    orient: null,
    month: null,
  })
}

/** The Upload action of the empty states (B2 implements `upload.pick`). */
function UploadButton({ label }: { label: string }) {
  const upload = useCommand('upload.pick')
  return (
    <Button
      leftSection={<UploadIcon size={18} aria-hidden />}
      aria-disabled={!upload.enabled || undefined}
      data-disabled={!upload.enabled || undefined}
      title={upload.enabled ? undefined : `${label}: ${upload.reason}`}
      onClick={upload.run}
    >
      {label}
    </Button>
  )
}

function EmptyState({
  art,
  title,
  text,
  action,
  dropZone = false,
}: {
  art: ReactNode
  title: string
  text: string
  action: ReactNode
  dropZone?: boolean
}) {
  return (
    <div className={classes.empty} data-mm-empty=''>
      <div className={classes.emptyArt} data-drop={dropZone ? '' : undefined}>
        {art}
      </div>
      <h2 className={classes.emptyTitle}>{title}</h2>
      <p className={classes.emptyText}>{text}</p>
      {action}
    </div>
  )
}

export function GridEmpty() {
  const filtered = useUrlState(hasActiveFilters)
  const folder = useUrlState((state) => state.folder)
  if (filtered) {
    return (
      <EmptyState
        art={<SearchIcon size={28} stroke={1.5} aria-hidden />}
        title='No media matches'
        text={
          folder === 'all'
            ? 'Nothing in your library matches the current search and filters.'
            : 'Nothing in this folder matches the current search and filters.'
        }
        action={
          <Button
            variant='default'
            leftSection={<CloseIcon size={16} aria-hidden />}
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        }
      />
    )
  }
  if (folder === 'all') {
    return (
      <EmptyState
        dropZone
        art={<UploadArtIcon size={28} stroke={1.5} aria-hidden />}
        title='Your media library is empty'
        text='Drop files anywhere in this window, or upload them from your computer.'
        action={<UploadButton label='Upload files' />}
      />
    )
  }
  return (
    <EmptyState
      dropZone
      art={<FolderOpenIcon size={28} stroke={1.5} aria-hidden />}
      title='This folder is empty'
      text='Drop files here to upload them into it, or drag media onto the folder in the sidebar.'
      action={<UploadButton label='Upload' />}
    />
  )
}
