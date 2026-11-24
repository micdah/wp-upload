import crypto from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const REQUIRED_VARS = [
  'WP_URL',
  'WP_USERNAME',
  'WP_APP_PASSWORD',
  'AUTH_USERNAME',
  'AUTH_PASSWORD',
]

// The shapes Express's 'trust proxy' setting accepts that we expose:
// false/true, a hop count, or a list of trusted proxy addresses/subnets.
export type TrustProxy = boolean | number | string[]

const TRUST_PROXY_PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal'])

export const MIN_SESSION_SECRET_LENGTH = 32
const DEFAULT_SESSION_MAX_AGE_DAYS = 30
// Browsers cap a cookie's lifetime at 400 days anyway.
export const MAX_SESSION_MAX_AGE_DAYS = 400

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
  trustProxy: TrustProxy
  filebirdApiKey: string | null
  // HMAC key that signs session cookies.
  sessionSecret: Buffer
  sessionMaxAgeDays: number
  // Where the bundled companion plugin lives: its zip plus the build's
  // plugin.json and changelog.json sidecars (implementation plan §2.6).
  pluginBundleDir: string
}

// The plugin build's output in a checkout (plugin/scripts/build.mjs). The
// Docker image sets WPU_PLUGIN_BUNDLE_DIR to where it copies the build.
const DEFAULT_PLUGIN_BUNDLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../plugin/dist',
)

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
    // Decides which X-Forwarded-For entry becomes req.ip, which the login
    // lockout is keyed on. A hop count N picks the entry N hops from the
    // right - i.e. the address appended by the proxy in front of us - which
    // is safe behind proxies that append to the header. `true` picks the
    // leftmost entry, which the client controls unless the proxy overwrites
    // the header. Either way, the app must only be reachable via the proxy.
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    // Optional - setting it is what enables FileBird folder support (#38).
    filebirdApiKey: process.env.FILEBIRD_API_KEY?.trim() || null,
    sessionSecret: parseSessionSecret(process.env.SESSION_SECRET, {
      wpAppPassword: process.env.WP_APP_PASSWORD as string,
      authUsername: process.env.AUTH_USERNAME as string,
      authPassword: process.env.AUTH_PASSWORD as string,
    }),
    sessionMaxAgeDays: parseSessionMaxAgeDays(process.env.SESSION_MAX_AGE_DAYS),
    pluginBundleDir:
      process.env.WPU_PLUGIN_BUNDLE_DIR?.trim() || DEFAULT_PLUGIN_BUNDLE_DIR,
  }
}

interface SessionSecretSource {
  wpAppPassword: string
  authUsername: string
  authPassword: string
}

// Returns the key that signs session cookies. It always mixes in the app
// login (AUTH_USERNAME/AUTH_PASSWORD), so changing the password logs every
// session out - the natural reaction to a suspected compromise - even with an
// explicit SESSION_SECRET. Without SESSION_SECRET, the WordPress Application
// Password stands in for it: it is random and long, which keeps the key out
// of reach of offline guessing, and needs no new configuration for sessions
// to survive restarts.
export function parseSessionSecret(
  raw: string | undefined,
  { wpAppPassword, authUsername, authPassword }: SessionSecretSource,
): Buffer {
  const value = raw?.trim() ?? ''

  if (value !== '' && value.length < MIN_SESSION_SECRET_LENGTH) {
    console.error(
      `SESSION_SECRET is too short (${value.length} characters). Use at ` +
        `least ${MIN_SESSION_SECRET_LENGTH} random characters, e.g. the ` +
        'output of "openssl rand -base64 48", or leave it unset.',
    )
    process.exit(1)
  }

  const baseSecret =
    value !== ''
      ? { label: 'session-secret', secret: value }
      : { label: 'wp-app-password', secret: wpAppPassword }

  // JSON keeps the fields unambiguous (no separator that could also appear
  // inside a value); the fixed label separates this key from any other use.
  return crypto
    .createHmac('sha256', 'wp-upload session signing key v1')
    .update(
      JSON.stringify([
        baseSecret.label,
        baseSecret.secret,
        authUsername,
        authPassword,
      ]),
    )
    .digest()
}

export function parseSessionMaxAgeDays(raw: string | undefined): number {
  const value = raw?.trim() ?? ''
  if (value === '') return DEFAULT_SESSION_MAX_AGE_DAYS

  const days = Number(value)
  if (!/^\d+$/.test(value) || days < 1 || days > MAX_SESSION_MAX_AGE_DAYS) {
    console.error(
      `SESSION_MAX_AGE_DAYS is not valid: "${value}". Use a whole number ` +
        `of days from 1 to ${MAX_SESSION_MAX_AGE_DAYS} ` +
        `(default ${DEFAULT_SESSION_MAX_AGE_DAYS}).`,
    )
    process.exit(1)
  }
  return days
}

function isValidTrustedProxyEntry(entry: string): boolean {
  if (TRUST_PROXY_PRESETS.has(entry)) return true

  const [address = '', prefix, ...rest] = entry.split('/')
  if (rest.length > 0) return false

  const ipVersion = net.isIP(address)
  if (ipVersion === 0) return false
  if (prefix === undefined) return true

  // Express rejects /0 at startup - and trusting every address would be as
  // unsafe as TRUST_PROXY=true anyway - so the prefix must be at least 1.
  const maxPrefix = ipVersion === 4 ? 32 : 128
  const prefixLength = Number(prefix)
  return /^\d+$/.test(prefix) && prefixLength >= 1 && prefixLength <= maxPrefix
}

function exitInvalidTrustProxy(raw: string, detail: string): never {
  console.error(
    `TRUST_PROXY is not valid: "${raw}" (${detail}).\n` +
      'Use false (default), a hop count such as 1 (the number of reverse ' +
      'proxies in front of this app), true, or a comma-separated list of ' +
      'trusted proxy IPs/CIDR subnets (e.g. "loopback, 172.16.0.0/12").',
  )
  process.exit(1)
}

// Parses TRUST_PROXY into a value for Express's 'trust proxy' setting.
// Invalid values abort startup rather than silently falling back, since a
// wrong guess either breaks the login lockout or lets clients spoof their IP.
export function parseTrustProxy(raw: string | undefined): TrustProxy {
  const value = raw?.trim() ?? ''
  const lower = value.toLowerCase()

  if (value === '' || lower === 'false') return false
  if (lower === 'true') return true
  if (/^\d+$/.test(value)) return Number(value)

  const entries = value.split(',').map((entry) => entry.trim())
  for (const entry of entries) {
    if (entry === '') {
      exitInvalidTrustProxy(value, 'empty entry in list')
    }
    if (!isValidTrustedProxyEntry(entry)) {
      exitInvalidTrustProxy(
        value,
        `"${entry}" is not a hop count, IP address, CIDR subnet or one of ` +
          'loopback/linklocal/uniquelocal',
      )
    }
  }
  return entries
}

export const env = loadEnv()
