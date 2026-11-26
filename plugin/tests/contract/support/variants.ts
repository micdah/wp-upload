// Switches the dev stack's variants (FileBird off, per-user mode, MEDIA_TRASH, Visual
// Portfolio off, the app user's role) and runs WP-CLI.
//
// - Variants: on the host through `dev/run variant` (needs Docker); inside the runner
//   (`dev/run test plugin-contract`), which has no Docker, through the dev mu-plugin's
//   `wpu-dev/v1/variant` REST route as the app user (P1 CR-1, CR-P2-2).
// - PHP (`wpEval`): through the dev mu-plugin's admin-only `wpu-dev/v1/eval` route whenever the
//   stack gives an administrator app password (WPU_ADMIN_APP_PASSWORD), on the host and in the
//   runner alike, so both run the same way; `dev/run wp eval` is the fallback on the host.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Credentials } from './env.ts'
import { env, REPO_ROOT } from './env.ts'
import type { Client } from './http.ts'
import { client, editor } from './http.ts'

const DEV_RUN = join(REPO_ROOT, 'dev', 'run')
const VARIANT_ROUTE = `${env.wpUrl}/wp-json/wpu-dev/v1/variant`
const EVAL_ROUTE = `${env.wpUrl}/wp-json/wpu-dev/v1/eval`

export interface Variant {
  trash?: 'on' | 'off'
  filebird?: 'on' | 'off'
  peruser?: 'on' | 'off'
  vp?: 'on' | 'off'
  role?: 'editor' | 'author'
}

export const DEFAULT_VARIANT: Required<Variant> = {
  trash: 'off',
  filebird: 'on',
  peruser: 'off',
  vp: 'on',
  role: 'editor',
}

function variantsDisabled(): boolean {
  return process.env.WPU_CONTRACT_VARIANTS === 'off'
}

function dockerAvailable(): boolean {
  if (variantsDisabled() || !existsSync(DEV_RUN) || env.mode === null) {
    return false
  }
  const result = spawnSync(
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    {
      stdio: 'ignore',
    },
  )
  return result.status === 0
}

/**
 * Sends one request to a dev mu-plugin route and returns its JSON. Synchronous (a child Node
 * process does the fetch), so callers switch variants and run PHP the same way on the host and
 * in the runner, including from `beforeAll` and inside tests without awaiting. A non-2xx answer
 * throws with its status and body.
 */
function callDevRoute(
  route: string,
  credentials: Credentials,
  body: object | null,
): unknown {
  const script = `
    const [url, user, password, body] = process.argv.slice(1)
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(user + ':' + password).toString('base64'),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body || undefined,
    })
    const text = await response.text()
    if (!response.ok) {
      console.error(response.status + ' ' + text)
      process.exit(1)
    }
    process.stdout.write(text)
  `
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      script,
      route,
      credentials.user,
      credentials.password,
      body ? JSON.stringify(body) : '',
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  return JSON.parse(output)
}

function callVariantRoute(body: Variant | null): Record<string, string> {
  return callDevRoute(VARIANT_ROUTE, env.editor, body) as Record<string, string>
}

function callEvalRoute(php: string): string {
  if (!env.admin) {
    throw new Error('No administrator app password (WPU_ADMIN_APP_PASSWORD).')
  }
  const reply = callDevRoute(EVAL_ROUTE, env.admin, { php }) as {
    output: string
  }
  return reply.output
}

function variantRouteAvailable(): boolean {
  if (variantsDisabled()) {
    return false
  }
  try {
    callVariantRoute(null)
    return true
  } catch {
    return false
  }
}

function evalRouteAvailable(): boolean {
  if (variantsDisabled() || !env.admin) {
    return false
  }
  try {
    return callEvalRoute('echo "ok";') === 'ok'
  } catch {
    return false
  }
}

const useDocker = dockerAvailable()
const useEvalRoute = evalRouteAvailable()

/**
 * Whether PHP can run inside WordPress from where the tests run: the eval route (host and
 * runner), else `dev/run wp eval` (the host, with Docker).
 */
export const wpEvalAvailable = useEvalRoute || useDocker

/** Whether variants can be switched from where the tests run. */
export const variantsAvailable = useDocker || variantRouteAvailable()

export const SKIP_REASON =
  'needs `dev/run variant` or the dev stack variant route'

export const WP_EVAL_SKIP_REASON =
  'needs the dev stack eval route (WPU_ADMIN_APP_PASSWORD) or `dev/run wp eval`'

function devRun(args: string[]): string {
  return execFileSync(DEV_RUN, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, WPU_MODE: env.mode ?? 'dev' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function setVariant(variant: Variant): void {
  if (!variantsAvailable) {
    throw new Error(SKIP_REASON)
  }
  if (useDocker) {
    const pairs = Object.entries(variant).map(
      ([key, value]) => `${key}=${value}`,
    )
    devRun(['variant', ...pairs])
    return
  }
  callVariantRoute(variant)
}

export function resetVariant(): void {
  setVariant(DEFAULT_VARIANT)
}

/** Runs PHP inside WordPress (as `wp eval` does), returning its output. */
export function wpEval(php: string): string {
  if (useEvalRoute) {
    return callEvalRoute(php).trim()
  }
  if (!useDocker) {
    throw new Error(WP_EVAL_SKIP_REASON)
  }
  return devRun(['wp', 'eval', php]).trim()
}

/** Runs PHP inside WordPress and parses the JSON it printed on its last line. */
export function wpEvalJson(php: string): unknown {
  const lines = wpEval(php).split('\n')
  return JSON.parse(lines[lines.length - 1] ?? 'null')
}

/** Whether Author tests can run: a separate Author user, or role switching. */
export const authorAvailable = env.author !== null || variantsAvailable

/**
 * Runs `test` as an Author: the stack's separate Author user (D26) when there
 * is one, else the app user switched to the author role and back.
 */
export async function asAuthor<T>(
  test: (author: Client) => Promise<T>,
): Promise<T> {
  if (env.author) {
    return test(client(env.author))
  }
  setVariant({ role: 'author' })
  try {
    return await test(editor)
  } finally {
    setVariant({ role: 'editor' })
  }
}
