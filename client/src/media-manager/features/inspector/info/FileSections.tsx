// The Info panel's collapsible sections for one item (inspector.md §2 "One
// item", item 5): File, Camera (with EXIF) and Sizes (raster images). Native
// <details>, open state shared by every item for the session (sections.ts).

import { TextInput } from '@mantine/core'
import { type ReactNode, type SyntheticEvent, useRef } from 'react'
import type { LibraryItemFull } from '../../../../../../shared/library-api'
import { useFolderTree } from '../../../core/data/folderTree'
import { ChevronDownIcon } from '../../../core/ui/icons'
import { formatBytes, splitFileName } from '../format'
import { CopyButton } from './CopyButton'
import {
  dimensions,
  exposureLine,
  folderPath,
  formatDate,
  formatDuration,
  hasCameraInfo,
  hasSizes,
  mediaLine,
  sizeLabel,
} from './details'
import classes from './Sections.module.css'
import { type SectionId, useSectionOpen } from './sections'

export const SCALED_EXPLANATION =
  'WordPress scaled this upload down; the original is kept.'

export interface FileSectionsProps {
  item: LibraryItemFull
  /**
   * The value of the "Attached to" row (the post with Detach / Attach…), from
   * the usage feature. Without it the row shows the post title or "Not
   * attached".
   */
  attachedSlot?: ReactNode
}

export function FileSections({ item, attachedSlot }: FileSectionsProps) {
  return (
    <div className={classes.sections}>
      <FileSection item={item} attachedSlot={attachedSlot} />
      {hasCameraInfo(item.exif) && <CameraSection item={item} />}
      {hasSizes(item) && <SizesSection item={item} />}
    </div>
  )
}

function Section({
  id,
  title,
  count,
  children,
}: {
  id: SectionId
  title: string
  count?: number
  children: ReactNode
}) {
  const [open, setOpen] = useSectionOpen(id)
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(event.currentTarget.open)
  }
  return (
    <details
      className={classes.section}
      open={open}
      onToggle={onToggle}
      data-section={id}
      data-testid={`section-${id}`}
    >
      <summary className={classes.summary}>
        <span className={classes.sectionTitle}>{title}</span>
        {count !== undefined && (
          <span className={classes.count}>{count.toLocaleString('en')}</span>
        )}
        <ChevronDownIcon
          size={14}
          aria-hidden
          className={`${classes.chevron} ${classes.decor}`}
        />
      </summary>
      <div className={classes.sectionBody}>{children}</div>
    </details>
  )
}

/** One `<dt>`/`<dd>` pair of a meta list. */
function Row({
  label,
  children,
  title,
  testId,
  className,
}: {
  label: string
  children: ReactNode
  title?: string
  testId?: string
  className?: string
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={className} title={title} data-testid={testId}>
        {children}
      </dd>
    </>
  )
}

/** Folder path from the tree; "Uncategorized" for 0, without a fetch. */
function FolderValue({ folder }: { folder: number }) {
  const tree = useFolderTree({ enabled: folder > 0 })
  if (folder === 0) {
    return <>Uncategorized</>
  }
  if (tree.data) {
    return <>{folderPath(tree.data.folders, folder) ?? 'Unknown folder'}</>
  }
  if (tree.isError) {
    return <span className={classes.muted}>Unknown folder</span>
  }
  return <span className={classes.muted}>Loading…</span>
}

function FileName({ name }: { name: string }) {
  const { head, tail } = splitFileName(name)
  return (
    <span className={classes.fileName}>
      {head && <span className={classes.nameHead}>{head}</span>}
      <span className={classes.nameTail}>{tail}</span>
    </span>
  )
}

function FileSection({
  item,
  attachedSlot,
}: {
  item: LibraryItemFull
  attachedSlot?: ReactNode
}) {
  const urlInput = useRef<HTMLInputElement>(null)
  const uploaded = formatDate(item.uploadedAt)
  const edited = item.edited && item.editedAt ? formatDate(item.editedAt) : null
  const size = dimensions(item.width, item.height)
  const timed = item.kind === 'video' || item.kind === 'audio'
  const encoding = timed ? mediaLine(item.media) : null
  const original = item.original
  return (
    <Section id='file' title='File'>
      <dl className={classes.meta}>
        {item.folder !== null && (
          <Row label='Folder' testId='row-folder'>
            <FolderValue folder={item.folder} />
          </Row>
        )}
        <Row label='Uploaded' testId='row-uploaded'>
          {item.author.name ? `${uploaded} by ${item.author.name}` : uploaded}
        </Row>
        {edited && (
          <Row label='Edited' testId='row-edited'>
            {edited}
          </Row>
        )}
        <Row
          label='Attached to'
          title={attachedSlot ? undefined : item.attachedTo?.title}
          testId='row-attached'
          // The slot has controls (and a picker): it wraps, nothing clips.
          className={attachedSlot ? classes.withAction : undefined}
        >
          {attachedSlot ??
            (item.attachedTo ? (
              item.attachedTo.title
            ) : (
              <span className={classes.muted}>Not attached</span>
            ))}
        </Row>
        <Row label='File name' title={item.filename} testId='row-filename'>
          <FileName name={item.filename} />
        </Row>
        <Row label='Type' testId='row-type'>
          {item.mime}
        </Row>
        {item.filesize !== null && (
          <Row label='Size' testId='row-size'>
            {formatBytes(item.filesize)}
          </Row>
        )}
        {size && (
          <Row label='Dimensions' testId='row-dimensions'>
            {size}
          </Row>
        )}
        {timed && item.duration !== null && (
          <Row label='Duration' testId='row-duration'>
            {formatDuration(item.duration)}
          </Row>
        )}
        {encoding && (
          <Row label='Encoding' title={encoding} testId='row-encoding'>
            {encoding}
          </Row>
        )}
        {item.pages !== null && item.pages > 0 && (
          <Row label='Pages' testId='row-pages'>
            {item.pages.toLocaleString('en')}
          </Row>
        )}
        {original && (
          <>
            <dt>Original</dt>
            <dd className={classes.withAction} data-testid='row-original'>
              <span className={classes.value} title={original.filename}>
                {dimensions(original.width, original.height) ??
                  original.filename}
              </span>
              <CopyButton
                url={original.url}
                variant='text'
                label='Copy URL of the original image'
              >
                Copy URL
              </CopyButton>
            </dd>
          </>
        )}
      </dl>
      {original && <p className={classes.hint}>{SCALED_EXPLANATION}</p>}
      <div className={classes.copyField}>
        <TextInput
          ref={urlInput}
          readOnly
          value={item.url}
          aria-label='File URL'
          className={classes.copyFieldRoot}
          classNames={{ input: classes.copyInput }}
          onFocus={(event) => event.currentTarget.select()}
        />
        <CopyButton
          url={item.url}
          variant='field'
          label='Copy file URL'
          inputRef={urlInput}
        />
      </div>
    </Section>
  )
}

function CameraSection({ item }: { item: LibraryItemFull }) {
  const exif = item.exif
  if (!exif) {
    return null
  }
  const exposure = exposureLine(exif)
  const taken = exif.takenAt ? formatDate(exif.takenAt) : ''
  return (
    <Section id='camera' title='Camera'>
      <dl className={classes.meta}>
        {exif.camera && (
          <Row label='Camera' title={exif.camera} testId='row-camera'>
            {exif.camera}
          </Row>
        )}
        {exif.lens && (
          <Row label='Lens' title={exif.lens} testId='row-lens'>
            {exif.lens}
          </Row>
        )}
        {exposure && (
          <Row label='Exposure' testId='row-exposure'>
            {exposure}
          </Row>
        )}
        {taken && (
          <Row label='Taken' testId='row-taken'>
            {taken}
          </Row>
        )}
      </dl>
    </Section>
  )
}

function SizesSection({ item }: { item: LibraryItemFull }) {
  const scaled = item.original !== null
  return (
    <Section id='sizes' title='Sizes' count={item.sizes.length}>
      <ul className={classes.sizeList}>
        {item.sizes.map((size) => {
          const label = sizeLabel(size.name, scaled)
          return (
            <li
              key={size.name}
              className={classes.sizeRow}
              data-size={size.name}
            >
              <span className={classes.sizeName}>{label}</span>
              <span className={classes.sizeDims}>
                {dimensions(size.width, size.height) ?? '—'}
              </span>
              <CopyButton
                url={size.url}
                variant='icon'
                label={`Copy URL of ${label}${size.name === 'full' ? '' : ' size'}`}
              />
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
