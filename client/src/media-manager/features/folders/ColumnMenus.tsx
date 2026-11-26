// The column's menus (folders.md §2, §4–§7, §9):
//
// - FolderContextMenu: right-click or the ContextMenu key on a row (and the
//   `folders.context-menu` command for the folder you're viewing): New
//   subfolder, Rename, Move to…, Colour… (Pro), Delete folder. On All files
//   and Uncategorized it offers only New folder.
// - ColorPicker: FileBird Pro's colours, nine swatches plus No colour; the
//   arrow keys walk the swatches.
// - OptionsMenu (⋯): Expand all, Collapse all, the count mode and, with Pro,
//   the folder sort.
//
// Menus return focus to the row (or button) they were opened from when
// they close with Esc or a click outside; an item that moves focus itself
// (rename's input, a dialog) keeps it.

import { ActionIcon, Kbd, Menu, Popover, Tooltip } from '@mantine/core'
import {
  type CSSProperties,
  type KeyboardEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useStore } from 'zustand'
import type { FolderRef } from '../../../../../shared/library-api'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ColorIcon,
  ColorNoneIcon,
  DeleteIcon,
  EditIcon,
  FolderPlusIcon,
  MoreIcon,
  MoveIcon,
} from '../../core/ui/icons'
import * as actions from './actions'
import classes from './Column.module.css'
import type { CountMode, FolderIndex, FolderSort } from './model'
import {
  folderUiStore,
  type RowRef,
  requestRowFocus,
  setCountMode,
  setFolderSort,
} from './store'
import { treeApi } from './treeApi'

/** FileBird Pro's palette (the prototype's nine colours). */
export const FOLDER_COLORS: readonly (readonly [string, string])[] = [
  ['Grey', '#8f8f8f'],
  ['Red', '#ff4d5e'],
  ['Orange', '#ff7a59'],
  ['Yellow', '#ffc82c'],
  ['Green', '#13ce66'],
  ['Teal', '#14b8a6'],
  ['Blue', '#1fb6ff'],
  ['Purple', '#7c5cff'],
  ['Pink', '#ff49db'],
]

type Point = { x: number; y: number }

/**
 * Where a menu for `row` opens: the pointer, or just under the row (after
 * revealing it, since a virtualised row may not be rendered).
 */
function useMenuPoint(row: RowRef | null, anchor: Point | 'row' | null) {
  const [point, setPoint] = useState<Point | null>(null)
  useLayoutEffect(() => {
    if (row === null || anchor === null) {
      setPoint(null)
      return
    }
    if (anchor !== 'row') {
      setPoint(anchor)
      return
    }
    const measure = () => {
      const element = treeApi()?.rowElement(row)
      if (!element) return false
      const rect = element.getBoundingClientRect()
      setPoint({ x: rect.left + 24, y: rect.bottom + 2 })
      return true
    }
    if (measure()) return
    treeApi()?.revealRow(row)
    const frame = requestAnimationFrame(() => {
      if (!measure()) {
        setPoint({ x: 24, y: 120 })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [row, anchor])
  return point
}

/** An invisible fixed box at `point`: what the menu positions against. */
function PointTarget({ point }: { point: Point }) {
  return (
    <div
      className={classes.menuPoint}
      style={{ left: point.x, top: point.y } as CSSProperties}
    />
  )
}

function isRealFolderRef(index: FolderIndex, row: FolderRef): row is number {
  return typeof row === 'number' && row !== 0 && index.byId.has(row)
}

export function FolderContextMenu({
  index,
  pro,
  colorsWritable,
}: {
  index: FolderIndex
  pro: boolean
  colorsWritable: boolean
}) {
  const menu = useStore(folderUiStore, (state) => state.menu)
  const point = useMenuPoint(menu?.row ?? null, menu?.anchor ?? null)
  // An item that moves focus itself (rename, a dialog) keeps it.
  const keepFocus = useRef(false)
  // Mantine's initial-focus placeholder is a focusable element inside
  // role=menu, which axe refuses (aria-required-children); without it, focus
  // goes to the first item here, and Mantine's arrow keys take it from there.
  useLayoutEffect(() => {
    if (!point) return
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-mm-folder-menu] [data-menu-item]')
        ?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [point])
  if (!menu || !point) {
    return null
  }
  const row = menu.row
  const real = isRealFolderRef(index, row)
  const name = real ? (index.byId.get(row)?.name ?? '') : 'Folders'

  const close = () => {
    folderUiStore.setState({ menu: null })
    if (!keepFocus.current) {
      requestRowFocus(row)
    }
    keepFocus.current = false
  }
  const run = (action: () => void) => () => {
    keepFocus.current = true
    folderUiStore.setState({ menu: null })
    action()
  }

  return (
    <Menu
      opened
      onClose={close}
      position='bottom-start'
      offset={0}
      withinPortal
      shadow='md'
      returnFocus={false}
      withInitialFocusPlaceholder={false}
    >
      <Menu.Target>
        <PointTarget point={point} />
      </Menu.Target>
      <Menu.Dropdown
        aria-label={real ? `Folder ${name}` : 'Folders'}
        data-mm-folder-menu=''
      >
        <Menu.Label>{name}</Menu.Label>
        {real ? (
          <>
            <Menu.Item
              leftSection={<FolderPlusIcon size={16} aria-hidden />}
              rightSection={<Kbd size='xs'>N</Kbd>}
              onClick={run(() => actions.startCreate(row))}
            >
              New subfolder
            </Menu.Item>
            <Menu.Item
              leftSection={<EditIcon size={16} aria-hidden />}
              rightSection={<Kbd size='xs'>R</Kbd>}
              onClick={run(() => actions.startRename(row))}
            >
              Rename
            </Menu.Item>
            <Menu.Item
              leftSection={<MoveIcon size={16} aria-hidden />}
              rightSection={<Kbd size='xs'>M</Kbd>}
              onClick={run(() => actions.moveFolderWithDialog(row))}
            >
              Move to…
            </Menu.Item>
            {pro && colorsWritable && (
              <Menu.Item
                leftSection={
                  <ColorIcon
                    size={16}
                    aria-hidden
                    style={{
                      color: index.byId.get(row)?.color ?? undefined,
                    }}
                  />
                }
                onClick={run(() =>
                  folderUiStore.setState({ colorPicker: row }),
                )}
              >
                Colour…
              </Menu.Item>
            )}
            <Menu.Divider />
            <Menu.Item
              className={classes.dangerItem}
              leftSection={<DeleteIcon size={16} aria-hidden />}
              rightSection={<Kbd size='xs'>Del</Kbd>}
              onClick={run(() => void actions.confirmDeleteFolder(row))}
            >
              Delete folder
            </Menu.Item>
          </>
        ) : (
          <Menu.Item
            leftSection={<FolderPlusIcon size={16} aria-hidden />}
            rightSection={<Kbd size='xs'>N</Kbd>}
            onClick={run(() => actions.startCreate(0))}
          >
            New folder
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}

export function ColorPicker({ index }: { index: FolderIndex }) {
  const folderId = useStore(folderUiStore, (state) => state.colorPicker)
  const point = useMenuPoint(folderId, folderId === null ? null : 'row')
  const listRef = useRef<HTMLDivElement>(null)
  const folder = folderId === null ? undefined : index.byId.get(folderId)

  useLayoutEffect(() => {
    if (!point) return
    const frame = requestAnimationFrame(() => {
      const list = listRef.current
      const checked =
        list?.querySelector<HTMLElement>('[aria-checked="true"]') ??
        list?.querySelector<HTMLElement>('button')
      checked?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [point])

  if (folderId === null || !folder || !point) {
    return null
  }
  const close = (refocus: boolean) => {
    folderUiStore.setState({ colorPicker: null })
    if (refocus) {
      requestRowFocus(folderId)
    }
  }
  const choose = (color: string | null) => {
    close(true)
    void actions.setFolderColor(folderId, color)
  }
  // ←/→ (and ↑/↓) walk the swatches like a menu.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    }
    const step = steps[event.key]
    if (step === undefined) return
    event.preventDefault()
    const buttons = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('button') ?? []),
    ]
    const at = buttons.indexOf(document.activeElement as HTMLElement)
    buttons[(at + step + buttons.length) % buttons.length]?.focus()
  }

  return (
    <Popover
      opened
      onClose={() => close(true)}
      position='bottom-start'
      withinPortal
      shadow='md'
      returnFocus={false}
      trapFocus
    >
      <Popover.Target>
        <PointTarget point={point} />
      </Popover.Target>
      <Popover.Dropdown p='xs'>
        <div
          ref={listRef}
          role='menu'
          aria-label={`Colour of “${folder.name}”`}
          className={classes.colorMenu}
          onKeyDown={onKeyDown}
        >
          <div className={classes.colorTitle} aria-hidden>
            Colour of “{folder.name}”
          </div>
          <button
            type='button'
            role='menuitemradio'
            aria-checked={folder.color === null}
            className={classes.colorNone}
            onClick={() => choose(null)}
          >
            <ColorNoneIcon size={16} aria-hidden />
            No colour
          </button>
          <div className={classes.swatches}>
            {FOLDER_COLORS.map(([label, value]) => (
              <Tooltip key={value} label={label} openDelay={300} withinPortal>
                <button
                  type='button'
                  role='menuitemradio'
                  aria-checked={folder.color === value}
                  aria-label={label}
                  className={classes.swatch}
                  style={{ '--folder-color': value } as CSSProperties}
                  onClick={() => choose(value)}
                >
                  {folder.color === value && (
                    <CheckIcon size={14} stroke={2.5} aria-hidden />
                  )}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      </Popover.Dropdown>
    </Popover>
  )
}

function asRadioItem(element: HTMLElement | null): void {
  element?.setAttribute('role', 'menuitemradio')
}

function Radio({ on }: { on: boolean }) {
  return on ? (
    <CheckIcon size={16} aria-hidden />
  ) : (
    <span className={classes.radioSpacer} aria-hidden />
  )
}

export function OptionsMenu({ pro }: { pro: boolean }) {
  const countMode = useStore(folderUiStore, (state) => state.countMode)
  const sort = useStore(folderUiStore, (state) => state.sort)
  const radio = (on: boolean) => ({
    // Mantine's Menu.Item always renders role="menuitem"; these are radio
    // items (folders.md §12 request 3), so the role is corrected on the DOM
    // node. Mantine's arrow keys find items by [data-menu-item], not role.
    ref: asRadioItem,
    'aria-checked': on,
    leftSection: <Radio on={on} />,
  })
  const counts: [CountMode, string][] = [
    ['direct', 'Count files in the folder only'],
    ['nested', 'Count files in subfolders too'],
  ]
  const sorts: [FolderSort, string][] = [
    ['manual', 'Sort folders: manual order'],
    ['name-asc', 'Sort folders: name A–Z'],
    ['name-desc', 'Sort folders: name Z–A'],
  ]
  return (
    <Menu
      position='bottom-end'
      withinPortal
      shadow='md'
      withInitialFocusPlaceholder={false}
    >
      <Menu.Target>
        <Tooltip label='Folder options' openDelay={400} withinPortal>
          <ActionIcon
            type='button'
            variant='subtle'
            color='gray'
            aria-label='Folder options'
            className={classes.headerButton}
          >
            <MoreIcon size={18} stroke={1.75} aria-hidden />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown aria-label='Folder options'>
        <Menu.Item
          leftSection={<ChevronDownIcon size={16} aria-hidden />}
          onClick={() => actions.expandAll()}
        >
          Expand all
        </Menu.Item>
        <Menu.Item
          leftSection={<ChevronUpIcon size={16} aria-hidden />}
          onClick={() => actions.collapseAll()}
        >
          Collapse all
        </Menu.Item>
        <Menu.Divider />
        {counts.map(([mode, label]) => (
          <Menu.Item
            key={mode}
            {...radio(countMode === mode)}
            onClick={() => setCountMode(mode)}
          >
            {label}
          </Menu.Item>
        ))}
        {pro && (
          <>
            <Menu.Divider />
            {sorts.map(([value, label]) => (
              <Menu.Item
                key={value}
                {...radio(sort === value)}
                onClick={() => setFolderSort(value)}
              >
                {label}
              </Menu.Item>
            ))}
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}
