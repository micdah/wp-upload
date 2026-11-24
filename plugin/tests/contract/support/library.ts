// Shared helpers for the contract tests: schema-checked calls to the plugin's
// read routes, hydration through core's `/wp/v2/media`, and error checks.
import { expect } from 'vitest'
import type { z } from 'zod'
import {
  CollectionResponseSchema,
  FacetsSchema,
  FolderTreeSchema,
  PluginInfoSchema,
  PluginMaintenanceResponseSchema,
  WpRestErrorSchema,
  type WpuFieldSchema,
} from '../../../../shared/library-api.schema.ts'
import type { Client, Reply } from './http.ts'
import { editor, PLUGIN } from './http.ts'

export type Query = Record<string, string | number>

/** Parses with a zod schema, failing the test with zod's message. */
export function parse<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.infer<S> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(
      `Schema mismatch: ${result.error.message}\n${JSON.stringify(value).slice(0, 2000)}`,
    )
  }
  return result.data
}

/** A `wpu_*` (or core) error with this status and code. */
export function expectError(reply: Reply, status: number, code: string): void {
  expect(
    { status: reply.status, code: reply.body?.code },
    JSON.stringify(reply.body).slice(0, 500),
  ).toEqual({ status, code })
  parse(WpRestErrorSchema, reply.body)
  expect(reply.body.data?.status).toBe(status)
}

/** `api >= wanted` (contract tests never assert equality, §2.4). */
export function apiAtLeast(api: string, wanted: string): boolean {
  const [major = 0, minor = 0] = api.split('.').map(Number)
  const [wantedMajor = 0, wantedMinor = 0] = wanted.split('.').map(Number)
  return major === wantedMajor && minor >= wantedMinor
}

export async function info(user: Client = editor) {
  const reply = await user.get(`${PLUGIN}/info`)
  expect(reply.status, JSON.stringify(reply.body)).toBe(200)
  return parse(PluginInfoSchema, reply.body)
}

export async function collection(query: Query = {}, user: Client = editor) {
  const reply = await user.get(`${PLUGIN}/collection`, query)
  expect(reply.status, JSON.stringify(reply.body).slice(0, 500)).toBe(200)
  return parse(CollectionResponseSchema, reply.body)
}

export async function facets(query: Query = {}, user: Client = editor) {
  const reply = await user.get(`${PLUGIN}/facets`, query)
  expect(reply.status, JSON.stringify(reply.body).slice(0, 500)).toBe(200)
  return parse(FacetsSchema, reply.body)
}

export async function folderTree(user: Client = editor) {
  const reply = await user.get(`${PLUGIN}/folders`)
  expect(reply.status, JSON.stringify(reply.body).slice(0, 500)).toBe(200)
  return parse(FolderTreeSchema, reply.body)
}

export interface Row {
  id: number
  width: number
  height: number
  kind: number
}

export function toRows(flat: number[]): Row[] {
  const rows: Row[] = []
  for (let index = 0; index < flat.length; index += 4) {
    rows.push({
      id: flat[index] ?? 0,
      width: flat[index + 1] ?? 0,
      height: flat[index + 2] ?? 0,
      kind: flat[index + 3] ?? 0,
    })
  }
  return rows
}

export async function ids(
  query: Query = {},
  user: Client = editor,
): Promise<number[]> {
  return toRows((await collection(query, user)).rows).map((row) => row.id)
}

export interface Hydrated {
  id: number
  title: { raw?: string; rendered: string }
  alt_text: string
  date: string
  mime_type: string
  author: number
  wpu: z.infer<typeof WpuFieldSchema>
}

/**
 * Items through core's `/wp/v2/media?include=` with the `wpu` field (as the
 * server hydrates them, server-api.md §7.5), by id. Ids core doesn't return
 * are missing from the map.
 */
export async function hydrate(
  itemIds: number[],
  user: Client = editor,
  status = 'inherit,private',
): Promise<Map<number, Hydrated>> {
  const items = new Map<number, Hydrated>()
  for (let start = 0; start < itemIds.length; start += 100) {
    const chunk = itemIds.slice(start, start + 100)
    const reply = await user.get('/wp/v2/media', {
      include: chunk.join(','),
      per_page: 100,
      orderby: 'include',
      status,
      _fields: 'id,title,alt_text,date,mime_type,author,wpu',
    })
    expect(reply.status, JSON.stringify(reply.body).slice(0, 500)).toBe(200)
    for (const item of reply.body as Hydrated[]) {
      items.set(item.id, item)
    }
  }
  return items
}

/** Runs maintenance steps until the media index is `ready`. */
export async function ensureMediaIndexReady(
  user: Client = editor,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const reply = await user.post(`${PLUGIN}/maintenance/step`, {
      budgetMs: 10000,
    })
    expect(reply.status, JSON.stringify(reply.body)).toBe(200)
    const step = parse(PluginMaintenanceResponseSchema, reply.body)
    if (step.index.media.state === 'ready' && !step.locked) {
      return
    }
  }
  throw new Error('The media index did not become ready')
}

/**
 * Runs maintenance steps until the plugin has nothing left to do: `more` is
 * false, or (for a build whose usage index is still the stub, which keeps
 * `more` true) the media index is ready and a step did no work. The `oldest`
 * and `mu-plugin` runs start without the plugin's tables, so this keeps every
 * test independent of how far the backfill got (track D's M1 handoff §9).
 */
export async function drainMaintenance(user: Client = editor): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const reply = await user.post(`${PLUGIN}/maintenance/step`, {
      budgetMs: 10000,
    })
    expect(reply.status, JSON.stringify(reply.body)).toBe(200)
    const step = parse(PluginMaintenanceResponseSchema, reply.body)
    if (step.locked) {
      continue
    }
    const didNothing =
      step.did.media === 0 && step.did.usage === 0 && step.did.folders === 0
    if (!step.more || (step.index.media.state === 'ready' && didNothing)) {
      return
    }
  }
  throw new Error('Maintenance did not finish')
}
