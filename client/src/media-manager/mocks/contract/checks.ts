// The contract suite: the same request/response checks against the fake
// (fake.contract.spec.ts, in the client's Vitest) and against the real
// server (server-live, S1's live config), so mock and live can't drift.
//
// The checks assume only what the contract promises, never specific data:
// they read the library first (bootstrap, collection) and check the rest
// against it. Mutating checks are opt-in (`mutations: true`) and put back
// what they change.
//
// Runs in plain Node too: imports use `.ts` extensions and nothing from the
// client (no MSW, no React). From the server:
//
//   import { defineLibraryContract } from '../../client/src/media-manager/mocks/contract/checks.ts'
//   defineLibraryContract({ name: 'live', fetch: liveFetch, mutations: true })

import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import * as S from '../../../../../shared/library-api.schema.ts'
import {
  type Bootstrap,
  type CollectionResponse,
  LIBRARY_REV_HEADER,
  LIMITS,
  PLUGIN_USABLE_STATES,
  ROW_STRIDE,
  SORT_KEYS,
} from '../../../../../shared/library-api.ts'

export interface ContractTarget {
  name: string
  /** `path` is relative to `api/library/` (e.g. `items?ids=1`). */
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  /** run the checks that change data (and restore it) */
  mutations?: boolean
}

interface Reply<T> {
  status: number
  headers: Headers
  body: T
}

async function call(
  target: ContractTarget,
  path: string,
  init?: RequestInit,
): Promise<Reply<unknown>> {
  const response = await target.fetch(path, init)
  const text =
    response.status === 304 || response.status === 204
      ? ''
      : await response.text()
  let body: unknown = null
  if (text !== '') {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.status, headers: response.headers, body }
}

/** 2xx with a body that satisfies the schema. */
async function ok<T>(
  target: ContractTarget,
  schema: z.ZodType<T>,
  path: string,
  init?: RequestInit,
  status = 200,
): Promise<Reply<T>> {
  const reply = await call(target, path, init)
  expect(
    reply.status,
    `${init?.method ?? 'GET'} ${path}: ${JSON.stringify(reply.body)}`,
  ).toBe(status)
  const parsed = schema.safeParse(reply.body)
  if (!parsed.success) {
    throw new Error(
      `${path}: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`,
    )
  }
  return { ...reply, body: parsed.data }
}

/** A non-2xx with the `ApiError` envelope and this code. */
async function fails(
  target: ContractTarget,
  path: string,
  status: number,
  code: string,
  init?: RequestInit,
): Promise<Reply<z.infer<typeof S.ApiErrorSchema>>> {
  const reply = await call(target, path, init)
  expect(reply.status, `${path}: ${JSON.stringify(reply.body)}`).toBe(status)
  const parsed = S.ApiErrorSchema.parse(reply.body)
  expect(parsed.code).toBe(code)
  return { ...reply, body: parsed }
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function idsOf(collection: CollectionResponse): number[] {
  const ids: number[] = []
  for (let index = 0; index < collection.total; index++) {
    ids.push(collection.rows[index * ROW_STRIDE] ?? 0)
  }
  return ids
}

/** Registers the contract suite for one target. */
export function defineLibraryContract(target: ContractTarget): void {
  describe(`library contract (${target.name})`, () => {
    let bootstrap: Bootstrap
    let collection: CollectionResponse
    let usable = false

    it('bootstrap: 200, schema, no-store', async () => {
      const reply = await ok(target, S.BootstrapSchema, 'bootstrap')
      bootstrap = reply.body
      expect(reply.headers.get('Cache-Control')).toContain('no-store')
      usable =
        bootstrap.wp.state === 'ok' &&
        bootstrap.plugin !== null &&
        (PLUGIN_USABLE_STATES as readonly string[]).includes(
          bootstrap.plugin.state,
        )
      expect(usable, 'the target must be a usable library').toBe(true)
      expect(bootstrap.site).not.toBeNull()
      expect(bootstrap.rev).not.toBeNull()
    })

    it('rev: schema and X-Library-Rev', async () => {
      const reply = await ok(target, S.RevResponseSchema, 'rev')
      expect(reply.headers.get(LIBRARY_REV_HEADER)).toBe(reply.body.rev)
      expect(reply.headers.get('Cache-Control')).toContain('no-store')
    })

    it('collection: defaults echoed, stride 4, ETag and 304', async () => {
      const reply = await ok(target, S.CollectionResponseSchema, 'collection')
      collection = reply.body
      expect(collection.query).toEqual({
        folder: 'all',
        q: null,
        type: null,
        alt: null,
        size: null,
        orient: null,
        month: null,
        sort: 'date-desc',
      })
      expect(collection.rows.length).toBe(collection.total * ROW_STRIDE)
      expect(new Set(idsOf(collection)).size).toBe(collection.total)
      expect(reply.headers.get('Cache-Control')).toBe('private, no-cache')
      const etag = reply.headers.get('ETag')
      // server-api.md §3.3: W/"<rev>-<hash>"; the hash's alphabet is the
      // server's choice (it uses base64url).
      expect(etag).toMatch(/^W\/"\d+-[A-Za-z0-9_-]+"$/)
      const revalidated = await call(target, 'collection', {
        headers: { 'If-None-Match': etag ?? '' },
      })
      expect(revalidated.status).toBe(304)
    })

    it('collection: every sort lists the same items', async () => {
      for (const sort of SORT_KEYS) {
        const reply = await ok(
          target,
          S.CollectionResponseSchema,
          `collection?sort=${sort}`,
        )
        expect(reply.body.total).toBe(collection.total)
        expect(reply.body.query.sort).toBe(sort)
        expect(new Set(idsOf(reply.body))).toEqual(new Set(idsOf(collection)))
      }
    })

    it('collection: date-desc is newest first with the id tiebreaker', async () => {
      const ids = idsOf(collection).slice(0, LIMITS.itemIds)
      if (ids.length < 2) {
        return
      }
      const items = await ok(
        target,
        S.ItemsTileResponseSchema,
        `items?ids=${ids.join(',')}`,
      )
      for (let index = 1; index < items.body.items.length; index++) {
        const previous = items.body.items[index - 1]
        const current = items.body.items[index]
        if (!previous || !current) {
          continue
        }
        const order =
          previous.uploadedAt > current.uploadedAt ||
          (previous.uploadedAt === current.uploadedAt &&
            previous.id > current.id)
        expect(order, `${previous.id} before ${current.id}`).toBe(true)
      }
    })

    it('collection: type=image lists image-like kinds only', async () => {
      const reply = await ok(
        target,
        S.CollectionResponseSchema,
        'collection?type=image',
      )
      for (let index = 0; index < reply.body.total; index++) {
        expect([0, 1]).toContain(reply.body.rows[index * ROW_STRIDE + 3])
      }
    })

    it('collection: the Trash ignores other filters and the sort', async () => {
      const reply = await ok(
        target,
        S.CollectionResponseSchema,
        'collection?folder=trash&type=image&sort=title-asc&q=x',
      )
      expect(reply.body.query).toEqual({
        folder: 'trash',
        q: null,
        type: null,
        alt: null,
        size: null,
        orient: null,
        month: null,
        sort: 'date-desc',
      })
    })

    it('collection: empty values count as absent', async () => {
      const reply = await ok(
        target,
        S.CollectionResponseSchema,
        'collection?q=&type=',
      )
      expect(reply.body.total).toBe(collection.total)
    })

    it('collection: invalid values and unknown parameters are 400 with details.param', async () => {
      for (const [path, param] of [
        ['collection?sort=bogus', 'sort'],
        ['collection?type=pictures', 'type'],
        ['collection?folder=-1', 'folder'],
        ['collection?month=2026-13', 'month'],
        ['collection?orient=diagonal', 'orient'],
        ['collection?colour=red', 'colour'],
        [`collection?q=${'x'.repeat(LIMITS.queryLength + 1)}`, 'q'],
      ] as const) {
        const reply = await fails(target, path, 400, 'invalid_request')
        expect(reply.body.details?.param).toBe(param)
      }
    })

    it('collection: an unknown folder is 404 wpu_folder_not_found (with FileBird)', async () => {
      if (!bootstrap.site?.filebird?.active) {
        await fails(target, 'collection?folder=0', 409, 'wpu_filebird_inactive')
        return
      }
      await fails(
        target,
        'collection?folder=999999999',
        404,
        'wpu_folder_not_found',
      )
    })

    it('facets: schema; view matches the collection; folder=all view = folder', async () => {
      const reply = await ok(target, S.FacetsSchema, 'facets')
      expect(reply.body.view.total).toBe(collection.total)
      expect(reply.body.folder).toEqual(reply.body.view)
      const months = reply.body.months.reduce(
        (sum, month) => sum + month.count,
        0,
      )
      expect(months).toBe(reply.body.folder.total)
      const typed = await ok(target, S.FacetsSchema, 'facets?type=image')
      expect(typed.body.folder).toEqual(reply.body.folder)
      expect(typed.body.view.total).toBe(reply.body.folder.types.image)
    })

    it('items: tile and full views follow the order of ids', async () => {
      const ids = idsOf(collection).slice(0, 5).reverse()
      if (ids.length === 0) {
        return
      }
      const tiles = await ok(
        target,
        S.ItemsTileResponseSchema,
        `items?ids=${ids.join(',')}`,
      )
      expect(tiles.body.items.map((item) => item.id)).toEqual(ids)
      expect(tiles.body.missing).toEqual([])
      const full = await ok(
        target,
        S.ItemsFullResponseSchema,
        `items?ids=${ids.join(',')}&view=full`,
      )
      expect(full.body.items.map((item) => item.id)).toEqual(ids)
      for (const item of full.body.items) {
        const tile = tiles.body.items.find(
          (candidate) => candidate.id === item.id,
        )
        expect(tile?.width).toBe(item.width)
        expect(tile?.modifiedAt).toBe(item.modifiedAt)
      }
    })

    it('items: unknown ids come back in missing; duplicates are removed', async () => {
      const first = idsOf(collection)[0]
      const ids = first === undefined ? [999999999] : [first, 999999999, first]
      const reply = await ok(
        target,
        S.ItemsTileResponseSchema,
        `items?ids=${ids.join(',')}`,
      )
      expect(reply.body.missing).toEqual([999999999])
      expect(reply.body.items.length).toBe(first === undefined ? 0 : 1)
    })

    it('items: limits and malformed ids are 400', async () => {
      const tooMany = Array.from(
        { length: LIMITS.itemIds + 1 },
        (_, index) => index + 1,
      )
      await fails(
        target,
        `items?ids=${tooMany.join(',')}`,
        400,
        'invalid_request',
      )
      await fails(target, 'items?ids=abc', 400, 'invalid_request')
      await fails(target, 'items', 400, 'invalid_request')
      await fails(target, 'items?ids=1&view=huge', 400, 'invalid_request')
    })

    it('usage: one entry per id, in order', async () => {
      const ids = idsOf(collection).slice(0, 3)
      if (ids.length === 0) {
        return
      }
      const reply = await ok(
        target,
        S.UsageResponseSchema,
        `usage?ids=${ids.join(',')}`,
      )
      expect(reply.body.items.map((item) => item.id)).toEqual(ids)
      for (const item of reply.body.items) {
        expect(item.count).toBeGreaterThanOrEqual(item.refs.length)
      }
    })

    it('posts: schema, limit validated', async () => {
      const reply = await ok(target, S.PostsResponseSchema, 'posts?limit=5')
      expect(reply.body.posts.length).toBeLessThanOrEqual(5)
      await fails(
        target,
        `posts?limit=${LIMITS.postsLimit + 1}`,
        400,
        'invalid_request',
      )
    })

    it('folders: tree and counts agree with the collection (or 409 without FileBird)', async () => {
      if (!bootstrap.site?.filebird?.active) {
        await fails(target, 'folders', 409, 'wpu_filebird_inactive')
        return
      }
      const reply = await ok(target, S.FolderTreeSchema, 'folders')
      expect(reply.body.counts.all).toBe(collection.total)
      const direct = reply.body.folders.reduce(
        (sum, folder) => sum + folder.count,
        0,
      )
      expect(direct + reply.body.counts.uncategorized).toBe(
        reply.body.counts.all,
      )
      if (!reply.body.mode.pro) {
        expect(
          reply.body.folders.every((folder) => folder.color === null),
        ).toBe(true)
      }
      const uncategorized = await ok(
        target,
        S.CollectionResponseSchema,
        'collection?folder=0',
      )
      expect(uncategorized.body.total).toBe(reply.body.counts.uncategorized)
    })

    it('trash: summary schema', async () => {
      const reply = await ok(target, S.TrashSummarySchema, 'trash')
      const trash = await ok(
        target,
        S.CollectionResponseSchema,
        'collection?folder=trash',
      )
      expect(reply.body.count).toBe(trash.body.total)
    })

    it('jobs: unknown ids read not_found; ids are required', async () => {
      const reply = await ok(
        target,
        S.JobsResponseSchema,
        'jobs?ids=00000000-0000-4000-8000-000000000000',
      )
      expect(reply.body.jobs).toEqual([
        { id: '00000000-0000-4000-8000-000000000000', state: 'not_found' },
      ])
      await fails(target, 'jobs', 400, 'invalid_request')
    })

    it('upload/check: schema', async () => {
      await ok(
        target,
        S.UploadCheckResponseSchema,
        'upload/check?filename=nothing-like-this.jpg',
      )
    })

    it('unknown routes are 404 not_found', async () => {
      await fails(target, 'no-such-route', 404, 'not_found')
    })

    it('PATCH items/:id validates its body', async () => {
      const id = idsOf(collection)[0] ?? 1
      await fails(
        target,
        `items/${id}`,
        400,
        'invalid_request',
        jsonInit('PATCH', {}),
      )
      await fails(
        target,
        `items/${id}`,
        400,
        'invalid_request',
        jsonInit('PATCH', { colour: 'red' }),
      )
    })

    it.runIf(target.mutations === true)(
      'PATCH items/:id: previous, snapshot and a new rev; then restored',
      async () => {
        const ids = idsOf(collection).slice(0, LIMITS.itemIds)
        const items = await ok(
          target,
          S.ItemsTileResponseSchema,
          `items?ids=${ids.join(',')}`,
        )
        const item = items.body.items.find((candidate) => candidate.perms.edit)
        if (!item) {
          return
        }
        const before = await ok(target, S.RevResponseSchema, 'rev')
        const alt = `contract check ${Date.now()}`
        const patched = await ok(
          target,
          S.ItemPatchResponseSchema,
          `items/${item.id}`,
          jsonInit('PATCH', { alt }),
        )
        expect(patched.body.previous).toEqual({ alt: item.alt })
        expect(patched.body.item.alt).toBe(alt)
        // Alt is post meta: modifiedAt stays.
        expect(patched.body.item.modifiedAt).toBe(item.modifiedAt)
        expect(patched.body.rev).not.toBe(before.body.rev)
        const restored = await ok(
          target,
          S.ItemPatchResponseSchema,
          `items/${item.id}`,
          jsonInit('PATCH', { alt: item.alt }),
        )
        expect(restored.body.previous).toEqual({ alt })
      },
    )

    it.runIf(target.mutations === true)(
      'folders: create (auto-suffix), rename, assign and delete',
      async () => {
        if (
          !bootstrap.site?.filebird?.active ||
          bootstrap.site.filebird.perUser
        ) {
          return
        }
        const name = `Contract ${Date.now()}`
        const first = await ok(
          target,
          S.FolderMutationResponseSchema,
          'folders',
          jsonInit('POST', { name, parent: 0 }),
          201,
        )
        expect(first.body.folder.name).toBe(name)
        expect(first.body.renamed).toBe(false)
        const second = await ok(
          target,
          S.FolderMutationResponseSchema,
          'folders',
          jsonInit('POST', { name, parent: 0 }),
          201,
        )
        expect(second.body.renamed).toBe(true)
        expect(second.body.folder.name).not.toBe(name)
        expect(second.body.requestedName).toBe(name)
        await fails(
          target,
          `folders/${first.body.folder.id}`,
          409,
          'wpu_folder_cycle',
          jsonInit('PATCH', { parent: first.body.folder.id }),
        )
        const renamed = await ok(
          target,
          S.FolderMutationResponseSchema,
          `folders/${second.body.folder.id}`,
          jsonInit('PATCH', {
            name: `${name} b`,
            parent: first.body.folder.id,
          }),
        )
        expect(renamed.body.folder.parent).toBe(first.body.folder.id)

        const ids = idsOf(collection).slice(0, 2)
        if (ids.length > 0) {
          const assigned = await ok(
            target,
            S.FolderAssignResponseSchema,
            'folders/assign',
            jsonInit('POST', { folder: second.body.folder.id, ids }),
          )
          // Every id is either moved (in `previous`) or `skipped` (e.g. an
          // Author and others' items).
          const answered = [
            ...assigned.body.previous.map((entry) => entry.id),
            ...assigned.body.skipped.map((entry) => entry.id),
          ]
          expect(answered.sort()).toEqual([...ids].sort())
          // Undo: one assign per previous folder.
          const groups = new Map<number, number[]>()
          for (const entry of assigned.body.previous) {
            groups.set(entry.folder, [
              ...(groups.get(entry.folder) ?? []),
              entry.id,
            ])
          }
          for (const [folder, groupIds] of groups) {
            await ok(
              target,
              S.FolderAssignResponseSchema,
              'folders/assign',
              jsonInit('POST', { folder, ids: groupIds }),
            )
          }
        }
        const deleted = await ok(
          target,
          S.FolderDeleteResponseSchema,
          `folders/${first.body.folder.id}`,
          { method: 'DELETE' },
        )
        expect([...deleted.body.deletedIds].sort((a, b) => a - b)).toEqual(
          [first.body.folder.id, second.body.folder.id].sort((a, b) => a - b),
        )
        expect(
          deleted.body.tree.folders.some(
            (folder) => folder.id === first.body.folder.id,
          ),
        ).toBe(false)
      },
    )
  })
}
