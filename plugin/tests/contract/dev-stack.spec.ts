// The dev stack's own test hook, not the plugin's contract: the dev mu-plugin's
// `POST /wpu-dev/v1/eval` (dev/wordpress/mu-plugins/wpu-dev.php), which lets the
// runner run the PHP-level checks that used to need `dev/run wp eval` on the host.
// It runs arbitrary PHP, so only an administrator may call it.
import { describe, expect, it } from 'vitest'
import { env } from './support/env.ts'
import { type Credentials, rest } from './support/p2.ts'

const admin = env.admin

async function evalAs(as: Credentials | null, php: string) {
  return rest('POST', '/wpu-dev/v1/eval', { body: { php }, as })
}

describe.skipIf(admin === null)('the dev stack eval route', () => {
  it('runs PHP as wp eval does, for an administrator', async () => {
    const reply = await evalAs(
      admin,
      "echo wp_json_encode( array( get_current_user_id(), function_exists( 'is_plugin_active' ) ) );",
    )
    expect(reply.status).toBe(200)
    // No current user (as `wp eval` without --user), and the admin includes loaded.
    expect(JSON.parse(reply.json.output)).toEqual([0, true])
  })

  it('answers 500 with the message and the output so far when the code throws', async () => {
    const reply = await evalAs(
      admin,
      "echo 'before'; throw new RuntimeException( 'boom' );",
    )
    expect(reply.status).toBe(500)
    expect(reply.json.code).toBe('wpu_dev_eval_failed')
    expect(reply.json.message).toContain('RuntimeException: boom')
    expect(reply.json.data.output).toBe('before')
  })

  it('refuses the app user, the Author and anonymous requests', async () => {
    const php = "echo 'ran';"
    expect((await evalAs(env.editor, php)).status).toBe(403)
    if (env.author) {
      expect((await evalAs(env.author, php)).status).toBe(403)
    }
    expect((await evalAs(null, php)).status).toBe(401)
  })
})
