import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream'
import { Router } from 'express'
import { PLUGIN_SLUG } from '../../../../shared/plugin-api.ts'
import { matchesIfNoneMatch } from '../../lib/library/cache.ts'
import {
  asyncRoute,
  LibraryError,
  queryParams,
} from '../../lib/library/errors.ts'
import { bundledPlugin, bundledPluginDir } from './bootstrap.ts'

// GET plugin/download (server-api.md §7.17): the companion plugin zip
// bundled with the app (D12), for onboarding and the update screens. It
// answers whatever state the plugin on the site is in (no plugin guard).
// The zip and its `plugin.json` sit in the bundle directory S1 reads
// (env.pluginBundleDir: WPU_PLUGIN_BUNDLE_DIR, default plugin/dist).

export const pluginDownloadRouter = Router()

/** The zip the plugin build writes (plugin/scripts/build.mjs). */
export function bundledZipPath(): string {
  return path.join(bundledPluginDir(), `${PLUGIN_SLUG}.zip`)
}

function notBundled(): LibraryError {
  return new LibraryError(
    404,
    'plugin_not_bundled',
    'This installation of the app has no companion plugin zip to offer.',
  )
}

/** The zip's size, or null when there is no regular file. */
async function zipSize(zipPath: string): Promise<number | null> {
  try {
    const stat = await fs.promises.stat(zipPath)
    return stat.isFile() ? stat.size : null
  } catch {
    return null
  }
}

pluginDownloadRouter.get(
  '/plugin/download',
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    // The version comes from plugin.json, read once at startup.
    const version = bundledPlugin()?.version
    const zipPath = bundledZipPath()
    const size = version ? await zipSize(zipPath) : null
    if (!version || size === null) throw notBundled()

    const etag = `"${version}"`
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate')
    res.setHeader('ETag', etag)
    if (matchesIfNoneMatch(req, etag)) {
      res.status(304).end()
      return
    }

    res.status(200)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Length', String(size))
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${PLUGIN_SLUG}-${version.replace(/[^0-9A-Za-z.+-]/g, '')}.zip"`,
    )
    pipeline(fs.createReadStream(zipPath), res, (err) => {
      if (err && !res.destroyed) res.destroy(err)
    })
  }),
)
