import type { Page } from '@playwright/test'
import { stackEnv } from './env.ts'
import { expect } from './fixtures.ts'

// Logs the page's browser context in to the app (the live project), the same
// way the login form does: POST `session` at the app root. The URL is relative
// to the project's baseURL, so it works under any mount path, and the session
// cookie lands in the context the page uses.
export async function logIn(page: Page): Promise<void> {
  const { loginUser, loginPassword } = stackEnv()
  const response = await page.request.post('session', {
    data: { username: loginUser, password: loginPassword },
  })
  expect(response.status(), 'log in through POST session').toBe(200)
}
