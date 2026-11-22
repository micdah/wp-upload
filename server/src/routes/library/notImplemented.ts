import type { Request, Response } from 'express'

// Answer for routes that the M0 scaffold registered but no track has built
// yet. Remove this file once every /api/library route is implemented.
export function notImplemented(_req: Request, res: Response): void {
  res.status(501).json({
    code: 'not_implemented',
    message: 'This media-manager endpoint is not implemented yet.',
  })
}
