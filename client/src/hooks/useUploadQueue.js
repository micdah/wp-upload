import { useCallback, useEffect, useReducer, useRef } from 'react';
import { uploadFile } from '../lib/uploadClient';

const CONCURRENCY_KEY = 'wp-upload.concurrency';
const DEFAULT_CONCURRENCY = 3;

function readStoredConcurrency() {
  try {
    const stored = Number(localStorage.getItem(CONCURRENCY_KEY));
    return stored >= 1 && stored <= 6 ? stored : DEFAULT_CONCURRENCY;
  } catch {
    return DEFAULT_CONCURRENCY;
  }
}

function makeId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const initialState = {
  order: [],
  files: {},
  concurrency: readStoredConcurrency(),
};

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_FILES': {
      const files = { ...state.files };
      const order = [...state.order];
      for (const entry of action.entries) {
        files[entry.id] = entry;
        order.push(entry.id);
      }
      return { ...state, files, order };
    }
    case 'SET_STATUS':
      return {
        ...state,
        files: {
          ...state.files,
          [action.id]: { ...state.files[action.id], status: action.status, progress: action.progress ?? state.files[action.id].progress },
        },
      };
    case 'SET_PROGRESS':
      return {
        ...state,
        files: { ...state.files, [action.id]: { ...state.files[action.id], progress: action.progress } },
      };
    case 'SET_SUCCESS':
      return {
        ...state,
        files: {
          ...state.files,
          [action.id]: { ...state.files[action.id], status: 'success', progress: 100, result: action.result, error: null },
        },
      };
    case 'SET_ERROR':
      return {
        ...state,
        files: {
          ...state.files,
          [action.id]: { ...state.files[action.id], status: 'error', error: action.error },
        },
      };
    case 'RESET_TO_QUEUED':
      return {
        ...state,
        files: {
          ...state.files,
          ...Object.fromEntries(
            action.ids.map((id) => [id, { ...state.files[id], status: 'queued', progress: 0, error: null }])
          ),
        },
      };
    case 'REMOVE': {
      const files = { ...state.files };
      delete files[action.id];
      return { ...state, files, order: state.order.filter((id) => id !== action.id) };
    }
    case 'CLEAR_COMPLETED': {
      const files = {};
      const order = [];
      for (const id of state.order) {
        if (state.files[id].status !== 'success') {
          files[id] = state.files[id];
          order.push(id);
        }
      }
      return { ...state, files, order };
    }
    case 'SET_CONCURRENCY':
      return { ...state, concurrency: action.concurrency };
    default:
      return state;
  }
}

export function useUploadQueue() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const queueRef = useRef([]);
  const activeRef = useRef(new Set());
  const abortControllersRef = useRef(new Map());
  const filesRef = useRef(state.files);
  filesRef.current = state.files;
  const concurrencyRef = useRef(state.concurrency);
  concurrencyRef.current = state.concurrency;

  const runUpload = useCallback((id) => {
    const entry = filesRef.current[id];
    if (!entry) return;

    activeRef.current.add(id);
    const controller = new AbortController();
    abortControllersRef.current.set(id, controller);
    dispatch({ type: 'SET_STATUS', id, status: 'uploading', progress: 0 });

    uploadFile(entry.file, {
      signal: controller.signal,
      onProgress: (percent) => {
        if (percent >= 100) {
          dispatch({ type: 'SET_STATUS', id, status: 'finalizing', progress: 100 });
        } else {
          dispatch({ type: 'SET_PROGRESS', id, progress: percent });
        }
      },
    })
      .then((result) => dispatch({ type: 'SET_SUCCESS', id, result }))
      .catch((error) => dispatch({ type: 'SET_ERROR', id, error }))
      .finally(() => {
        activeRef.current.delete(id);
        abortControllersRef.current.delete(id);
        pump();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pump = useCallback(() => {
    while (activeRef.current.size < concurrencyRef.current && queueRef.current.length > 0) {
      const id = queueRef.current.shift();
      runUpload(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runUpload]);

  const addFiles = useCallback(
    (fileList) => {
      const entries = Array.from(fileList).map((file) => ({
        id: makeId(),
        file,
        name: file.name,
        size: file.size,
        status: 'queued',
        progress: 0,
        error: null,
        result: null,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      }));
      // Keep the ref in sync immediately: runUpload reads from it synchronously
      // below, before React has re-rendered and refreshed it from state.
      filesRef.current = { ...filesRef.current, ...Object.fromEntries(entries.map((e) => [e.id, e])) };
      dispatch({ type: 'ADD_FILES', entries });
      queueRef.current.push(...entries.map((e) => e.id));
      pump();
    },
    [pump]
  );

  const retry = useCallback(
    (id) => {
      dispatch({ type: 'RESET_TO_QUEUED', ids: [id] });
      queueRef.current.push(id);
      pump();
    },
    [pump]
  );

  const retryAllFailed = useCallback(() => {
    const failedIds = state.order.filter((id) => state.files[id].status === 'error');
    if (failedIds.length === 0) return;
    dispatch({ type: 'RESET_TO_QUEUED', ids: failedIds });
    queueRef.current.push(...failedIds);
    pump();
  }, [state.order, state.files, pump]);

  const removeFile = useCallback((id) => {
    abortControllersRef.current.get(id)?.abort();
    queueRef.current = queueRef.current.filter((qid) => qid !== id);
    if (filesRef.current[id]?.previewUrl) {
      URL.revokeObjectURL(filesRef.current[id].previewUrl);
    }
    dispatch({ type: 'REMOVE', id });
  }, []);

  const clearCompleted = useCallback(() => {
    for (const id of state.order) {
      if (state.files[id].status === 'success' && state.files[id].previewUrl) {
        URL.revokeObjectURL(state.files[id].previewUrl);
      }
    }
    dispatch({ type: 'CLEAR_COMPLETED' });
  }, [state.order, state.files]);

  const setConcurrency = useCallback(
    (concurrency) => {
      dispatch({ type: 'SET_CONCURRENCY', concurrency });
      try {
        localStorage.setItem(CONCURRENCY_KEY, String(concurrency));
      } catch {
        // localStorage may be unavailable (private browsing); non-fatal.
      }
    },
    []
  );

  // Concurrency was raised while items were already queued.
  useEffect(() => {
    pump();
  }, [state.concurrency, pump]);

  // Revoke any remaining thumbnail object URLs when the component unmounts.
  useEffect(() => {
    return () => {
      for (const file of Object.values(filesRef.current)) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      }
    };
  }, []);

  const items = state.order.map((id) => state.files[id]);

  return {
    items,
    concurrency: state.concurrency,
    addFiles,
    retry,
    retryAllFailed,
    removeFile,
    clearCompleted,
    setConcurrency,
  };
}
