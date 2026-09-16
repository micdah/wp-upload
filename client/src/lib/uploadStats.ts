import type { FileEntry } from '../hooks/useUploadQueue'

export interface UploadStats {
  queued: number
  inProgress: number
  uploaded: number
  failed: number
  total: number
}

export function computeUploadStats(items: FileEntry[]): UploadStats {
  let queued = 0
  let inProgress = 0
  let uploaded = 0
  let failed = 0

  for (const item of items) {
    switch (item.status) {
      case 'queued':
        queued += 1
        break
      case 'uploading':
      case 'finalizing':
        inProgress += 1
        break
      case 'success':
        uploaded += 1
        break
      case 'error':
        failed += 1
        break
    }
  }

  return { queued, inProgress, uploaded, failed, total: items.length }
}
