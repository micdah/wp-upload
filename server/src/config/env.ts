import dotenv from 'dotenv'

dotenv.config()

const REQUIRED_VARS = [
  'WP_URL',
  'WP_USERNAME',
  'WP_APP_PASSWORD',
  'AUTH_USERNAME',
  'AUTH_PASSWORD',
]

export interface Env {
  wpUrl: string
  wpUsername: string
  wpAppPassword: string
  host: string
  port: number
  uploadConcurrency: number
  maxFileSizeMb: number
  wpRequestTimeoutMs: number
  authUsername: string
  authPassword: string
  trustProxy: boolean
}

export function loadEnv(): Env {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key])
  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(', ')}.\n` +
        'Copy server/.env.example to server/.env and fill in your WordPress site details ' +
        '(create an Application Password under wp-admin -> Users -> Profile).',
    )
    process.exit(1)
  }

  let wpUrl: URL
  try {
    wpUrl = new URL(process.env.WP_URL as string)
  } catch {
    console.error(`WP_URL is not a valid URL: "${process.env.WP_URL}"`)
    process.exit(1)
  }

  return {
    wpUrl: wpUrl.toString().replace(/\/$/, ''),
    wpUsername: process.env.WP_USERNAME as string,
    wpAppPassword: process.env.WP_APP_PASSWORD as string,
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 3001,
    uploadConcurrency: Number(process.env.UPLOAD_CONCURRENCY) || 8,
    maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB) || 200,
    wpRequestTimeoutMs: Number(process.env.WP_REQUEST_TIMEOUT_MS) || 5 * 60_000,
    authUsername: process.env.AUTH_USERNAME as string,
    authPassword: process.env.AUTH_PASSWORD as string,
    // Only enable if a reverse proxy in front of this app sets X-Forwarded-For
    // itself and strips any client-supplied one - otherwise this lets clients
    // spoof their IP and bypass the login rate limit entirely.
    trustProxy: process.env.TRUST_PROXY === 'true',
  }
}

export const env = loadEnv()
