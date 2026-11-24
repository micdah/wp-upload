// POST /maintenance/step and the media index lifecycle (plugin-api.md §5.21,
// §8.1, §9.2-9.3).
import { describe, expect, it } from 'vitest'
import { PluginMaintenanceResponseSchema } from '../../../shared/library-api.schema.ts'
import { anonymous, editor, PLUGIN } from './support/http.ts'
import {
  collection,
  ensureMediaIndexReady,
  expectError,
  folderTree,
  info,
  parse,
} from './support/library.ts'
import { makePng, plugin, rest, upload } from './support/p2.ts'
import {
  WP_EVAL_SKIP_REASON,
  wpEval,
  wpEvalAvailable,
  wpEvalJson,
} from './support/variants.ts'

async function step(body: unknown = {}) {
  const reply = await editor.post(`${PLUGIN}/maintenance/step`, body)
  expect(reply.status, JSON.stringify(reply.body).slice(0, 300)).toBe(200)
  return parse(PluginMaintenanceResponseSchema, reply.body)
}

describe('POST /maintenance/step', () => {
  it('does nothing visible once the media index is ready', async () => {
    await ensureMediaIndexReady()
    const first = await step()
    const second = await step({ budgetMs: 100 })
    expect(second.locked).toBe(false)
    expect(second.did.media).toBe(0)
    expect(second.did.folders).toBe(0)
    expect(second.rev).toBe(first.rev)
    expect(second.index.media).toMatchObject({ state: 'ready' })
    expect(second.more).toBe(second.index.usage.state !== 'ready')
  })

  it('accepts an empty body', async () => {
    const reply = await editor.raw('POST', `${PLUGIN}/maintenance/step`, '')
    expect(reply.status).toBe(200)
  })

  it('validates budgetMs and rejects unknown fields', async () => {
    for (const body of [
      { budgetMs: 99 },
      { budgetMs: 20001 },
      { budgetMs: '500' },
      { budgetMs: 1.5 },
      { other: 1 },
    ]) {
      expectError(
        await editor.post(`${PLUGIN}/maintenance/step`, body),
        400,
        'wpu_invalid_param',
      )
    }
    expectError(
      await anonymous.post(`${PLUGIN}/maintenance/step`, {}),
      403,
      'wpu_forbidden',
    )
  })

  it('lets only one step run at a time', async () => {
    const replies = await Promise.all(
      Array.from({ length: 4 }, () => step({ budgetMs: 500 })),
    )
    for (const reply of replies) {
      expect(reply.locked === true || reply.locked === false).toBe(true)
      if (reply.locked) {
        expect(reply.did).toEqual({ media: 0, usage: 0, folders: 0 })
      }
    }
  })
})

describe.skipIf(!wpEvalAvailable)(
  `the media index lifecycle (${WP_EVAL_SKIP_REASON})`,
  () => {
    it('reconciles a stale index in budgeted steps and keeps the collection identical', async () => {
      const before = await collection()
      wpEval('WpUpload\\Companion\\Index\\MediaIndex::mark_stale();')
      const stale = await info()
      expect(stale.index.media.state).toBe('stale')

      const first = await step({ budgetMs: 100 })
      expect(first.did.media).toBeGreaterThan(0)
      await ensureMediaIndexReady()
      const after = await collection()
      expect(after.indexComplete).toBe(true)
      expect(after.rows).toEqual(before.rows)
    })

    it('backfills from an empty table after a schema reset', async () => {
      const before = await collection({ sort: 'size-desc' })
      wpEval(
        "global $wpdb; $wpdb->query( 'DROP TABLE ' . $wpdb->prefix . 'wpu_media_index' ); delete_option( 'wpu_media_index_db_version' ); delete_option( 'wpu_media_index_state' );",
      )
      const building = await info()
      expect(building.index.media.state).toBe('building')
      expect(building.index.media.total).toBe(before.total)
      const during = await collection({ sort: 'size-desc' })
      expect(during.indexComplete).toBe(false)
      expect(during.total).toBe(before.total)

      await ensureMediaIndexReady()
      expect((await collection({ sort: 'size-desc' })).rows).toEqual(
        before.rows,
      )
    })

    it('detects changes made behind its back (/info consistency check)', async () => {
      await ensureMediaIndexReady()
      wpEval(
        "global $wpdb; $wpdb->query( 'DELETE FROM ' . $wpdb->prefix . 'wpu_media_index ORDER BY attachment_id DESC LIMIT 1' ); delete_transient( 'wpu_media_index_check' );",
      )
      expect((await info()).index.media.state).toBe('stale')
      await ensureMediaIndexReady()
      expect((await info()).index.media.state).toBe('ready')
    })

    it('stays ready with a future-dated attachment, and never re-picks its row', async () => {
      await ensureMediaIndexReady()
      const saved = wpEvalJson(
        `global $wpdb; echo wp_json_encode( $wpdb->get_row( "SELECT ID, post_modified, post_modified_gmt FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_status = 'inherit' ORDER BY ID ASC LIMIT 1", ARRAY_A ) );`,
      ) as { ID: string; post_modified: string; post_modified_gmt: string }
      const setModified = (local: string, gmt: string) =>
        wpEval(
          `global $wpdb; $wpdb->update( $wpdb->posts, array( 'post_modified' => '${local}', 'post_modified_gmt' => '${gmt}' ), array( 'ID' => ${saved.ID} ) ); clean_post_cache( ${saved.ID} ); delete_transient( 'wpu_media_index_check' );`,
        )
      try {
        // Changed behind the index's back, a year ahead: one reconcile picks it up...
        setModified('2099-01-01 00:00:00', '2099-01-01 00:00:00')
        expect((await info()).index.media.state).toBe('stale')
        await ensureMediaIndexReady()

        // ...and after that the check (run uncached) keeps finding the index consistent.
        for (let round = 0; round < 2; round++) {
          wpEval("delete_transient( 'wpu_media_index_check' );")
          expect((await info()).index.media.state).toBe('ready')
          const again = await step({ budgetMs: 100 })
          expect(again.index.media.state).toBe('ready')
          expect(again.did.media).toBe(0)
        }

        // A building pass only takes missing and outdated rows: none.
        const building = wpEvalJson(
          `$state = WpUpload\\Companion\\Index\\MediaIndex::state(); $state['state'] = 'building'; $state['cursor'] = 0; update_option( 'wpu_media_index_state', $state, true ); echo wp_json_encode( WpUpload\\Companion\\Index\\MediaIndex::step( microtime( true ) + 10 ) );`,
        ) as { did: number }
        expect(building.did).toBe(0)
        expect((await info()).index.media.state).toBe('ready')
      } finally {
        setModified(saved.post_modified, saved.post_modified_gmt)
        await ensureMediaIndexReady()
      }
    })

    it('keeps up with image operations that change only post_modified', async () => {
      const image = await upload(
        'maintenance-regenerate.png',
        makePng(640, 480),
        'image/png',
      )
      await ensureMediaIndexReady()
      // Regenerating writes the same metadata again (no meta hook fires) and touches
      // post_modified directly; the row must follow, or the uncached check calls it stale.
      for (let round = 0; round < 2; round++) {
        const reply = await plugin('POST', `/media/${image.id}/regenerate`, {
          body: {},
        })
        expect(reply.status, JSON.stringify(reply.json)).toBe(200)
        wpEval("delete_transient( 'wpu_media_index_check' );")
        expect((await info()).index.media.state).toBe('ready')
      }
      await rest('DELETE', `/wp/v2/media/${image.id}?force=true`)
    })

    it('rebuilds rows of an older format after a schema upgrade', async () => {
      await ensureMediaIndexReady()
      wpEval(
        "global $wpdb; $wpdb->query( 'UPDATE ' . $wpdb->prefix . 'wpu_media_index SET row_version = 1, modified_gmt = NULL' ); update_option( 'wpu_media_index_db_version', '1' );",
      )
      expect((await info()).index.media.state).toBe('building')
      await ensureMediaIndexReady()
      const left = wpEval(
        "global $wpdb; echo (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . $wpdb->prefix . 'wpu_media_index WHERE row_version < 2 OR modified_gmt IS NULL' );",
      )
      expect(left).toBe('0')
    })

    it('makes progress in every step, saving its cursor per sub-batch', () => {
      // A deadline already past: the first sub-batch still runs and is recorded.
      const result = wpEvalJson(
        `use WpUpload\\Companion\\Index\\MediaIndex;
        MediaIndex::mark_stale();
        $first = MediaIndex::step( microtime( true ) - 1 );
        $after_first = MediaIndex::state()['cursor'];
        $second = MediaIndex::step( microtime( true ) - 1 );
        $after_second = MediaIndex::state()['cursor'];
        global $wpdb;
        $ids = array_map( 'intval', $wpdb->get_col( "SELECT ID FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_status <> 'auto-draft' ORDER BY ID ASC LIMIT 40" ) );
        echo wp_json_encode( array( 'first' => $first['did'], 'second' => $second['did'], 'cursors' => array( $after_first, $after_second ), 'ids' => $ids ) );`,
      ) as {
        first: number
        second: number
        cursors: [number, number]
        ids: number[]
      }
      const subBatch = Math.min(20, result.ids.length)
      expect(result.first).toBe(subBatch)
      expect(result.cursors[0]).toBe(result.ids[subBatch - 1])
      if (result.ids.length > 20) {
        expect(result.second).toBe(Math.min(20, result.ids.length - 20))
        expect(result.cursors[1]).toBeGreaterThan(result.cursors[0])
      }
    })

    it('counts PDF pages, reading only both ends of a large PDF', async () => {
      await ensureMediaIndexReady()
      const pdfs = await editor.get('/wp/v2/media', {
        mime_type: 'application/pdf',
        _fields: 'id,wpu',
        per_page: 100,
      })
      expect(pdfs.status).toBe(200)
      expect(pdfs.body.length).toBeGreaterThan(0)
      // The seed's sample.pdf has one page.
      expect(
        pdfs.body.some((item: { wpu: { pages: number | null } }) => {
          return item.wpu.pages === 1
        }),
      ).toBe(true)

      const counts = wpEvalJson(
        `$method = new ReflectionMethod( WpUpload\\Companion\\Index\\MediaIndex::class, 'pdf_pages' );
        $method->setAccessible( true );
        $dir = get_temp_dir();
        $padding = str_repeat( "% padding\\n", 300000 );
        $objects = str_repeat( "9 0 obj << /Type /Page >> endobj\\n", 50 );
        $files = array(
          'small' => "%PDF-1.4\\n1 0 obj << /Type /Pages /Count 2 >> endobj\\n2 0 obj << /Type /Page >> endobj\\n3 0 obj << /Type /Page >> endobj\\n%%EOF\\n",
          'head' => "%PDF-1.4\\n1 0 obj << /Type /Pages /Count 7 >> endobj\\n" . $objects . $padding . $padding . "%%EOF\\n",
          'tail' => "%PDF-1.4\\n" . $objects . $padding . $padding . "1 0 obj << /Type /Pages /Count 9 >> endobj\\n%%EOF\\n",
          'middle' => "%PDF-1.4\\n" . $padding . "1 0 obj << /Type /Pages /Count 5 >> endobj\\n" . $padding . "%%EOF\\n",
        );
        $result = array();
        foreach ( $files as $name => $content ) {
          $path = $dir . 'wpu-pdf-pages-' . $name . '.pdf';
          file_put_contents( $path, $content );
          $result[ $name ] = $method->invoke( null, $path );
          unlink( $path );
        }
        echo wp_json_encode( $result );`,
      )
      expect(counts).toEqual({ small: 2, head: 7, tail: 9, middle: null })
    })

    it('leaves a maintenance lock it doesn’t hold in place', async () => {
      const someoneElse = `${Math.floor(Date.now() / 1000) + 60}:someoneelse`
      wpEval(
        `global $wpdb; $wpdb->query( $wpdb->prepare( "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES ('wpu_maintenance_lock', %s, 'off') ON DUPLICATE KEY UPDATE option_value = VALUES(option_value)", '${someoneElse}' ) );`,
      )
      try {
        const reply = await step({ budgetMs: 100 })
        expect(reply.locked).toBe(true)
        expect(
          wpEval(
            `global $wpdb; echo $wpdb->get_var( "SELECT option_value FROM {$wpdb->options} WHERE option_name = 'wpu_maintenance_lock'" );`,
          ),
        ).toBe(someoneElse)
      } finally {
        wpEval(
          `global $wpdb; $wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name = 'wpu_maintenance_lock'" );`,
        )
      }
      // An expired lock (also in the old `<expiry>` format) is taken over and released.
      wpEval(
        `global $wpdb; $wpdb->query( "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES ('wpu_maintenance_lock', '1000', 'off')" );`,
      )
      expect((await step({ budgetMs: 100 })).locked).toBe(false)
      expect(
        wpEval(
          `global $wpdb; echo (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name = 'wpu_maintenance_lock'" );`,
        ),
      ).toBe('0')
    })

    it('repairs the folder column when FileBird changed without hooks', async () => {
      await ensureMediaIndexReady()
      const tree = await folderTree()
      const folder = tree.folders.find((candidate) => candidate.count > 0)
      expect(folder).toBeDefined()
      wpEval(
        `global $wpdb; $wpdb->query( $wpdb->prepare( 'UPDATE ' . $wpdb->prefix . 'wpu_media_index SET folder_id = 0 WHERE folder_id = %d', ${folder?.id} ) );`,
      )
      expect((await collection({ folder: folder?.id ?? 0 })).total).toBe(0)
      const repaired = await step()
      expect(repaired.did.folders).toBe(folder?.count)
      expect((await collection({ folder: folder?.id ?? 0 })).total).toBe(
        folder?.count,
      )
    })

    it('marks the index stale on deactivation, and reconciles after reactivation', async () => {
      const { install } = await info()
      if (install !== 'plugin') {
        return
      }
      const before = await editor.get(`${PLUGIN}/rev`)
      wpEval(
        "deactivate_plugins( 'wp-upload-companion/wp-upload-companion.php' ); activate_plugin( 'wp-upload-companion/wp-upload-companion.php' );",
      )
      const after = await info()
      expect(after.index.media.state).toBe('stale')
      expect(BigInt(after.rev)).toBeGreaterThan(BigInt(before.body.rev))
      await ensureMediaIndexReady()
    })

    it('removes its tables and options on uninstall, and starts over on reinstall', async () => {
      const { install } = await info()
      if (install !== 'plugin') {
        return
      }
      const file = 'wp-upload-companion/wp-upload-companion.php'
      const leftovers = wpEval(
        `deactivate_plugins( '${file}' ); uninstall_plugin( '${file}' ); global $wpdb; echo json_encode( array( 'tables' => $wpdb->get_col( "SHOW TABLES LIKE '%wpu_media_index%'" ), 'options' => $wpdb->get_col( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE 'wpu\\\\_%' AND option_name NOT LIKE 'wpu\\\\_dev\\\\_%'" ) ) );`,
      )
      expect(JSON.parse(leftovers)).toEqual({ tables: [], options: [] })
      wpEval(`activate_plugin( '${file}' );`)
      const reinstalled = await info()
      expect(reinstalled.index.media.state).toBe('building')
      await ensureMediaIndexReady()
      expect((await info()).index.media.state).toBe('ready')
    })
  },
)
