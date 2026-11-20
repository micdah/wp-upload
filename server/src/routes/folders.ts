import express, { Router } from 'express'
import { isFilebirdEnabled } from '../config/filebirdClient.ts'
import { createFolder, listFolders } from '../lib/filebird.ts'
import { isWpError } from '../lib/wpUpload.ts'

const MAX_FOLDER_NAME_LENGTH = 200

// Thin proxy over FileBird's folder API so the API key stays server-side.
// Only reachable when FILEBIRD_API_KEY is set - see #38.
export const foldersRouter = Router()

foldersRouter.use('/folders', (_req, res, next) => {
  if (isFilebirdEnabled()) return next()
  res.status(404).json({
    code: 'filebird_disabled',
    message: 'FileBird support is not enabled on this server.',
  })
})

foldersRouter.get('/folders', async (_req, res, next) => {
  try {
    res.json({ folders: await listFolders() })
  } catch (wpError) {
    if (!isWpError(wpError)) return next(wpError)
    res
      .status(wpError.status || 502)
      .json({ code: wpError.code, message: wpError.message })
  }
})

foldersRouter.post('/folders', express.json(), async (req, res, next) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name || name.length > MAX_FOLDER_NAME_LENGTH) {
    return res.status(400).json({
      code: 'invalid_folder_name',
      message: `Folder name must be between 1 and ${MAX_FOLDER_NAME_LENGTH} characters.`,
    })
  }

  const parentId = req.body?.parentId ?? 0
  if (!Number.isInteger(parentId) || parentId < 0) {
    return res.status(400).json({
      code: 'invalid_parent_id',
      message: 'parentId must be a non-negative integer (0 for the root).',
    })
  }

  try {
    res.status(201).json(await createFolder(name, parentId))
  } catch (wpError) {
    if (!isWpError(wpError)) return next(wpError)
    res
      .status(wpError.status || 502)
      .json({ code: wpError.code, message: wpError.message })
  }
})
