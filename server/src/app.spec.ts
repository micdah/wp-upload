import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { app, clientDist } from './app.ts'
import { env } from './config/env.ts'
import { wpAxios } from './config/wpClient.ts'
import { failures } from './lib/loginLockout.ts'
import { SESSION_COOKIE_NAME } from './lib/session.ts'

vi.mock('./lib/wpUpload.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/wpUpload.ts')>()
  return { ...actual, uploadToWordPress: vi.fn() }
})

// Logs in through the real endpoint and returns the Cookie header to send.
async function sessionCookieHeader(): Promise<string> {
  const res = await request(app)
    .post('/session')
    .send({ username: env.authUsername, password: env.authPassword })
    .expect(200)
  const cookies = res.headers['set-cookie'] as unknown as string[]
  const cookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
  return (cookie as string).split(';')[0] as string
}

describe('app', () => {
  it('returns a JSON 404 for an unmatched /api route', async () => {
    const res = await request(app)
      .get('/api/does-not-exist')
      .set('Cookie', await sessionCookieHeader())
      .expect(404)

    expect(res.body).toEqual({
      code: 'not_found',
      message: 'The requested API endpoint does not exist.',
    })
  })

  it('serves existing client files without requiring a session', () => {
    const expectedFile = readFileSync(path.join(clientDist, 'favicon.png'))
    return request(app)
      .get('/favicon.png')
      .expect('Content-Type', 'image/png')
      .expect('Content-Length', expectedFile.length.toString())
      .expect(200)
  })

  it('serves index.html without requiring a session', () => {
    const expectedFile = readFileSync(path.join(clientDist, 'index.html'))
    return request(app)
      .get('/index.html')
      .expect('Content-Type', 'text/html; charset=UTF-8')
      .expect('Content-Length', expectedFile.length.toString())
      .expect(200)
  })

  it('serves the page and its bundled assets without requiring a session', async () => {
    const res = await request(app).get('/').expect(200)
    const assetUrls = [
      ...res.text.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g),
    ].map((match) => match[1])

    expect(assetUrls).not.toHaveLength(0)
    for (const assetUrl of assetUrls) {
      await request(app).get(`/${assetUrl}`).expect(200)
    }
  })

  it('serves the SPA fallback for nested paths without requiring a session', async () => {
    await request(app)
      .get('/some/nested/path')
      .expect('Content-Type', 'text/html; charset=UTF-8')
      .expect(200)
  })

  it('rejects API requests without a session with a JSON 401 and no challenge', async () => {
    const res = await request(app)
      .get('/api/status')
      .set('X-Forwarded-For', '10.3.0.1')
      .expect(401)

    expect(res.body).toEqual({
      code: 'unauthorized',
      message: 'Log in to continue.',
    })
    // A WWW-Authenticate challenge would make browsers show their own prompt.
    expect(res.headers['www-authenticate']).toBeUndefined()
    // ...and an anonymous request isn't a failed login.
    expect(failures.size).toBe(0)
  })

  it('rejects library requests without a session with a JSON 401 and no challenge', async () => {
    const wordPress = vi.spyOn(wpAxios, 'request')
    const res = await request(app)
      .get('/api/library/bootstrap')
      .set('X-Forwarded-For', '10.3.0.2')
      .expect(401)

    expect(res.body).toEqual({
      code: 'unauthorized',
      message: 'Log in to continue.',
    })
    expect(res.headers['www-authenticate']).toBeUndefined()
    expect(wordPress).not.toHaveBeenCalled()
  })

  it('rejects a cross-site library mutation with 403, even with a session', async () => {
    const wordPress = vi.spyOn(wpAxios, 'request')
    const res = await request(app)
      .post('/api/library/items/batch')
      .set('Cookie', await sessionCookieHeader())
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ ids: [1000], set: { alt: 'x' } })
      .expect(403)

    expect(res.body.code).toBe('cross_site_request')
    expect(wordPress).not.toHaveBeenCalled()
  })

  it('serves the API to a client that logged in via /session', async () => {
    const res = await request(app)
      .get('/api/status')
      .set('Cookie', await sessionCookieHeader())
      .expect(200)

    expect(res.body).toHaveProperty('maxFileSizeMb')
  })

  it('no longer accepts HTTP Basic Auth', async () => {
    const basic = Buffer.from(
      `${env.authUsername}:${env.authPassword}`,
    ).toString('base64')
    await request(app)
      .get('/api/status')
      .set('Authorization', `Basic ${basic}`)
      .expect(401)
  })

  it('logs out via DELETE /session', async () => {
    const res = await request(app).delete('/session').expect(204)

    expect(res.headers['set-cookie']).toEqual([
      `${SESSION_COOKIE_NAME}=; Max-Age=0; HttpOnly; SameSite=Lax`,
    ])
  })

  // The app must work under any sub-path behind a prefix-stripping reverse
  // proxy, so the built client may only use relative URLs (CLAUDE.md). The
  // guards below look for root-relative URLs (`/x`, not `//host/x`):
  //
  // - in index.html: any attribute value (src, href, content, action, …)
  //   and every srcset entry;
  // - in scripts: any string or template literal that starts with `/` and a
  //   path character (`"/api/…"`, `'/session'`, `` `/assets/…` ``).
  //
  // Deliberately not flagged, to stay free of false positives: a bare `"/"`,
  // `/` followed by a space, `*`, `$`, `&` or another `/` (globs, comments,
  // template interpolations such as a file picker's `/${name}` paths,
  // protocol-relative URLs), regex literals (not quoted) and MIME types like
  // `image/png` (no leading slash). URLs assembled at run time from such
  // pieces can't be judged statically.
  describe('root-relative URL guards', () => {
    const ROOT_RELATIVE_HTML = [
      // An attribute whose value starts with a single `/`.
      /\s[\w:.-]+\s*=\s*["']?\s*\/(?![/\s])[^"'\s>]*/g,
      // A later srcset entry starting with a single `/`.
      /\ssrcset\s*=\s*["'][^"']*?,\s*\/(?!\/)[^"'\s,]*/g,
    ]
    const ROOT_RELATIVE_SCRIPT = [/["'`]\/[\w~.%-][^"'`\s]*/g]

    // Lists `file: match` for every match, so a failure prints the offending
    // URLs rather than a whole minified bundle.
    function rootRelativeUrls(
      root: string,
      files: string[],
      patterns: RegExp[],
    ): string[] {
      return files.flatMap((file) => {
        const text = readFileSync(path.join(root, file), 'utf8')
        return patterns.flatMap((pattern) =>
          [...text.matchAll(pattern)].map((match) => `${file}: ${match[0]}`),
        )
      })
    }

    function builtScripts(): string[] {
      return readdirSync(path.join(clientDist, 'assets'))
        .filter((name) => name.endsWith('.js'))
        .map((name) => `assets/${name}`)
    }

    // Files written into a temp dir, to prove each guard catches what it is
    // meant to: a guard that matches nothing would pass on any build.
    function planted(files: Record<string, string>): string {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'wpu-url-guard-'))
      onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
      for (const [name, content] of Object.entries(files)) {
        writeFileSync(path.join(dir, name), content)
      }
      return dir
    }

    it('finds none in the built index.html', () => {
      const html = readFileSync(path.join(clientDist, 'index.html'), 'utf8')
      expect(html).toContain('./assets/')
      expect(
        rootRelativeUrls(clientDist, ['index.html'], ROOT_RELATIVE_HTML),
      ).toEqual([])
    })

    it('finds none in the built scripts', () => {
      expect(builtScripts()).not.toHaveLength(0)
      expect(
        rootRelativeUrls(clientDist, builtScripts(), ROOT_RELATIVE_SCRIPT),
      ).toEqual([])
    })

    it('flags root-relative attributes in a planted index.html', () => {
      const dir = planted({
        'index.html': [
          '<link rel="icon" href="/favicon.png" />',
          '<script type="module" src=/assets/x.js></script>',
          '<meta property="og:image" content="/og.png" />',
          "<form action='/session'></form>",
          '<img srcset="./a.png 1x, /b.png 2x" src="./a.png" />',
          // Fine: relative, absolute, protocol-relative and non-URL values.
          '<link href="./assets/a.css" /><link href="https://example.com/" />',
          '<link href="//cdn.example.com/x.css" />',
          '<meta name="viewport" content="width=device-width" />',
        ].join('\n'),
      })
      expect(
        rootRelativeUrls(dir, ['index.html'], ROOT_RELATIVE_HTML).map(
          (offence) => offence.replace(/^index\.html: \s*/, ''),
        ),
      ).toEqual([
        'href="/favicon.png',
        'src=/assets/x.js',
        'content="/og.png',
        "action='/session",
        'srcset="./a.png 1x, /b.png',
      ])
    })

    it('flags root-relative app URLs in a planted script', () => {
      const dir = planted({
        'x.js': [
          'fetch("/api/library/rev");',
          "fetch('/session',{method:'DELETE'});",
          `import(\`/assets/chunk-\${n}.js\`);`,
          'img.src="/favicon.svg";',
          // Fine: relative URLs, a bare slash, globs, interpolated paths,
          // protocol-relative URLs, regexes and MIME types.
          'fetch("api/library/rev");const a="./assets/x.js";',
          `const b="/";const c=\`/*\`;const d=\`/\${name}\`;`,
          'const e="//cdn.example.com/x";const f=/\\/api\\//g;',
          'const g="image/png";',
        ].join('\n'),
      })
      expect(rootRelativeUrls(dir, ['x.js'], ROOT_RELATIVE_SCRIPT)).toEqual([
        'x.js: "/api/library/rev',
        "x.js: '/session",
        `x.js: \`/assets/chunk-\${n}.js`,
        'x.js: "/favicon.svg',
      ])
    })
  })

  describe('the built client (bundle and URL guards)', () => {
    // Every file in client/dist, relative to it, with forward slashes.
    function distFiles(dir = clientDist): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) return distFiles(fullPath)
        return [path.relative(clientDist, fullPath).split(path.sep).join('/')]
      })
    }

    function read(file: string): string {
      return readFileSync(path.join(clientDist, file), 'utf8')
    }

    // Lists `file: match` for every match, so a failure prints the offending
    // URLs rather than a whole minified bundle.
    function offences(files: string[], pattern: RegExp): string[] {
      return files.flatMap((file) =>
        [...read(file).matchAll(pattern)].map(
          (match) => `${file}: ${match[0]}`,
        ),
      )
    }

    const scripts = () => distFiles().filter((file) => file.endsWith('.js'))
    const stylesheets = () =>
      distFiles().filter((file) => file.endsWith('.css'))

    it('splits the client into more than one JS chunk', () => {
      // The media manager and the old page are lazy chunks; a single bundle
      // means the split (and the bundle budget) silently stopped working.
      expect(scripts().length).toBeGreaterThan(1)
    })

    it('never calls WordPress directly', () => {
      // The browser only talks to this server; /wp-json lives behind it.
      expect(
        offences(['index.html', ...scripts()], /.{0,20}\/wp-json.{0,20}/g),
      ).toEqual([])
    })

    it('has no root-relative url() in stylesheets', () => {
      expect(stylesheets()).not.toHaveLength(0)
      expect(offences(stylesheets(), /url\(\s*["']?\/[^)]*\)/g)).toEqual([])
    })

    it('contains no MSW or mock service worker', () => {
      const mswFiles = distFiles().filter((file) =>
        /mockServiceWorker|(^|\/)msw/i.test(file),
      )
      expect(mswFiles).toEqual([])
      // Never a bare "msw": the legacy page's bundle contains
      // `application/msword`.
      expect(
        offences(
          ['index.html', ...scripts()],
          /.{0,20}(?:mockServiceWorker|setupWorker\(|\[MSW\]).{0,20}/g,
        ),
      ).toEqual([])
    })
  })

  it('serves /healthz without requiring authentication', async () => {
    const res = await request(app)
      .get('/healthz')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect(200)

    expect(res.text).toBe('ok')
  })
})
