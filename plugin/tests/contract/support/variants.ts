// Switches the dev stack's variants (FileBird off, per-user mode, MEDIA_TRASH, Visual
// Portfolio off, the app user's role) and runs WP-CLI.
//
// - On the host, through `dev/run variant` and `dev/run wp eval` (needs Docker).
// - Inside the runner (`dev/run test plugin-contract`), which has no Docker, variants go through
//   the dev mu-plugin's `wpu-dev/v1/variant` REST route as the app user (P1 CR-1, CR-P2-2).
//   `wp eval` has no such route, so the tests that need it are skipped there (they say so).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { env, REPO_ROOT } from './env.ts'
import type { Client } from './http.ts'
import { client, editor } from './http.ts'

const DEV_RUN = join(REPO_ROOT, 'dev', 'run')
const VARIANT_ROUTE = `${env.wpUrl}/wp-json/wpu-dev/v1/variant`

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
 * Sends one request to the variant route and returns its JSON. Synchronous (a child Node
 * process does the fetch), so callers switch variants the same way on the host and in the
 * runner, including from `beforeAll` and inside tests without awaiting.
 */
function callVariantRoute(body: Variant | null): Record<string, string> {
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
      VARIANT_ROUTE,
      env.editor.user,
      env.editor.password,
      body ? JSON.stringify(body) : '',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  return JSON.parse(output) as Record<string, string>
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

const useDocker = dockerAvailable()

/** Whether `wp eval` can run from where the tests run (the host, with Docker). */
export const wpEvalAvailable = useDocker

/** Whether variants can be switched from where the tests run. */
export const variantsAvailable = useDocker || variantRouteAvailable()

export const SKIP_REASON =
  'needs `dev/run variant` or the dev stack variant route'

export const WP_EVAL_SKIP_REASON =
  'needs `dev/run wp eval` (Docker on the host); skipped in the runner'

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

/** Runs PHP inside WordPress (`wp eval`), returning its output. */
export function wpEval(php: string): string {
  if (!wpEvalAvailable) {
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
