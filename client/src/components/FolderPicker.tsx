import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tree,
  type TreeNodeData,
  UnstyledButton,
  useTree,
} from '@mantine/core'
import { type KeyboardEvent, useCallback, useEffect, useState } from 'react'
import {
  createFolder,
  type FolderNode,
  fetchFolders,
  type SelectedFolder,
} from '../lib/folderClient'
import type { UploadClientError } from '../lib/uploadClient'
import { FolderIcon } from './FolderIcon'

// FileBird's parent id for top-level folders.
const ROOT_ID = 0
// Placeholder tree node rendered as the inline "new folder" input.
const NEW_FOLDER_VALUE = 'new-folder'

interface FolderPickerProps {
  value: SelectedFolder | null
  onChange: (folder: SelectedFolder | null) => void
}

// Maps each folder id to its full "Parent / Child" path, used both as the
// label shown on queued files and to check a selection still exists.
function buildPaths(
  folders: FolderNode[],
  prefix = '',
  acc = new Map<number, string>(),
): Map<number, string> {
  for (const folder of folders) {
    const path = prefix ? `${prefix} / ${folder.name}` : folder.name
    acc.set(folder.id, path)
    buildPaths(folder.children, path, acc)
  }
  return acc
}

function toTreeData(
  folders: FolderNode[],
  creatingUnder: number | null,
): TreeNodeData[] {
  return folders.map((folder) => ({
    value: String(folder.id),
    label: folder.name,
    children: [
      ...(creatingUnder === folder.id
        ? [{ value: NEW_FOLDER_VALUE, label: '' }]
        : []),
      ...toTreeData(folder.children, creatingUnder),
    ],
  }))
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2.5}
      aria-hidden='true'
      style={{
        transform: expanded ? 'rotate(90deg)' : undefined,
        transition: 'transform 120ms ease',
      }}
    >
      <path d='m9 18 6-6-6-6' />
    </svg>
  )
}

export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const tree = useTree()
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // null = not creating; ROOT_ID = new top-level folder; else the parent id.
  const [creatingUnder, setCreatingUnder] = useState<number | null>(null)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const paths = buildPaths(folders)

  const load = useCallback(async (): Promise<FolderNode[] | null> => {
    setLoading(true)
    try {
      const result = await fetchFolders()
      setFolders(result)
      setLoadError(null)
      return result
    } catch (err) {
      setLoadError((err as UploadClientError).message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refresh = async () => {
    const result = await load()
    // Drop a selection whose folder was deleted in wp-admin meanwhile, so
    // new uploads don't keep targeting it.
    if (result && value && !buildPaths(result).has(value.id)) onChange(null)
  }

  const startCreating = (parentId: number) => {
    if (parentId !== ROOT_ID) tree.expand(String(parentId))
    setCreatingUnder(parentId)
    setNewName('')
    setCreateError(null)
  }

  const cancelCreating = () => {
    setCreatingUnder(null)
    setCreateError(null)
  }

  const submitNewFolder = async () => {
    const name = newName.trim()
    if (!name || creatingUnder === null) return

    setSaving(true)
    setCreateError(null)
    try {
      const { id } = await createFolder(name, creatingUnder)
      const result = await load()
      const parentPath = paths.get(creatingUnder)
      onChange({
        id,
        name:
          (result && buildPaths(result).get(id)) ??
          (parentPath ? `${parentPath} / ${name}` : name),
      })
      setCreatingUnder(null)
    } catch (err) {
      setCreateError((err as UploadClientError).message)
    } finally {
      setSaving(false)
    }
  }

  const newFolderInput = (
    <Stack gap={2} py={2} style={{ flex: 1 }}>
      <Group gap={6} wrap='nowrap'>
        <TextInput
          size='xs'
          placeholder='New folder name'
          value={newName}
          autoFocus
          disabled={saving}
          onChange={(event) => setNewName(event.currentTarget.value)}
          onClick={(event) => event.stopPropagation()}
          // Keys typed here must not reach the Tree's own keyboard handling
          // (Space toggles a node, arrows move focus between nodes).
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            event.stopPropagation()
            if (event.key === 'Enter') submitNewFolder()
            if (event.key === 'Escape') cancelCreating()
          }}
          style={{ flex: 1 }}
          aria-label='New folder name'
        />
        <Button
          size='xs'
          variant='light'
          loading={saving}
          disabled={!newName.trim()}
          onClick={submitNewFolder}
        >
          Create
        </Button>
        <Button
          size='xs'
          variant='subtle'
          color='gray'
          disabled={saving}
          onClick={cancelCreating}
        >
          Cancel
        </Button>
      </Group>
      {createError && (
        <Text size='xs' c='red'>
          {createError}
        </Text>
      )}
    </Stack>
  )

  return (
    <Paper withBorder p='sm' radius='md' className='cyber-card'>
      <Stack gap='xs'>
        <Group justify='space-between' wrap='nowrap' gap='xs'>
          <Group gap={6} wrap='nowrap' miw={0}>
            <Text size='sm' fw={600} c='dimmed' style={{ flexShrink: 0 }}>
              Upload to:
            </Text>
            <Group
              gap={4}
              wrap='nowrap'
              miw={0}
              c={value ? 'neon.3' : 'dimmed'}
            >
              {value && <FolderIcon />}
              <Text size='sm' c={value ? 'neon.3' : 'dimmed'} truncate>
                {value ? value.name : 'No folder (Uncategorized)'}
              </Text>
            </Group>
          </Group>
          <Group gap={4} wrap='nowrap'>
            {value && (
              <Button
                size='compact-xs'
                variant='subtle'
                color='gray'
                onClick={() => onChange(null)}
              >
                Clear
              </Button>
            )}
            <Button
              size='compact-xs'
              variant='light'
              onClick={() => startCreating(ROOT_ID)}
              disabled={loading || !!loadError}
            >
              New folder
            </Button>
            <Button
              size='compact-xs'
              variant='subtle'
              onClick={refresh}
              loading={loading}
            >
              Refresh
            </Button>
          </Group>
        </Group>

        {loadError ? (
          <Alert color='red' variant='light' className='cyber-alert' p='xs'>
            <Text size='sm'>Could not load FileBird folders: {loadError}</Text>
          </Alert>
        ) : loading && folders.length === 0 ? (
          <Group justify='center' py='xs'>
            <Loader size='sm' />
          </Group>
        ) : (
          <ScrollArea.Autosize mah={260} type='auto' offsetScrollbars>
            <UnstyledButton
              className='cyber-folder-row'
              data-selected={value === null || undefined}
              onClick={() => onChange(null)}
              w='100%'
            >
              <Text size='sm' c='dimmed' fs='italic'>
                No folder (Uncategorized)
              </Text>
            </UnstyledButton>

            {creatingUnder === ROOT_ID && <Box pl={4}>{newFolderInput}</Box>}

            {folders.length === 0 && creatingUnder !== ROOT_ID && (
              <Text size='xs' c='dimmed' py={4} pl={8}>
                No folders yet - create one with “New folder”.
              </Text>
            )}

            <Tree
              data={toTreeData(folders, creatingUnder)}
              tree={tree}
              levelOffset='md'
              expandOnClick={false}
              renderNode={({ node, expanded, elementProps }) => {
                if (node.value === NEW_FOLDER_VALUE) {
                  return (
                    <Group {...elementProps} gap={0} wrap='nowrap' pl={22}>
                      {newFolderInput}
                    </Group>
                  )
                }

                const id = Number(node.value)
                // The inline "new folder" placeholder doesn't count as a
                // subfolder worth an expand toggle.
                const showChevron =
                  node.children?.some(
                    (child) => child.value !== NEW_FOLDER_VALUE,
                  ) ?? false

                return (
                  <Group {...elementProps} gap={2} wrap='nowrap'>
                    {showChevron ? (
                      <ActionIcon
                        size='sm'
                        variant='subtle'
                        color='gray'
                        aria-label={expanded ? 'Collapse' : 'Expand'}
                        onClick={() => tree.toggleExpanded(node.value)}
                      >
                        <Chevron expanded={expanded} />
                      </ActionIcon>
                    ) : (
                      <Box w={22} style={{ flexShrink: 0 }} />
                    )}
                    <UnstyledButton
                      className='cyber-folder-row'
                      data-selected={value?.id === id || undefined}
                      onClick={() =>
                        onChange({
                          id,
                          name: paths.get(id) ?? String(node.label),
                        })
                      }
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <Group gap={6} wrap='nowrap'>
                        <FolderIcon open={expanded && showChevron} />
                        <Text size='sm' truncate>
                          {node.label}
                        </Text>
                      </Group>
                    </UnstyledButton>
                    <ActionIcon
                      size='sm'
                      variant='subtle'
                      aria-label={`New folder inside ${node.label}`}
                      title='New folder inside'
                      onClick={() => startCreating(id)}
                    >
                      +
                    </ActionIcon>
                  </Group>
                )
              }}
            />
          </ScrollArea.Autosize>
        )}
      </Stack>
    </Paper>
  )
}
