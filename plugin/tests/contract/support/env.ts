// Where the contract tests find WordPress and its users.
//
// In the runner (`dev/run test plugin-contract`) the stack's env vars are set:
// WPU_WP_URL, WPU_APP_USER, WPU_APP_PASSWORD (the Editor app user) and, once
// track D's M1 lands (D26), WPU_AUTHOR_USER and WPU_AUTHOR_APP_PASSWORD.
//
// On the host (`npx vitest run --config plugin/vitest.config.ts`) they fall
// back to dev/.state/<mode>/stack.env of this worktree's running stack, where
// <mode> is WPU_MODE or the mode of the last `dev/run up`. Only `dev` mode is
// reachable from the host without extra DNS setup.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

export interface Credentials {
  user: string
  password: string
}

export interface TestEnv {
  wpUrl: string
  editor: Credentials
  /** a separate Author app user (D26), when the stack provides one */
  author: Credentials | null
  /** the stack mode, for `dev/run variant` on the host */
  mode: string | null
}

function readStackEnv(mode: string): Record<string, string> {
  const path = join(REPO_ROOT, 'dev', '.state', mode, 'stack.env')
  if (!existsSync(path)) {
    return {}
  }
  const values: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)='(.*)'$/)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      values[match[1]] = match[2]
    }
  }
  return values
}

function activeMode(): string | null {
  if (process.env.WPU_MODE) {
    return process.env.WPU_MODE
  }
  const path = join(REPO_ROOT, 'dev', '.state', 'active-mode')
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null
}

function resolveEnv(): TestEnv {
  const mode = activeMode()
  const stack = process.env.WPU_WP_URL ? {} : readStackEnv(mode ?? 'dev')
  const wpUrl = process.env.WPU_WP_URL ?? stack.WPU_SITE_URL
  const user = process.env.WPU_APP_USER ?? stack.WPU_APP_USER
  const password = process.env.WPU_APP_PASSWORD ?? stack.WPU_APP_PASSWORD
  if (!wpUrl || !user || !password) {
    throw new Error(
      'No WordPress to test against: set WPU_WP_URL, WPU_APP_USER and WPU_APP_PASSWORD, or run `dev/run up dev` first.',
    )
  }
  const authorUser = process.env.WPU_AUTHOR_USER ?? stack.WPU_AUTHOR_USER
  const authorPassword =
    process.env.WPU_AUTHOR_APP_PASSWORD ?? stack.WPU_AUTHOR_APP_PASSWORD
  return {
    wpUrl: wpUrl.replace(/\/+$/, ''),
    editor: { user, password },
    author:
      authorUser && authorPassword
        ? { user: authorUser, password: authorPassword }
        : null,
    mode,
  }
}

export const env = resolveEnv()
