// The env `dev/run` gives the runner in test mode (docs/media-manager/tracks/
// D-handoff.md §5 and D-m1-handoff.md). Read it through here, so a spec run
// outside dev/run fails with a message instead of a confusing timeout.

export type StackEnv = {
  appUrl: string
  mockUrl: string
  wordpressUrl: string
  // The app's own login (the session cookie), not a WordPress account.
  loginUser: string
  loginPassword: string
  // The Editor app user (switchable with `dev/run variant role=...`).
  appUser: string
  appPassword: string
  // The separate Author user (D26).
  authorUser: string
  authorPassword: string
  adminUser: string
  adminPassword: string
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} isn't set. Run the e2e suites through 'dev/run test e2e-mock' or 'dev/run test e2e-live'.`,
    )
  }
  return value
}

export function stackEnv(): StackEnv {
  return {
    appUrl: required('WPU_APP_URL'),
    mockUrl: required('WPU_MOCK_URL'),
    wordpressUrl: required('WPU_WP_URL'),
    loginUser: required('WPU_LOGIN_USER'),
    loginPassword: required('WPU_LOGIN_PASSWORD'),
    appUser: required('WPU_APP_USER'),
    appPassword: required('WPU_APP_PASSWORD'),
    authorUser: required('WPU_AUTHOR_USER'),
    authorPassword: required('WPU_AUTHOR_APP_PASSWORD'),
    adminUser: required('WPU_ADMIN_USER'),
    adminPassword: required('WPU_ADMIN_PASSWORD'),
  }
}
