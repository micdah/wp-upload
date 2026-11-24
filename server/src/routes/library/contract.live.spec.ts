import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll } from 'vitest'
import { defineLibraryContract } from '../../../../client/src/media-manager/mocks/contract/checks.ts'
import { app } from '../../app.ts'
import { env } from '../../config/env.ts'
import { maintenanceIdle } from './bootstrap.ts'

// Track F2's shared contract suite (CR-F2-5) against the real server: the
// same checks the client's fake passes (fake.contract.spec.ts) run here
// against this server, talking to the live stack's WordPress and plugin, so
// the mock and the server can't drift apart.
//
// The whole app (session, /api guard, library router) listens on an
// ephemeral port; the suite logs in once and sends the session cookie with
// every call. Without WPU_LIVE (only vitest.live.config.ts sets it) the
// checks would need a WordPress, so the file registers nothing.

const live = process.env.WPU_LIVE === '1'

let server: Server | null = null
let baseUrl = ''
let cookie = ''

beforeAll(async () => {
  if (!live) return
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}/`
})

afterAll(async () => {
  if (!server) return
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  // Let the maintenance loop the suite's bootstrap started settle, but never
  // wait forever: against a plugin whose usage index is a stub, `more` stays
  // true and the loop never ends (P1 handoff §3).
  await Promise.race([
    maintenanceIdle(),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ])
})

async function logIn(): Promise<void> {
  const login = await fetch(new URL('session', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: env.authUsername,
      password: env.authPassword,
    }),
  })
  if (!login.ok) {
    throw new Error(`Logging in to the server failed: ${login.status}`)
  }
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
}

async function liveFetch(path: string, init: RequestInit = {}) {
  if (!cookie) await logIn()
  const headers = new Headers(init.headers)
  headers.set('Cookie', cookie)
  return fetch(new URL(`api/library/${path}`, baseUrl), { ...init, headers })
}

if (live) {
  defineLibraryContract({ name: 'live', fetch: liveFetch, mutations: true })
}
