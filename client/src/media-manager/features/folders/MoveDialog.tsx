// "Move to…" (folders.md §7): the keyboard and touch alternative to drag and
// drop. A dialog with a combobox over a listbox of folders moves the selected
// media (M, the `folders.move-to` command) or a folder (its context menu, M
// on a tree row). The column renders <MoveDialogHost/> once; it shows the
// dialog while `folderUiStore.move` is set. Lazy chunk.
//
// The list itself is built by moveOptions.ts (pure, unit-tested); this file
// renders it, keeps the active option and runs the move through actions.tsx,
// so the toast, Undo and focus-follow behave as for drag and drop.
//
// Focus: the search field takes focus on open. Closing unmounts the Modal at
// once, so Mantine's own returnFocus never runs (spike C4); like confirm(),
// the dialog puts focus back on the element focused before it opened, once
// nothing else has taken it (moveItemsTo moves it to the next tile when the
// moved items leave the folder being viewed: the M → Enter → M triage flow).

import { Button, Kbd, Modal, TextInput } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import { useStore } from 'zustand'
import type { FolderTree } from '../../../../../shared/library-api'
import { useFolderTree } from '../../core/data/folderTree'
import { cachedItem } from '../../core/data/items'
import {
  FolderIcon,
  FolderPlusIcon,
  FoldersIcon,
  SearchIcon,
} from '../../core/ui/icons'
import { createTopLevelFolder, moveFolderInto, moveItemsTo } from './actions'
import classes from './MoveDialog.module.css'
import { highlightParts, indexFolders } from './model'
import {
  buildMoveOptions,
  describeFolderMove,
  describeItemsMove,
  isChoosable,
  keepActive,
  type MoveDescription,
  type MoveItemInfo,
  type MoveOption,
  ROOT_LABELS,
  stepActive,
} from './moveOptions'
import { folderUiStore, type MoveRequest, requestRowFocus } from './store'

// ---- Focus return -----------------------------------------------------------------

/** The focused element, or null when nothing (or the page body) is. */
function focusedElement(): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) {
    return null
  }
  return active
}

/**
 * After the dialog has unmounted (the next frame), focus goes back to the
 * opener unless something else took it meanwhile. `fallback` runs when the
 * opener is gone (e.g. a menu item).
 */
function returnFocusLater(
  opener: HTMLElement | null,
  fallback?: () => void,
): void {
  requestAnimationFrame(() => {
    if (focusedElement() !== null) {
      return
    }
    if (opener?.isConnected) {
      opener.focus()
    } else {
      fallback?.()
    }
  })
}

// ---- The move ---------------------------------------------------------------------

function closeDialog(): void {
  folderUiStore.setState({ move: null })
}

/**
 * Runs the chosen move after the dialog closed. "Create folder" makes a
 * top-level folder first and moves into it.
 */
async function runMove(
  request: MoveRequest,
  option: MoveOption,
  opener: HTMLElement | null,
): Promise<void> {
  // A folder move ends on the folder's row if the opener has gone.
  const fallback =
    request.kind === 'folder'
      ? () => requestRowFocus(request.folderId)
      : undefined
  let target = option.target
  if (option.kind === 'create') {
    returnFocusLater(opener, fallback)
    target = await createTopLevelFolder(option.label)
  }
  if (target === null) {
    return
  }
  // The move's own focus-follow (scheduled synchronously inside it) runs
  // first; the return only acts if focus is still nowhere after it.
  const moving =
    request.kind === 'items'
      ? moveItemsTo(request.ids, target, { moveKeyboardFocus: true })
      : moveFolderInto(request.folderId, target)
  returnFocusLater(opener, fallback)
  await moving
}

// ---- Host -------------------------------------------------------------------------

const requestKeys = new WeakMap<MoveRequest, number>()
let nextRequestKey = 1

/** A fresh dialog (state, opener) for every new request. */
function requestKey(request: MoveRequest): number {
  let key = requestKeys.get(request)
  if (key === undefined) {
    key = nextRequestKey++
    requestKeys.set(request, key)
  }
  return key
}

/** Shows the Move to… dialog while a move is requested. Render once. */
export function MoveDialogHost() {
  const request = useStore(folderUiStore, (state) => state.move)
  const { data: tree } = useFolderTree()
  if (!request || !tree) {
    return null
  }
  return <MoveDialog key={requestKey(request)} request={request} tree={tree} />
}

// ---- Dialog -----------------------------------------------------------------------

function useDescription(
  request: MoveRequest,
  index: ReturnType<typeof indexFolders>,
): MoveDescription {
  const queryClient = useQueryClient()
  return useMemo(() => {
    if (request.kind === 'folder') {
      return describeFolderMove(index, request.folderId)
    }
    const items = request.ids.map((id): MoveItemInfo | null => {
      const item = cachedItem(queryClient, id)
      return item
        ? { title: item.title, filename: item.filename, folder: item.folder }
        : null
    })
    return describeItemsMove(index, request.ids, items)
  }, [request, index, queryClient])
}

function MoveDialog({
  request,
  tree,
}: {
  request: MoveRequest
  tree: FolderTree
}) {
  // What had focus before the dialog took it: read on the first render,
  // before the Modal mounts and its focus trap moves focus.
  const [opener] = useState(focusedElement)
  const [query, setQuery] = useState('')
  const [chosenKey, setChosenKey] = useState<string | null>(null)
  const recent = useStore(folderUiStore, (state) => state.recent)
  const sort = useStore(folderUiStore, (state) => state.sort)
  const index = useMemo(() => indexFolders(tree.folders), [tree.folders])
  const description = useDescription(request, index)
  const pro = tree.mode.pro
  const options = useMemo(
    () =>
      buildMoveOptions({
        index,
        subject: description.subject,
        recent,
        sort,
        pro,
        query,
      }),
    [index, description.subject, recent, sort, pro, query],
  )
  const activeKey = keepActive(options, chosenKey)
  const active = options.find((option) => option.key === activeKey)

  const baseId = useId()
  const listId = `${baseId}-list`
  const subtitleId = `${baseId}-subtitle`
  const optionId = (key: string) => `${baseId}-option-${key}`

  // Keep the active option in view as ↑/↓ walk the list.
  useLayoutEffect(() => {
    if (activeKey !== null) {
      document
        .getElementById(`${baseId}-option-${activeKey}`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeKey, baseId])

  const cancel = () => {
    closeDialog()
    returnFocusLater(opener, () => {
      if (request.kind === 'folder') {
        requestRowFocus(request.folderId)
      }
    })
  }

  const commit = (option: MoveOption | undefined) => {
    if (!option || !isChoosable(option)) {
      return
    }
    closeDialog()
    void runMove(request, option, opener)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setChosenKey(
        stepActive(options, activeKey, event.key === 'ArrowDown' ? 1 : -1),
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit(active)
    }
  }

  const expanded = options.length > 0

  return (
    <Modal.Root opened onClose={cancel} centered size={480} returnFocus={false}>
      <Modal.Overlay />
      <Modal.Content
        ref={(node: HTMLElement | null) => {
          // Mantine describes the dialog by its whole body (every folder);
          // the subtitle alone is what a screen reader should read.
          node?.setAttribute('aria-describedby', subtitleId)
        }}
        className={classes.content}
        data-mm-move-dialog=''
      >
        <Modal.Header className={classes.header}>
          <Modal.Title className={classes.title}>
            {description.title}
          </Modal.Title>
          <Modal.CloseButton aria-label='Close' />
        </Modal.Header>
        <div className={classes.body}>
          <p id={subtitleId} className={classes.subtitle}>
            {description.subtitle}
          </p>
          <TextInput
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setChosenKey(null)
            }}
            onKeyDown={onKeyDown}
            placeholder='Find or create a folder'
            aria-label='Find or create a folder'
            leftSection={<SearchIcon size={16} aria-hidden />}
            role='combobox'
            aria-autocomplete='list'
            aria-expanded={expanded}
            aria-controls={expanded ? listId : undefined}
            aria-activedescendant={
              activeKey !== null ? optionId(activeKey) : undefined
            }
            autoComplete='off'
            spellCheck={false}
            data-autofocus
          />
          {expanded ? (
            <div
              id={listId}
              role='listbox'
              aria-label='Folders'
              className={classes.list}
            >
              {groupOptions(options).map((segment) => {
                const rendered = segment.options.map((option) => (
                  <OptionRow
                    key={option.key}
                    id={optionId(option.key)}
                    option={option}
                    query={query}
                    isActive={option.key === activeKey}
                    onChoose={() => setChosenKey(option.key)}
                    onCommit={() => commit(option)}
                  />
                ))
                if (segment.group === null) {
                  return rendered
                }
                const headingId = `${baseId}-group-${segment.group.replace(/\s+/g, '-')}`
                return (
                  // biome-ignore lint/a11y/useSemanticElements: an ARIA group of options inside a listbox, not a form fieldset
                  <div
                    key={`group-${segment.group}`}
                    role='group'
                    aria-labelledby={headingId}
                  >
                    <div id={headingId} className={classes.group}>
                      {segment.group}
                    </div>
                    {rendered}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className={classes.empty}>No folders match.</p>
          )}
          <div className={classes.actions}>
            <span className={classes.hint}>
              <Kbd size='xs'>↑</Kbd>
              <Kbd size='xs'>↓</Kbd> choose · <Kbd size='xs'>Enter</Kbd> move
            </span>
            <Button variant='default' onClick={cancel}>
              Cancel
            </Button>
            <Button
              disabled={active === undefined}
              onClick={() => commit(active)}
            >
              {description.confirmLabel}
            </Button>
          </div>
        </div>
      </Modal.Content>
    </Modal.Root>
  )
}

/** Consecutive options of the same group, for the group headings. */
function groupOptions(
  options: readonly MoveOption[],
): { group: MoveOption['group']; options: MoveOption[] }[] {
  const segments: { group: MoveOption['group']; options: MoveOption[] }[] = []
  for (const option of options) {
    const last = segments[segments.length - 1]
    if (last && last.group === option.group) {
      last.options.push(option)
    } else {
      segments.push({ group: option.group, options: [option] })
    }
  }
  return segments
}

// ---- Option -----------------------------------------------------------------------

function OptionIcon({ option }: { option: MoveOption }) {
  if (option.kind === 'create') {
    return <FolderPlusIcon size={16} stroke={1.75} aria-hidden />
  }
  if (option.kind === 'root') {
    return option.label === ROOT_LABELS.folder ? (
      <FoldersIcon size={16} stroke={1.75} aria-hidden />
    ) : (
      <FolderIcon
        size={16}
        stroke={1.75}
        aria-hidden
        className={classes.muted}
      />
    )
  }
  return (
    <FolderIcon
      size={16}
      stroke={1.75}
      aria-hidden
      className={option.color ? classes.colored : undefined}
      style={
        option.color
          ? ({ '--folder-color': option.color } as CSSProperties)
          : undefined
      }
    />
  )
}

/** The name with the search match marked. */
function highlighted(name: string, query: string): ReactNode {
  const parts = highlightParts(name, query)
  if (!parts) {
    return name
  }
  return (
    <>
      {parts.before}
      <mark className={classes.match}>{parts.match}</mark>
      {parts.after}
    </>
  )
}

function OptionRow({
  id,
  option,
  query,
  isActive,
  onChoose,
  onCommit,
}: {
  id: string
  option: MoveOption
  query: string
  isActive: boolean
  onChoose: () => void
  onCommit: () => void
}) {
  const choosable = isChoosable(option)
  return (
    // Keyboard use goes through the combobox (aria-activedescendant); the
    // option only handles the pointer.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox handles keys
    // biome-ignore lint/a11y/useFocusableInteractive: options of a combobox's listbox stay unfocusable; the field keeps focus (aria-activedescendant)
    <div
      id={id}
      role='option'
      aria-selected={isActive}
      aria-disabled={choosable ? undefined : true}
      className={classes.option}
      data-kind={option.kind}
      style={{ '--depth': option.depth } as CSSProperties}
      // Keep focus (and the caret) in the search field.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (choosable) {
          onChoose()
        }
      }}
      onDoubleClick={() => {
        if (choosable) {
          onCommit()
        }
      }}
    >
      <OptionIcon option={option} />
      {option.kind === 'create' ? (
        <span className={classes.name}>
          Create folder “<strong>{option.label}</strong>”
        </span>
      ) : (
        <span className={classes.name}>
          {query === '' ? option.label : highlighted(option.label, query)}
        </span>
      )}
      {option.path !== '' && (
        <span className={classes.path}>{option.path}</span>
      )}
      {option.current && <span className={classes.tag}>Current</span>}
    </div>
  )
}
