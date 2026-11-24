import { describe, expect, it } from 'vitest'
import {
  bootstrapAuthor,
  bootstrapFileBirdPerUser,
  bootstrapFileBirdPro,
  bootstrapNoFileBird,
  bootstrapOk,
  bootstrapPluginMissing,
  bootstrapPluginUpdateAvailable,
  bootstrapTrash,
} from '../../../../../shared/fixtures/bootstrap'
import type { Bootstrap } from '../../../../../shared/library-api'
import {
  type CanResult,
  evaluate,
  PERM_ACTIONS,
  type PermItem,
  partitionWith,
} from './can'

const editable: PermItem = {
  id: 1,
  perms: { edit: true, delete: true },
  kind: 'image',
  mime: 'image/jpeg',
}
const othersItem: PermItem = {
  id: 2,
  perms: { edit: false, delete: false },
  kind: 'image',
  mime: 'image/jpeg',
}

function check(
  bootstrap: Bootstrap | null,
  action: (typeof PERM_ACTIONS)[number],
  item?: PermItem,
  online = true,
) {
  return evaluate({ bootstrap, online }, action, item)
}

function code(result: CanResult): string | null {
  return result.ok ? null : result.code
}

describe('can()', () => {
  it('allows everything an Editor does on a normal site (except Pro and Trash-off)', () => {
    for (const action of PERM_ACTIONS) {
      const result = check(
        bootstrapOk,
        action,
        action === 'restore' ? undefined : editable,
      )
      if (action === 'folder-color' || action === 'folder-sort') {
        expect(code(result), action).toBe('not-pro')
      } else if (action === 'trash') {
        expect(code(result), action).toBe('trash-disabled')
      } else {
        expect(result, action).toEqual({ ok: true })
      }
    }
  })

  it('denies everything before bootstrap and while offline', () => {
    expect(code(check(null, 'upload'))).toBe('not-ready')
    expect(code(check(bootstrapPluginMissing, 'upload'))).toBe('not-ready')
    const offline = check(bootstrapOk, 'edit-meta', editable, false)
    expect(offline).toEqual({
      ok: false,
      code: 'offline',
      reason: 'WordPress is unreachable right now',
    })
  })

  it('folder actions follow the FileBird mode', () => {
    expect(code(check(bootstrapNoFileBird, 'move-to-folder', editable))).toBe(
      'no-filebird',
    )
    expect(code(check(bootstrapNoFileBird, 'folder-create'))).toBe(
      'no-filebird',
    )
    expect(code(check(bootstrapFileBirdPerUser, 'folder-create'))).toBe(
      'filebird-per-user',
    )
    expect(
      code(check(bootstrapFileBirdPerUser, 'move-to-folder', editable)),
    ).toBe('filebird-per-user')
    expect(check(bootstrapFileBirdPro, 'folder-color')).toEqual({ ok: true })
  })

  it('Authors may change only their own media', () => {
    expect(check(bootstrapAuthor, 'edit-meta', editable)).toEqual({ ok: true })
    expect(check(bootstrapAuthor, 'edit-meta', othersItem)).toEqual({
      ok: false,
      code: 'no-item-perm',
      reason: 'You can only change your own media',
    })
    expect(code(check(bootstrapAuthor, 'delete', othersItem))).toBe(
      'no-item-perm',
    )
    // Downloading and viewing usage need no item permission.
    expect(check(bootstrapAuthor, 'download', othersItem)).toEqual({ ok: true })
  })

  it('trash state gates actions', () => {
    expect(check(bootstrapTrash, 'trash', editable)).toEqual({ ok: true })
    const trashed = {
      ...editable,
      trash: { trashedAt: '2026-11-01T00:00:00Z', daysLeft: 20 },
    }
    expect(code(check(bootstrapTrash, 'edit-meta', trashed))).toBe('trashed')
    expect(check(bootstrapTrash, 'restore', trashed)).toEqual({ ok: true })
    expect(code(check(bootstrapTrash, 'restore', editable))).toBe('not-trashed')
  })

  it('image actions need an editable image that finished processing', () => {
    expect(
      code(
        check(bootstrapOk, 'edit-image', {
          ...editable,
          kind: 'video',
          mime: 'video/mp4',
        }),
      ),
    ).toBe('unsupported-type')
    expect(
      code(
        check(bootstrapOk, 'edit-image', {
          ...editable,
          mime: 'image/svg+xml',
          kind: 'svg',
        }),
      ),
    ).toBe('unsupported-type')
    expect(
      code(
        check(bootstrapOk, 'regenerate', { ...editable, sizesPending: true }),
      ),
    ).toBe('processing')
  })

  it('features missing from the plugin say which plugin is needed', () => {
    const lacking: Bootstrap = {
      ...bootstrapPluginUpdateAvailable,
      plugin: {
        ...(bootstrapPluginUpdateAvailable.plugin as NonNullable<
          Bootstrap['plugin']
        >),
        features: ['collection', 'facets', 'folders'],
      },
    }
    const result = check(lacking, 'edit-meta', editable)
    expect(code(result)).toBe('needs-plugin')
    expect(result.ok ? '' : result.reason).toMatch(
      /^Needs (plugin \d|a newer companion plugin)/,
    )
    expect(check(lacking, 'move-to-folder', editable)).toEqual({ ok: true })
  })

  it('partition splits a mixed Author selection', () => {
    const { allowed, denied } = partitionWith(
      { bootstrap: bootstrapAuthor, online: true },
      'edit-meta',
      [editable, othersItem],
    )
    expect(allowed).toEqual([editable])
    expect(denied).toHaveLength(1)
    expect(denied[0]?.item).toBe(othersItem)
    expect(denied[0]?.result.code).toBe('no-item-perm')
  })
})
