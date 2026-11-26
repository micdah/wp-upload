// The folder column (folders.md §2, lazily loaded by index.tsx): the header
// (FOLDERS, New folder, options ⋯, Hide), the Find folder box, the per-user
// notice, and the tree with All files, Uncategorized, the Trash stub and the
// folders. It also hosts the column's menus, the Move to… dialog, and the
// drag sources on the grid's tiles.
//
// The shell owns the <aside> around it: the resizer, collapse, `inert` and
// the drawer below 900 px.

import { ActionIcon, Alert, Button, TextInput, Tooltip } from '@mantine/core'
import {
  type ChangeEvent,
  type KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { useStore } from 'zustand'
import { runCommand } from '../../core/commands/registry'
import { useFolderTree } from '../../core/data/folderTree'
import { useCore } from '../../core/state'
import { announce, plural } from '../../core/ui/announce'
import {
  AlertIcon,
  CloseIcon,
  FolderPlusIcon,
  FoldersCollapseIcon,
  SearchIcon,
} from '../../core/ui/icons'
import { noSelectProps } from '../../core/ui/noSelect'
import { useUrlState } from '../../core/url/useUrlState'
import * as actions from './actions'
import classes from './Column.module.css'
import { ColorPicker, FolderContextMenu, OptionsMenu } from './ColumnMenus'
import {
  buildEntries,
  entryRef,
  type TreeItemEntry,
  treeItems,
} from './entries'
import { ancestorsOf, indexFolders, nestedCounts, ROOT_ID } from './model'
import {
  expandFolders,
  folderUiStore,
  loadFolderPrefs,
  requestRowFocus,
} from './store'
import { Tree } from './Tree'
import { useTrashRowCount } from './trashRow'
import { treeApi } from './treeApi'

const LazyMoveDialog = lazy(() =>
  import('./MoveDialog').then((module) => ({
    default: module.MoveDialogHost,
  })),
)

const TREE_ID = 'mm-folder-tree'
const SEARCH_ANNOUNCE_MS = 300

export function Column() {
  const site = useCore((state) => state.bootstrap?.site ?? null)
  const userId = site?.user.id ?? null
  const fileBirdActive = Boolean(site?.filebird?.active)
  const trashOn = Boolean(site?.trash.enabled)
  useEffect(() => {
    if (userId !== null) {
      loadFolderPrefs(userId)
    }
  }, [userId])

  const treeQuery = useFolderTree({ enabled: fileBirdActive })
  const tree = treeQuery.data
  const pro = Boolean(tree?.mode.pro)
  const readOnly = Boolean(
    tree?.mode.readOnly || tree?.mode.perUser || site?.filebird?.perUser,
  )

  const expanded = useStore(folderUiStore, (state) => state.expanded)
  const sortPref = useStore(folderUiStore, (state) => state.sort)
  const countMode = useStore(folderUiStore, (state) => state.countMode)
  const search = useStore(folderUiStore, (state) => state.search)
  const editing = useStore(folderUiStore, (state) => state.editing)
  const pendingCreate = useStore(folderUiStore, (state) => state.pendingCreate)
  const moveOpen = useStore(folderUiStore, (state) => state.move !== null)
  const sort = pro ? sortPref : 'manual'

  const folders = tree?.folders
  const index = useMemo(() => indexFolders(folders ?? []), [folders])
  const nested = useMemo(
    () => (countMode === 'nested' ? nestedCounts(index) : null),
    [countMode, index],
  )
  const list = useMemo(
    () =>
      buildEntries({
        index,
        expanded,
        sort,
        search,
        editing,
        pendingCreate,
        trash: trashOn,
      }),
    [index, expanded, sort, search, editing, pendingCreate, trashOn],
  )
  const current = useUrlState((state) => state.folder)
  const trashCount = useTrashRowCount()

  const counts = tree?.counts
  const countOf = useCallback(
    (entry: TreeItemEntry): number | null => {
      switch (entry.kind) {
        case 'all':
          return counts?.all ?? null
        case 'uncategorized':
          return counts?.uncategorized ?? null
        case 'trash':
          return trashCount
        case 'folder':
          return nested?.get(entry.ref) ?? entry.row.folder.count
        default:
          return null
      }
    },
    [counts, nested, trashCount],
  )

  // The folder you're viewing is visible: its ancestors open when it
  // changes (a deep link, a palette jump) or once the tree has loaded.
  const revealed = useRef<string | null>(null)
  const pendingScroll = useRef<number | null>(null)
  useEffect(() => {
    if (typeof current !== 'number' || current === ROOT_ID) return
    if (!index.byId.has(current)) return
    const key = `${current}`
    if (revealed.current === key) return
    revealed.current = key
    expandFolders(ancestorsOf(index, current))
    pendingScroll.current = current
  }, [current, index])
  // The tree registers its API in its own effects, which run before this
  // one, so the new rows are there by now.
  useEffect(() => {
    const target = pendingScroll.current
    if (target === null || list.entries.length === 0) return
    if (treeApi()?.revealRow(target)) {
      pendingScroll.current = null
    }
  }, [list.entries])

  // The match count, spoken politely once typing pauses (folders.md §8).
  useEffect(() => {
    if (!list.searching) return
    const timer = setTimeout(() => {
      announce(
        list.matchCount === 0
          ? 'No folders match'
          : list.matchCount === 1
            ? '1 folder matches'
            : `${plural(list.matchCount, 'folder')} match`,
      )
    }, SEARCH_ANNOUNCE_MS)
    return () => clearTimeout(timer)
  }, [list.searching, list.matchCount])

  const items = treeItems(list.entries)
  const showNoFolders =
    list.noFolders && !list.searching && !editing && !pendingCreate
  const showNoMatch = list.searching && list.matchCount === 0

  return (
    <div className={classes.column} {...noSelectProps}>
      <div className={classes.header}>
        <span className={classes.title} id='mm-folders-title'>
          Folders
        </span>
        <Tooltip label='New folder (N)' openDelay={400} withinPortal>
          <ActionIcon
            type='button'
            variant='subtle'
            color='gray'
            aria-label='New folder'
            className={classes.headerButton}
            onClick={() => {
              const viewed = typeof current === 'number' ? current : ROOT_ID
              actions.startCreate(viewed)
            }}
          >
            <FolderPlusIcon size={18} stroke={1.75} aria-hidden />
          </ActionIcon>
        </Tooltip>
        <OptionsMenu pro={pro} />
        <Tooltip label='Hide folders (F)' openDelay={400} withinPortal>
          <ActionIcon
            type='button'
            variant='subtle'
            color='gray'
            aria-label='Hide folders'
            className={classes.headerButton}
            onClick={() => runCommand('panels.toggle-folders')}
          >
            <FoldersCollapseIcon size={18} stroke={1.75} aria-hidden />
          </ActionIcon>
        </Tooltip>
      </div>

      <SearchBox
        value={search}
        onOpenFirstMatch={() => {
          const match = items.find(
            (entry) => entry.kind === 'folder' && entry.match,
          )
          const ref = match ? entryRef(match) : null
          if (ref !== null) actions.openFolder(ref)
        }}
        onEnterTree={() => {
          const first = items[0]
          const ref = first ? entryRef(first) : null
          if (ref !== null) requestRowFocus(ref)
        }}
      />

      {readOnly && (
        <Alert
          classNames={{
            root: classes.notice,
            title: classes.noticeTitle,
            icon: classes.noticeIcon,
          }}
          variant='light'
          role='note'
          icon={<AlertIcon size={18} aria-hidden />}
          title='Per-user folders aren’t supported'
        >
          <p className={classes.noticeText}>
            FileBird gives each user their own folders, so you see only this
            account’s folders, read-only.
          </p>
          <p className={classes.noticeText}>
            Turn off “Each user has his own folders” in FileBird to organise
            media here.
          </p>
        </Alert>
      )}

      <div className={classes.body}>
        {treeQuery.status === 'pending' && <TreeSkeleton />}
        {treeQuery.status === 'error' && !tree && (
          <div className={classes.empty}>
            <span>Couldn’t load the folders.</span>
            <Button
              size='compact-sm'
              variant='default'
              onClick={() => void treeQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        )}
        {tree && (
          <Tree
            hidden={list.entries.length === 0}
            id={TREE_ID}
            entries={list.entries}
            index={index}
            current={current}
            countOf={countOf}
            search={search}
            readOnly={readOnly}
            manualOrder={sort === 'manual'}
            pro={pro}
            fill={!list.noFolders}
          />
        )}
        {tree && showNoFolders && (
          <div className={classes.empty}>
            <span>
              No folders yet. Folders help you group media; a file lives in one
              folder.
            </span>
            {!readOnly && (
              <Button
                size='compact-sm'
                variant='default'
                leftSection={<FolderPlusIcon size={16} aria-hidden />}
                onClick={() => actions.startCreate(ROOT_ID)}
              >
                New folder
              </Button>
            )}
          </div>
        )}
        {tree && showNoMatch && (
          <div className={classes.empty}>
            <span>No folders match “{search.trim()}”.</span>
            <Button
              size='compact-sm'
              variant='default'
              leftSection={<CloseIcon size={16} aria-hidden />}
              onClick={() => {
                folderUiStore.setState({ search: '' })
                document.getElementById('mm-folder-search')?.focus()
              }}
            >
              Clear search
            </Button>
          </div>
        )}
      </div>

      {tree && (
        <>
          <FolderContextMenu
            index={index}
            pro={pro}
            colorsWritable={Boolean(tree.mode.colorsWritable)}
          />
          {pro && <ColorPicker index={index} />}
        </>
      )}
      {moveOpen && (
        <Suspense fallback={null}>
          <LazyMoveDialog />
        </Suspense>
      )}
    </div>
  )
}

/** Find folder (folders.md §8): Esc clears, then leaves; ↓ enters the tree. */
function SearchBox({
  value,
  onOpenFirstMatch,
  onEnterTree,
}: {
  value: string
  onOpenFirstMatch(): void
  onEnterTree(): void
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value !== '') {
      // The first Esc clears; the app's keymap sees the second and leaves
      // the field.
      event.preventDefault()
      folderUiStore.setState({ search: '' })
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      onEnterTree()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onOpenFirstMatch()
    }
  }
  return (
    <div className={classes.search}>
      <TextInput
        id='mm-folder-search'
        size='xs'
        type='search'
        name='folder-search'
        placeholder='Find folder'
        aria-label='Find folder'
        aria-controls={TREE_ID}
        autoComplete='off'
        spellCheck={false}
        leftSection={<SearchIcon size={14} aria-hidden />}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          folderUiStore.setState({ search: event.currentTarget.value })
        }
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

/** Rows shaped like the tree while it loads (no spinners in content). */
function TreeSkeleton() {
  return (
    <div className={classes.skeleton} aria-busy='true'>
      <span className={classes.visuallyHidden}>Loading folders…</span>
      {[70, 55, 80, 60, 45, 65].map((width, position) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed placeholder list
          key={position}
          className={classes.skeletonRow}
          style={{ width: `${width}%` }}
          aria-hidden
        />
      ))}
    </div>
  )
}
