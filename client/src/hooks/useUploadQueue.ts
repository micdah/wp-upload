import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { SelectedFolder } from '../lib/folderClient'
import {
  cancelUploadJob,
  checkDuplicate,
  type ExistingMedia,
  fetchJobStatuses,
  type UploadClientError,
  type UploadResult,
  uploadFile,
} from '../lib/uploadClient'

const CONCURRENCY_KEY = 'wp-upload.concurrency'
const DEFAULT_CONCURRENCY = 3

// Browsers allow ~6 concurrent HTTP/1.1 connections per origin. Transfers
// are capped below that so one stays free for the status, server-load, job
// and duplicate-check requests. This only limits the browser -> server leg:
// once the server has a file, its WordPress upload runs as a server-side job
// that no longer holds a connection, so the "parallel uploads" setting can
// exceed this (see #37).
const MAX_PARALLEL_TRANSFERS = 5

const JOB_POLL_INTERVAL_MS = 1000
const JOB_POLL_TIMEOUT_MS = 10_000

const JOB_LOST_ERROR: UploadClientError = {
  code: 'job_lost',
  message:
    'The server lost track of this upload (it may have restarted). Check WordPress before retrying.',
}

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
  // FileBird folder selected when the file was dropped - deliberately not
  // the live selection, so changing folders only affects later drops (#38).
  folder: SelectedFolder | null
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
    // No upper bound here - App clamps it to the server's
    // UPLOAD_CONCURRENCY once /api/status has loaded.
    return Number.isInteger(stored) && stored >= 1
      ? stored
      : DEFAULT_CONCURRENCY
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
  // An upload counts against `concurrency` from the start of its transfer
  // until its server-side job settles - first in transferringRef, then in
  // processingRef (entry id -> server job id).
  const transferringRef = useRef<Set<string>>(new Set())
  const processingRef = useRef<Map<string, string>>(new Map())
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())
  // Transfers whose body has been fully sent. Aborting one of those can no
  // longer stop the server from creating its job - it only throws away the
  // 202 carrying the job id - so removal instead waits for that id
  // (removedAfterSendRef) and cancels the job.
  const bodySentRef = useRef<Set<string>>(new Set())
  const removedAfterSendRef = useRef<Set<string>>(new Set())
  const unmountedRef = useRef(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollInFlightRef = useRef(false)
  const filesRef = useRef<Record<string, FileEntry>>(state.files)
  filesRef.current = state.files
  const concurrencyRef = useRef(state.concurrency)
  concurrencyRef.current = state.concurrency

  // biome-ignore lint/correctness/useExhaustiveDependencies: runUpload, pump, pollJobs and schedulePoll recursively reference each other; all stay stable via refs, so adding them here would just churn the callback identity without changing behavior.
  const runUpload = useCallback((id: string) => {
    const entry = filesRef.current[id]
    if (!entry) return

    transferringRef.current.add(id)
    const controller = new AbortController()
    abortControllersRef.current.set(id, controller)
    dispatch({ type: 'SET_STATUS', id, status: 'uploading', progress: 0 })

    uploadFile(entry.file, {
      signal: controller.signal,
      folderId: entry.folder?.id,
      onProgress: (percent) => {
        if (percent >= 100) {
          bodySentRef.current.add(id)
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
      .then(({ jobId }) => {
        // Removed once the body was sent (or right as the transfer
        // completed) - too late to stop the server creating the job, so
        // cancel that instead.
        if (controller.signal.aborted || removedAfterSendRef.current.has(id)) {
          cancelUploadJob(jobId)
          return
        }
        processingRef.current.set(id, jobId)
        dispatch({
          type: 'SET_STATUS',
          id,
          status: 'finalizing',
          progress: 100,
        })
        schedulePoll()
      })
      .catch((error: UploadClientError) =>
        dispatch({ type: 'SET_ERROR', id, error }),
      )
      .finally(() => {
        transferringRef.current.delete(id)
        abortControllersRef.current.delete(id)
        bodySentRef.current.delete(id)
        removedAfterSendRef.current.delete(id)
        pump()
      })
  }, [])

  const pump = useCallback(() => {
    while (
      transferringRef.current.size < MAX_PARALLEL_TRANSFERS &&
      transferringRef.current.size + processingRef.current.size <
        concurrencyRef.current &&
      queueRef.current.length > 0
    ) {
      const id = queueRef.current.shift()
      if (id) runUpload(id)
    }
  }, [runUpload])

  // Follows every processing job with a single batched request per tick.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see runUpload - schedulePoll is declared below and references this callback back.
  const pollJobs = useCallback(() => {
    pollTimerRef.current = null
    const polled = [...processingRef.current]
    if (polled.length === 0) return

    pollInFlightRef.current = true
    const entryIdByJobId = new Map(
      polled.map(([entryId, jobId]) => [jobId, entryId]),
    )
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), JOB_POLL_TIMEOUT_MS)

    fetchJobStatuses([...entryIdByJobId.keys()], controller.signal)
      .then((jobs) => {
        for (const job of jobs) {
          const id = entryIdByJobId.get(job.id)
          // Removed by the user while this poll was in flight.
          if (!id || processingRef.current.get(id) !== job.id) continue

          if (job.status === 'success') {
            dispatch({ type: 'SET_SUCCESS', id, result: job.result })
          } else if (job.status === 'error') {
            dispatch({ type: 'SET_ERROR', id, error: job.error })
          } else if (job.status === 'not_found') {
            dispatch({ type: 'SET_ERROR', id, error: JOB_LOST_ERROR })
          } else {
            continue
          }
          processingRef.current.delete(id)
        }
        pump()
      })
      .catch(() => {
        // Transient (network blip, server briefly unreachable) - the jobs
        // keep running server-side, so just ask again next tick.
      })
      .finally(() => {
        clearTimeout(timeoutId)
        pollInFlightRef.current = false
        schedulePoll()
      })
  }, [])

  const schedulePoll = useCallback(() => {
    if (
      unmountedRef.current ||
      pollTimerRef.current !== null ||
      pollInFlightRef.current ||
      processingRef.current.size === 0
    )
      return
    pollTimerRef.current = setTimeout(pollJobs, JOB_POLL_INTERVAL_MS)
  }, [pollJobs])

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
    (fileList: File[], folder: SelectedFolder | null = null) => {
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
        folder,
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

  const removeFile = useCallback(
    (id: string) => {
      const transfer = abortControllersRef.current.get(id)
      if (transfer) {
        if (bodySentRef.current.has(id)) removedAfterSendRef.current.add(id)
        else transfer.abort()
      }
      const jobId = processingRef.current.get(id)
      if (jobId) {
        processingRef.current.delete(id)
        cancelUploadJob(jobId)
        pump()
      }
      queueRef.current = queueRef.current.filter((qid) => qid !== id)
      const previewUrl = filesRef.current[id]?.previewUrl
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
      dispatch({ type: 'REMOVE', id })
    },
    [pump],
  )

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

  // Revoke any remaining thumbnail object URLs and stop polling when the
  // component unmounts.
  useEffect(() => {
    // Reset on (re)mount - StrictMode runs this cleanup once in development.
    unmountedRef.current = false
    return () => {
      // An in-flight poll would otherwise reschedule itself from .finally.
      unmountedRef.current = true
      if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
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
