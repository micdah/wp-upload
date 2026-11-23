// Every fixture parses with its zod schema, and the numbers that depend on
// each other (rows vs items, facets vs folder counts) agree. Runs in the
// server's Vitest once its config includes ../shared (change request CR-5).
import { describe, expect, it } from 'vitest'
import * as S from '../library-api.schema.ts'
import { MEDIA_KINDS, ROW_STRIDE } from '../library-api.ts'
import * as fx from './index.ts'

const cases: [string, { parse: (v: unknown) => unknown }, unknown][] = [
  ...Object.entries(fx.bootstrapByPluginState).map(
    ([name, value]) =>
      [`bootstrap ${name}`, S.BootstrapSchema, value] as [
        string,
        typeof S.BootstrapSchema,
        unknown,
      ],
  ),
  ['bootstrapAuthor', S.BootstrapSchema, fx.bootstrapAuthor],
  ['bootstrapTrash', S.BootstrapSchema, fx.bootstrapTrash],
  ['bootstrapFileBirdPro', S.BootstrapSchema, fx.bootstrapFileBirdPro],
  ['bootstrapFileBirdPerUser', S.BootstrapSchema, fx.bootstrapFileBirdPerUser],
  ['bootstrapNoFileBird', S.BootstrapSchema, fx.bootstrapNoFileBird],
  ['bootstrapIndexing', S.BootstrapSchema, fx.bootstrapIndexing],
  ['bootstrapWpUnreachable', S.BootstrapSchema, fx.bootstrapWpUnreachable],
  ['bootstrapWpAuthFailed', S.BootstrapSchema, fx.bootstrapWpAuthFailed],
  ['collectionAll', S.CollectionResponseSchema, fx.collectionAll],
  [
    'collectionUncategorizedMissingAlt',
    S.CollectionResponseSchema,
    fx.collectionUncategorizedMissingAlt,
  ],
  ['collectionTrash', S.CollectionResponseSchema, fx.collectionTrash],
  ['facetsAll', S.FacetsSchema, fx.facetsAll],
  [
    'facetsUncategorizedMissingAlt',
    S.FacetsSchema,
    fx.facetsUncategorizedMissingAlt,
  ],
  ['folderTree', S.FolderTreeSchema, fx.folderTree],
  ['folderTreePro', S.FolderTreeSchema, fx.folderTreePro],
  ['folderTreePerUser', S.FolderTreeSchema, fx.folderTreePerUser],
  [
    'folderCreateRenamed',
    S.FolderMutationResponseSchema,
    fx.folderCreateRenamed,
  ],
  ['folderDeleteEvents', S.FolderDeleteResponseSchema, fx.folderDeleteEvents],
  [
    'folderAssignPressKit',
    S.FolderAssignResponseSchema,
    fx.folderAssignPressKit,
  ],
  ['tileItems', S.LibraryItemTileSchema.array(), fx.tileItems],
  ['fullItems', S.LibraryItemFullSchema.array(), fx.fullItems],
  ['trashItems', S.TrashItemSchema.array(), fx.trashItems],
  ['jobsEveryState', S.JobsResponseSchema, fx.jobsEveryState],
  ['jobRestoreSucceeded', S.JobSchema, fx.jobRestoreSucceeded],
  ['jobRegenerateSucceeded', S.JobSchema, fx.jobRegenerateSucceeded],
  ['patchAlt', S.ItemPatchResponseSchema, fx.patchAlt],
  ['batchCaption', S.BatchResponseSchema, fx.batchCaption],
  ['deleteToTrash', S.DeleteResponseSchema, fx.deleteToTrash],
  ['deletePermanently', S.DeleteResponseSchema, fx.deletePermanently],
  ['trashSummary', S.TrashSummarySchema, fx.trashSummary],
  ['restoreFromTrash', S.RestoreResponseSchema, fx.restoreFromTrash],
  ['emptyTrashStep', S.EmptyTrashResponseSchema, fx.emptyTrashStep],
  [
    'uploadCheckDuplicate',
    S.UploadCheckResponseSchema,
    fx.uploadCheckDuplicate,
  ],
  ...Object.entries(fx.errors).map(
    ([name, value]) =>
      [`error ${name}`, S.ApiErrorSchema, value] as [
        string,
        typeof S.ApiErrorSchema,
        unknown,
      ],
  ),
  ['usageSample', S.UsageResponseSchema, fx.usageSample],
  ['usageSiteLogo', S.UsageResponseSchema, fx.usageSiteLogo],
  ['postsRecent', S.PostsResponseSchema, fx.postsRecent],
  ['pluginInfo', S.PluginInfoSchema, fx.pluginInfo],
  ['pluginInfo identity', S.PluginIdentitySchema, fx.pluginInfo],
  ['pluginInfoForbidden', S.WpRestErrorSchema, fx.pluginInfoForbidden],
  ['restNoRoute', S.WpRestErrorSchema, fx.restNoRoute],
  ['wpuFieldEdited', S.WpuFieldSchema, fx.wpuFieldEdited],
  ['pluginRestoreImage', S.PluginImageOpResponseSchema, fx.pluginRestoreImage],
  ['pluginDeletePartial', S.PluginDeleteResponseSchema, fx.pluginDeletePartial],
  [
    'pluginMaintenanceStep',
    S.PluginMaintenanceResponseSchema,
    fx.pluginMaintenanceStep,
  ],
]

describe('shared fixtures', () => {
  it.each(cases)('%s parses', (_name, schema, value) => {
    expect(() => schema.parse(value)).not.toThrow()
  })

  it('collection rows match the tile items', () => {
    const byId = new Map(fx.tileItems.map((item) => [item.id, item]))
    const rows = fx.collectionAll.rows
    for (let index = 0; index < rows.length; index += ROW_STRIDE) {
      const item = byId.get(rows[index] as number)
      expect(item).toBeDefined()
      expect(rows[index + 1]).toBe(item?.width)
      expect(rows[index + 2]).toBe(item?.height)
      expect(MEDIA_KINDS[rows[index + 3] as number]).toBe(item?.kind)
      expect(item?.trash).toBeNull()
    }
  })

  it('facets and folder counts agree with the collection', () => {
    expect(fx.facetsAll.view.total).toBe(fx.collectionAll.total)
    expect(fx.folderTree.counts.all).toBe(fx.collectionAll.total)
    const inFolders = fx.folderTree.folders.reduce((sum, f) => sum + f.count, 0)
    expect(inFolders + fx.folderTree.counts.uncategorized).toBe(
      fx.folderTree.counts.all,
    )
    expect(fx.trashSummary.count).toBe(fx.collectionTrash.total)
    expect(fx.facetsUncategorizedMissingAlt.folder.total).toBe(
      fx.folderTree.counts.uncategorized,
    )
  })

  it('request schemas reject what the contracts reject', () => {
    const at = '2026-10-02T08:41:19Z'
    const bad: [
      string,
      { safeParse: (v: unknown) => { success: boolean } },
      unknown,
    ][] = [
      [
        'unknown key',
        S.DeleteRequestSchema,
        { ids: [1], mode: 'trash', force: true },
      ],
      ['empty set', S.BatchSameRequestSchema, { ids: [1], set: {} }],
      [
        'replace and append',
        S.BatchSameRequestSchema,
        { ids: [1], set: { description: 'a' }, appendDescription: 'b' },
      ],
      ['post 0', S.ItemPatchSchema, { post: 0 }],
      [
        'empty edit',
        S.EditRequestSchema,
        { ops: [], applyTo: 'all', expectedModified: at },
      ],
      ['empty folder patch', S.FolderUpdateRequestSchema, {}],
    ]
    for (const [name, schema, value] of bad) {
      expect(schema.safeParse(value).success, name).toBe(false)
    }
    expect(
      S.BatchSameRequestSchema.safeParse({
        ids: [1],
        set: {},
        appendDescription: 'b',
      }).success,
    ).toBe(true)
    expect(
      S.EditRequestSchema.safeParse({
        ops: [],
        scale: { width: 10, height: 5 },
        applyTo: 'all',
        expectedModified: at,
      }).success,
    ).toBe(true)
  })
})
