import type { FileEntry } from '../hooks/useUploadQueue'

export interface UploadStats {
  queued: number
  inProgress: number
  duplicate: number
  uploaded: number
  failed: number
  total: number
}

export function computeUploadStats(items: FileEntry[]): UploadStats {
  let queued = 0
  let inProgress = 0
  let duplicate = 0
  let uploaded = 0
  let failed = 0

  for (const item of items) {
    switch (item.status) {
      case 'checking':
      case 'queued':
        queued += 1
        break
      case 'uploading':
      case 'finalizing':
        inProgress += 1
        break
      case 'duplicate':
        duplicate += 1
        break
      case 'success':
        uploaded += 1
        break
      case 'error':
        failed += 1
        break
      default: {
        // Exhaustiveness check: a new UploadStatus must be added to a bucket
        // above, or it silently drops out of every count below (this is
        // exactly how 'duplicate'/'checking' first slipped through here).
        const exhaustive: never = item.status
        throw new Error(`Unhandled upload status: ${exhaustive}`)
      }
    }
  }

  return {
    queued,
    inProgress,
    duplicate,
    uploaded,
    failed,
    total: items.length,
  }
}
