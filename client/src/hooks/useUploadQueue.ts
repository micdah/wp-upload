import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  checkDuplicate,
  type ExistingMedia,
  type UploadClientError,
  type UploadResult,
  uploadFile,
} from '../lib/uploadClient'

const CONCURRENCY_KEY = 'wp-upload.concurrency'
const DEFAULT_CONCURRENCY = 3

export type UploadStatus =
  | 'checking'
  | 'queued'
  | 'uploading'
  | 'finalizing'
  | 'duplicate'
  | 'success'
  | 'error'

export interface FileEntry {
  id: string
  file: File
  name: string
  size: number
  status: UploadStatus
  progress: number
  error: UploadClientError | null
  result: UploadResult | null
  previewUrl: string | null
  duplicateMatches: ExistingMedia[]
}

interface State {
  order: string[]
  files: Record<string, FileEntry>
  concurrency: number
}

type Action =
  | { type: 'ADD_FILES'; entries: FileEntry[] }
  | { type: 'SET_STATUS'; id: string; status: UploadStatus; progress?: number }
  | { type: 'SET_PROGRESS'; id: string; progress: number }
  | { type: 'SET_SUCCESS'; id: string; result: UploadResult }
  | { type: 'SET_ERROR'; id: string; error: UploadClientError }
  | { type: 'SET_DUPLICATE'; id: string; matches: ExistingMedia[] }
  | { type: 'RESET_TO_QUEUED'; ids: string[] }
  | { type: 'REMOVE'; id: string }
  | { type: 'CLEAR_COMPLETED' }
  | { type: 'SET_CONCURRENCY'; concurrency: number }

function readStoredConcurrency(): number {
  try {
    const stored = Number(localStorage.getItem(CONCURRENCY_KEY))
    return stored >= 1 && stored <= 6 ? stored : DEFAULT_CONCURRENCY
  } catch {
    return DEFAULT_CONCURRENCY
  }
}

function makeId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const initialState: State = {
  order: [],
  files: {},
  concurrency: readStoredConcurrency(),
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_FILES': {
      const files = { ...state.files }
      const order = [...state.order]
      for (const entry of action.entries) {
        files[entry.id] = entry
        order.push(entry.id)
      }
      return { ...state, files, order }
    }
    case 'SET_STATUS': {
      const current = state.files[action.id]
      if (!current) return state
      return {
        ...state,
        files: {
          ...state.files,
          [action.id]: {
            ...current,
            status: action.status,
            progress: action.progress ?? current.progress,
          },
        },
      }
    }
    case 'SET_PROGRESS': {
      const current = state.files[action.id]
      if (!current) return state
      return {
        ...state,
        files: {
          ...state.files,
          [action.id]: { ...current, progress: action.progress },
        },
      }
    }
    case 'SET_SUCCESS': {
      const current = state.files[action.id]
      if (!current) return state
      return {
        ...state,
        files: {
          ...state.files,
          [action.id]: {
            ...current,
            status: 'success',
            progress: 100,
            result: action.result,
            error: null,
          },
        },
      }
    }
    case 'SET_ERROR': {
      const current = state.files[action.id]
      if (!current) return state
      return {
        ...state,
        files: {
          ...state.files,
          [action.id]: { ...current, status: 'error', error: action.error },
        },
      }
    }
    case 'SET_DUPLICATE': {
      const current = state.files[action.id]
      if (!current) return state
      return {
        ...state,
        files: {
          ...state.files,
          [action.id]: {
            ...current,
            status: 'duplicate',
            duplicateMatches: action.matches,
          },
        },
      }
    }
    case 'RESET_TO_QUEUED': {
      const updates = action.ids.flatMap((id): [string, FileEntry][] => {
        const current = state.files[id]
        if (!current) return []
        return [
          [
            id,
            {
              ...current,
              status: 'queued',
              progress: 0,
              error: null,
              duplicateMatches: [],
            },
          ],
        ]
      })
      return {
        ...state,
        files: { ...state.files, ...Object.fromEntries(updates) },
      }
    }
    case 'REMOVE': {
      const files = { ...state.files }
      delete files[action.id]
      return {
        ...state,
        files,
        order: state.order.filter((id) => id !== action.id),
      }
    }
    case 'CLEAR_COMPLETED': {
      const files: Record<string, FileEntry> = {}
      const order: string[] = []
      for (const id of state.order) {
        const current = state.files[id]
        if (current && current.status !== 'success') {
          files[id] = current
          order.push(id)
        }
      }
      return { ...state, files, order }
    }
    case 'SET_CONCURRENCY':
      return { ...state, concurrency: action.concurrency }
    default:
      return state
  }
}

export function useUploadQueue() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const queueRef = useRef<string[]>([])
  const activeRef = useRef<Set<string>>(new Set())
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())
  const filesRef = useRef<Record<string, FileEntry>>(state.files)
  filesRef.current = state.files
  const concurrencyRef = useRef(state.concurrency)
  concurrencyRef.current = state.concurrency

  // biome-ignore lint/correctness/useExhaustiveDependencies: runUpload and pump recursively reference each other; both stay stable via refs, so adding pump here would just churn the callback identity without changing behavior.
  const runUpload = useCallback((id: string) => {
    const entry = filesRef.current[id]
    if (!entry) return

    activeRef.current.add(id)
    const controller = new AbortController()
    abortControllersRef.current.set(id, controller)
    dispatch({ type: 'SET_STATUS', id, status: 'uploading', progress: 0 })

    uploadFile(entry.file, {
      signal: controller.signal,
      onProgress: (percent) => {
        if (percent >= 100) {
          dispatch({
            type: 'SET_STATUS',
            id,
            status: 'finalizing',
            progress: 100,
          })
        } else {
          dispatch({ type: 'SET_PROGRESS', id, progress: percent })
        }
      },
    })
      .then((result) => dispatch({ type: 'SET_SUCCESS', id, result }))
      .catch((error: UploadClientError) =>
        dispatch({ type: 'SET_ERROR', id, error }),
      )
      .finally(() => {
        activeRef.current.delete(id)
        abortControllersRef.current.delete(id)
        pump()
      })
  }, [])

  const pump = useCallback(() => {
    while (
      activeRef.current.size < concurrencyRef.current &&
      queueRef.current.length > 0
    ) {
      const id = queueRef.current.shift()
      if (id) runUpload(id)
    }
  }, [runUpload])

  // Enters an item into the actual upload queue - shared by files that
  // passed the duplicate check and ones the user confirmed despite a match.
  const enqueue = useCallback(
    (id: string) => {
      queueRef.current.push(id)
      pump()
    },
    [pump],
  )

  const addFiles = useCallback(
    (fileList: File[]) => {
      const entries: FileEntry[] = Array.from(fileList).map((file) => ({
        id: makeId(),
        file,
        name: file.name,
        size: file.size,
        status: 'checking',
        progress: 0,
        error: null,
        result: null,
        previewUrl: file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : null,
        duplicateMatches: [],
      }))
      // Keep the ref in sync immediately: runUpload reads from it synchronously
      // below, before React has re-rendered and refreshed it from state.
      filesRef.current = {
        ...filesRef.current,
        ...Object.fromEntries(entries.map((e) => [e.id, e])),
      }
      dispatch({ type: 'ADD_FILES', entries })

      // Each file gets its own duplicate check so a slow WP response for one
      // doesn't hold up the others - only files that come back clear (or
      // whose check fails, see checkDuplicate) join the upload queue.
      for (const entry of entries) {
        checkDuplicate(entry.name).then((result) => {
          // The item may have been removed while the check was in flight.
          if (!filesRef.current[entry.id]) return

          if (result.duplicate) {
            dispatch({
              type: 'SET_DUPLICATE',
              id: entry.id,
              matches: result.matches,
            })
          } else {
            dispatch({ type: 'SET_STATUS', id: entry.id, status: 'queued' })
            enqueue(entry.id)
          }
        })
      }
    },
    [enqueue],
  )

  const confirmUpload = useCallback(
    (id: string) => {
      dispatch({ type: 'RESET_TO_QUEUED', ids: [id] })
      enqueue(id)
    },
    [enqueue],
  )

  const retry = useCallback(
    (id: string) => {
      dispatch({ type: 'RESET_TO_QUEUED', ids: [id] })
      enqueue(id)
    },
    [enqueue],
  )

  const retryAllFailed = useCallback(() => {
    const failedIds = state.order.filter(
      (id) => state.files[id]?.status === 'error',
    )
    if (failedIds.length === 0) return
    dispatch({ type: 'RESET_TO_QUEUED', ids: failedIds })
    for (const id of failedIds) enqueue(id)
  }, [state.order, state.files, enqueue])

  const removeFile = useCallback((id: string) => {
    abortControllersRef.current.get(id)?.abort()
    queueRef.current = queueRef.current.filter((qid) => qid !== id)
    const previewUrl = filesRef.current[id]?.previewUrl
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    dispatch({ type: 'REMOVE', id })
  }, [])

  const clearCompleted = useCallback(() => {
    for (const id of state.order) {
      const current = state.files[id]
      if (current?.status === 'success' && current.previewUrl) {
        URL.revokeObjectURL(current.previewUrl)
      }
    }
    dispatch({ type: 'CLEAR_COMPLETED' })
  }, [state.order, state.files])

  const setConcurrency = useCallback((concurrency: number) => {
    dispatch({ type: 'SET_CONCURRENCY', concurrency })
    try {
      localStorage.setItem(CONCURRENCY_KEY, String(concurrency))
    } catch {
      // localStorage may be unavailable (private browsing); non-fatal.
    }
  }, [])

  // Concurrency was raised while items were already queued.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state.concurrency isn't read in the body, but it's the deliberate trigger to re-run pump when the setting changes (pump itself reads the current value from a ref, so its identity alone wouldn't retrigger this effect).
  useEffect(() => {
    pump()
  }, [state.concurrency, pump])

  // Revoke any remaining thumbnail object URLs when the component unmounts.
  useEffect(() => {
    return () => {
      for (const file of Object.values(filesRef.current)) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl)
      }
    }
  }, [])

  const items = state.order
    .map((id) => state.files[id])
    .filter((entry): entry is FileEntry => entry !== undefined)

  return {
    items,
    concurrency: state.concurrency,
    addFiles,
    confirmUpload,
    retry,
    retryAllFailed,
    removeFile,
    clearCompleted,
    setConcurrency,
  }
}
