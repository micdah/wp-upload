// GET /rev and the library revision (plugin-api.md §5.1, §6).
import { describe, expect, it } from 'vitest'
import {
  FolderMutationResponseSchema,
  RevResponseSchema,
} from '../../../shared/library-api.schema.ts'
import { anonymous, editor, PLUGIN } from './support/http.ts'
import { expectError, ids, parse } from './support/library.ts'
import {
  WP_EVAL_SKIP_REASON,
  wpEvalAvailable,
  wpEvalJson,
} from './support/variants.ts'

async function rev(): Promise<bigint> {
  const reply = await editor.get(`${PLUGIN}/rev`)
  expect(reply.status).toBe(200)
  return BigInt(parse(RevResponseSchema, reply.body).rev)
}

describe('GET /rev', () => {
  it('answers {rev, index} and is stable while nothing changes', async () => {
    const reply = await editor.get(`${PLUGIN}/rev`)
    expect(reply.status).toBe(200)
    const body = parse(RevResponseSchema, reply.body)
    expect(body.index.media.state).toBe('ready')
    expect(await rev()).toBe(BigInt(body.rev))
  })

  it('answers 403 wpu_forbidden (not 401) without credentials', async () => {
    expectError(await anonymous.get(`${PLUGIN}/rev`), 403, 'wpu_forbidden')
  })

  it('goes up when an attachment changes through core (alt text, title)', async () => {
    const [id] = await ids()
    const before = await editor.get(`/wp/v2/media/${id}`, { context: 'edit' })
    expect(before.status).toBe(200)
    const originalAlt: string = before.body.alt_text
    const originalTitle: string = before.body.title.raw

    const start = await rev()
    const altChange = await editor.post(`/wp/v2/media/${id}`, {
      alt_text: `${originalAlt} rev test`,
    })
    expect(altChange.status).toBe(200)
    const afterAlt = await rev()
    expect(afterAlt).toBeGreaterThan(start)

    const titleChange = await editor.post(`/wp/v2/media/${id}`, {
      title: `${originalTitle} rev test`,
    })
    expect(titleChange.status).toBe(200)
    const afterTitle = await rev()
    expect(afterTitle).toBeGreaterThan(afterAlt)

    const restore = await editor.post(`/wp/v2/media/${id}`, {
      alt_text: originalAlt,
      title: originalTitle,
    })
    expect(restore.status).toBe(200)
    expect(await rev()).toBeGreaterThan(afterTitle)
  })

  it('does not change on reads', async () => {
    const start = await rev()
    await editor.get(`${PLUGIN}/collection`)
    await editor.get(`${PLUGIN}/facets`)
    await editor.get(`${PLUGIN}/folders`)
    await editor.get('/wp/v2/media', { per_page: 20, _fields: 'id,wpu' })
    expect(await rev()).toBe(start)
  })

  it('bumps atomically: concurrent mutations each report a distinct, newer rev', async () => {
    const start = await rev()
    const replies = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        editor.post(`${PLUGIN}/folders`, {
          name: `rev race ${index}`,
          parent: 0,
        }),
      ),
    )
    const created: number[] = []
    try {
      const revs = replies.map((reply) => {
        expect(reply.status, JSON.stringify(reply.body).slice(0, 300)).toBe(201)
        const body = parse(FolderMutationResponseSchema, reply.body)
        created.push(body.folder.id)
        return body.rev
      })
      expect(new Set(revs).size).toBe(revs.length)
      for (const value of revs) {
        expect(BigInt(value)).toBeGreaterThan(start)
      }
    } finally {
      for (const id of created) {
        await editor.del(`${PLUGIN}/folders/${id}`)
      }
    }
  })
})

describe.skipIf(!wpEvalAvailable)(
  `a missing wpu_rev option (${WP_EVAL_SKIP_REASON})`,
  () => {
    it('is recreated once, even when a stale options cache claims it exists (P-6)', () => {
      // add_option() trusts the cache, so the old code recursed forever here.
      const result = wpEvalJson(`
        global $wpdb;
        $old = $wpdb->get_var( "SELECT option_value FROM {$wpdb->options} WHERE option_name = 'wpu_rev'" );
        $wpdb->delete( $wpdb->options, array( 'option_name' => 'wpu_rev' ) );
        wp_cache_set( 'wpu_rev', '5', 'options' );
        $rev    = WpUpload\\Companion\\Rev::current();
        $stored = $wpdb->get_var( "SELECT option_value FROM {$wpdb->options} WHERE option_name = 'wpu_rev'" );
        // Never let the rev go backwards for the tests that run after this one.
        $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = GREATEST(CAST(option_value AS UNSIGNED), %d) WHERE option_name = 'wpu_rev'", (int) $old ) );
        echo wp_json_encode( array( 'rev' => $rev, 'stored' => $stored ) );
      `) as { rev: string; stored: string | null }
      expect(result.stored).not.toBeNull()
      expect(result.rev).toBe(result.stored)
      expect(result.rev).toMatch(/^[1-9][0-9]{12,}$/)
    })
  },
)
