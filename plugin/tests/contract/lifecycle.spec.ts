// The plugin's lifecycle hooks when the plugin is managed through core's REST API
// (`/wp/v2/plugins`) rather than wp-admin or WP-CLI (plugin-api.md §9.3).
//
// Needs an Administrator: the test creates a temporary Application Password for one
// through `wp eval`, so it runs on the host only.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PLUGIN } from './support/http.ts'
import { ensureMediaIndexReady, info } from './support/library.ts'
import { type Credentials, rest } from './support/p2.ts'
import {
  WP_EVAL_SKIP_REASON,
  wpEval,
  wpEvalAvailable,
  wpEvalJson,
} from './support/variants.ts'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const PLUGIN_FILE = 'wp-upload-companion/wp-upload-companion.php'
const PLUGIN_ID = 'wp-upload-companion/wp-upload-companion'

interface TemporaryAdmin extends Credentials {
  id: number
  uuid: string
}

describe.skipIf(!wpEvalAvailable)(
  `deactivation through core's REST API (${WP_EVAL_SKIP_REASON})`,
  () => {
    let admin: TemporaryAdmin

    beforeAll(() => {
      admin = wpEvalJson(`
        $admins  = get_users( array( 'role' => 'administrator', 'number' => 1 ) );
        $created = WP_Application_Passwords::create_new_application_password( $admins[0]->ID, array( 'name' => 'wpu-contract-lifecycle' ) );
        echo wp_json_encode( array( 'id' => $admins[0]->ID, 'user' => $admins[0]->user_login, 'password' => $created[0], 'uuid' => $created[1]['uuid'] ) );
      `) as TemporaryAdmin
    })

    afterAll(() => {
      // Whatever happened, leave the plugin active and the password gone.
      wpEval(
        `if ( ! is_plugin_active( '${PLUGIN_FILE}' ) ) { activate_plugin( '${PLUGIN_FILE}' ); } WP_Application_Passwords::delete_application_password( ${admin.id}, '${admin.uuid}' );`,
      )
    })

    it('marks the index stale when the plugin is deactivated over REST (P-9)', async () => {
      const { install } = await info()
      if (install !== 'plugin') {
        return
      }
      await ensureMediaIndexReady()
      const before = await rest('GET', `${PLUGIN}/rev`)
      expect(before.status).toBe(200)

      const off = await rest('POST', `/wp/v2/plugins/${PLUGIN_ID}`, {
        as: admin,
        body: { status: 'inactive' },
      })
      expect(off.status, JSON.stringify(off.json).slice(0, 300)).toBe(200)
      expect(off.json.status).toBe('inactive')
      const on = await rest('POST', `/wp/v2/plugins/${PLUGIN_ID}`, {
        as: admin,
        body: { status: 'active' },
      })
      expect(on.status, JSON.stringify(on.json).slice(0, 300)).toBe(200)

      const after = await info()
      expect(after.index.media.state).toBe('stale')
      expect(BigInt(after.rev)).toBeGreaterThan(BigInt(before.json.rev))
      await ensureMediaIndexReady()
      expect((await info()).index.media.state).toBe('ready')
    })
  },
)
