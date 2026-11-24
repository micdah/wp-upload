// Helpers of the P2 contract specs (media, trash, usage, images; CR-P2-1): REST calls that
// answer `{status, json}` and can send multipart bodies, the Editor and Author logins, the
// variant switch, and test images. Built on the shared env, HTTP retry and variants modules,
// so every spec finds WordPress and switches variants the same way.
import { deflateSync } from 'node:zlib'
import { type Credentials, env } from './env.ts'
import { fetchOnce } from './http.ts'
import { setVariant, type Variant, variantsAvailable } from './variants.ts'

export type { Credentials }

// Response bodies are checked with the zod schemas or field by field.
// biome-ignore lint/suspicious/noExplicitAny: JSON from WordPress, narrowed by the assertions.
export type Json = any
export type RestReply = { status: number; json: Json }

export const wpUrl = env.wpUrl
export const editor: Credentials = env.editor
export const author: Credentials | null = env.author

function authHeader(as: Credentials | null): Record<string, string> {
  if (!as) return {}
  return {
    Authorization: `Basic ${Buffer.from(`${as.user}:${as.password}`).toString('base64')}`,
  }
}

/** A REST call; `path` starts with the namespace, e.g. `/wp-upload/v1/rev`. */
export async function rest(
  method: string,
  path: string,
  options: { body?: unknown; as?: Credentials | null; form?: FormData } = {},
): Promise<RestReply> {
  const as = options.as === undefined ? editor : options.as
  const headers: Record<string, string> = { ...authHeader(as) }
  let body: BodyInit | undefined
  if (options.form) {
    body = options.form
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const response = await fetchOnce(`${wpUrl}/wp-json${path}`, {
    method,
    headers,
    body,
  })
  const text = await response.text()
  let json: Json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: response.status, json }
}

/** A call to the plugin's own routes (`/wp-upload/v1`). */
export const plugin = (
  method: string,
  route: string,
  options?: Parameters<typeof rest>[2],
) => rest(method, `/wp-upload/v1${route}`, options)

/** Whether variants can be switched from where the tests run. */
export function canSwitchVariants(): boolean {
  return variantsAvailable
}

/** Switches variants given as `key=value` pairs (`trash=on`, `vp=off`, `role=author`). */
export function variant(...pairs: string[]): void {
  const requested: Record<string, string> = {}
  for (const pair of pairs) {
    const [key, value] = pair.split('=', 2)
    if (!key || value === undefined) {
      throw new Error(`Not a key=value variant: ${pair}`)
    }
    requested[key] = value
  }
  setVariant(requested as Variant)
}

/** A fresh PNG (RGB, 8 bit), so tests never depend on seeded files they might change. */
export function makePng(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3
      raw[offset] = (x * 255) / width
      raw[offset + 1] = (y * 255) / height
      raw[offset + 2] = ((x + y) * 13) % 256
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typed))
    return Buffer.concat([length, typed, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Uploads a file through core's REST API and returns the attachment. */
export async function upload(
  name: string,
  bytes: Buffer,
  mime: string,
  as: Credentials = editor,
): Promise<Json> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name)
  const reply = await rest('POST', '/wp/v2/media', { form, as })
  if (reply.status !== 201)
    throw new Error(
      `upload failed: ${reply.status} ${JSON.stringify(reply.json)}`,
    )
  return reply.json
}
