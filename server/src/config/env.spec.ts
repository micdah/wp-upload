import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { loadEnv, MIN_SESSION_SECRET_LENGTH } from './env.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

const REQUIRED_ENV = {
  WP_URL: 'https://wp.example.invalid',
  WP_USERNAME: 'wp-user',
  WP_APP_PASSWORD: 'wp-app-password',
  AUTH_USERNAME: 'auth-user',
  AUTH_PASSWORD: 'auth-password',
}

function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T,
): T {
  const original = { ...process.env }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return fn()
  } finally {
    process.env = original
  }
}

function mockExit() {
  return vi
    .spyOn(process, 'exit')
    .mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${code}`)
    })
}

// Fully synchronous end-to-end (loadEnv never awaits), and every test
// snapshots + restores process.env locally within its own body via
// withEnv(), so concurrent interleaving cannot corrupt another test's
// environment.
describe.concurrent('loadEnv', () => {
  it('exits with an error when required vars are missing', () => {
    withEnv(
      {
        WP_URL: undefined,
        WP_USERNAME: undefined,
        WP_APP_PASSWORD: undefined,
        AUTH_USERNAME: undefined,
        AUTH_PASSWORD: undefined,
      },
      () => {
        const exit = mockExit()
        const consoleError = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {})

        expect(() => loadEnv()).toThrow('process.exit:1')

        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('Missing required environment variable'),
        )
        expect(exit).toHaveBeenCalledWith(1)
      },
    )
  })

  it('exits with an error when WP_URL is not a valid URL', () => {
    withEnv({ ...REQUIRED_ENV, WP_URL: 'not-a-url' }, () => {
      const exit = mockExit()
      vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => loadEnv()).toThrow('process.exit:1')
      expect(exit).toHaveBeenCalledWith(1)
    })
  })

  it('returns a fully populated Env when all required vars are set', () => {
    withEnv(
      {
        ...REQUIRED_ENV,
        WP_URL: 'https://wp.example.invalid/',
        HOST: undefined,
        PORT: undefined,
        UPLOAD_CONCURRENCY: undefined,
        MAX_FILE_SIZE_MB: undefined,
        WP_REQUEST_TIMEOUT_MS: undefined,
        TRUST_PROXY: undefined,
        FILEBIRD_API_KEY: undefined,
        SESSION_SECRET: undefined,
        SESSION_MAX_AGE_DAYS: undefined,
        WPU_PLUGIN_BUNDLE_DIR: undefined,
      },
      () => {
        expect(loadEnv()).toEqual({
          wpUrl: 'https://wp.example.invalid',
          wpUsername: REQUIRED_ENV.WP_USERNAME,
          wpAppPassword: REQUIRED_ENV.WP_APP_PASSWORD,
          host: '0.0.0.0',
          port: 3001,
          uploadConcurrency: 8,
          maxFileSizeMb: 200,
          wpRequestTimeoutMs: 5 * 60_000,
          authUsername: REQUIRED_ENV.AUTH_USERNAME,
          authPassword: REQUIRED_ENV.AUTH_PASSWORD,
          trustProxy: false,
          filebirdApiKey: null,
          sessionSecret: expect.any(Buffer),
          sessionMaxAgeDays: 30,
          pluginBundleDir: path.resolve(here, '../../../plugin/dist'),
        })
      },
    )
  })

  it('reads the bundled plugin directory from WPU_PLUGIN_BUNDLE_DIR', () => {
    withEnv(
      { ...REQUIRED_ENV, WPU_PLUGIN_BUNDLE_DIR: ' /app/plugin/dist ' },
      () => {
        expect(loadEnv().pluginBundleDir).toBe('/app/plugin/dist')
      },
    )
  })

  it('falls back to defaults when numeric vars are not valid numbers', () => {
    withEnv(
      { ...REQUIRED_ENV, PORT: 'abc', UPLOAD_CONCURRENCY: 'nope' },
      () => {
        const result = loadEnv()

        expect(result.port).toBe(3001)
        expect(result.uploadConcurrency).toBe(8)
      },
    )
  })

  it('parses TRUST_PROXY booleans case-insensitively, defaulting to false', () => {
    for (const value of [undefined, '', '  ', 'false', 'FALSE']) {
      withEnv({ ...REQUIRED_ENV, TRUST_PROXY: value }, () => {
        expect(loadEnv().trustProxy).toBe(false)
      })
    }
    for (const value of ['true', 'TRUE', ' true ']) {
      withEnv({ ...REQUIRED_ENV, TRUST_PROXY: value }, () => {
        expect(loadEnv().trustProxy).toBe(true)
      })
    }
  })

  it('parses a TRUST_PROXY hop count as a number', () => {
    withEnv({ ...REQUIRED_ENV, TRUST_PROXY: '1' }, () => {
      expect(loadEnv().trustProxy).toBe(1)
    })
    withEnv({ ...REQUIRED_ENV, TRUST_PROXY: ' 2 ' }, () => {
      expect(loadEnv().trustProxy).toBe(2)
    })
    withEnv({ ...REQUIRED_ENV, TRUST_PROXY: '0' }, () => {
      expect(loadEnv().trustProxy).toBe(0)
    })
  })

  it('parses a TRUST_PROXY list of IPs, subnets and presets', () => {
    withEnv(
      {
        ...REQUIRED_ENV,
        TRUST_PROXY: ' loopback, 10.0.0.1 , 172.16.0.0/12, ::1, fd00::/8 ',
      },
      () => {
        expect(loadEnv().trustProxy).toEqual([
          'loopback',
          '10.0.0.1',
          '172.16.0.0/12',
          '::1',
          'fd00::/8',
        ])
      },
    )
  })

  it('exits with an error when TRUST_PROXY is not valid', () => {
    for (const value of [
      'yes',
      '-1',
      '1.5',
      '10.0.0.300',
      '10.0.0.0/33',
      '10.0.0.0/0',
      '::/0',
      '10.0.0.0/8/1',
      '10.0.0.0/abc',
      '::1/129',
      'loopback,,10.0.0.1',
    ]) {
      withEnv({ ...REQUIRED_ENV, TRUST_PROXY: value }, () => {
        const exit = mockExit()
        const consoleError = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {})

        expect(() => loadEnv(), value).toThrow('process.exit:1')
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('TRUST_PROXY is not valid'),
        )
        expect(exit).toHaveBeenCalledWith(1)
      })
    }
  })

  it('treats a blank FILEBIRD_API_KEY as unset, and trims a set one', () => {
    withEnv({ ...REQUIRED_ENV, FILEBIRD_API_KEY: '   ' }, () => {
      expect(loadEnv().filebirdApiKey).toBeNull()
    })
    withEnv({ ...REQUIRED_ENV, FILEBIRD_API_KEY: ' fb-key ' }, () => {
      expect(loadEnv().filebirdApiKey).toBe('fb-key')
    })
  })

  it('derives the session key from SESSION_SECRET and the app login when set', () => {
    const secret = 'x'.repeat(MIN_SESSION_SECRET_LENGTH)
    const keyFor = (overrides: Record<string, string>) =>
      withEnv(
        { ...REQUIRED_ENV, SESSION_SECRET: ` ${secret} `, ...overrides },
        () => loadEnv().sessionSecret,
      )

    const key = keyFor({})
    expect(key).toHaveLength(32)
    expect(keyFor({ SESSION_SECRET: secret })).toEqual(key)
    expect(keyFor({ SESSION_SECRET: 'y'.repeat(40) })).not.toEqual(key)
    // The WordPress password only stands in when SESSION_SECRET is unset...
    expect(keyFor({ WP_APP_PASSWORD: 'other' })).toEqual(key)
    // ...but changing the app login always logs everyone out.
    expect(keyFor({ AUTH_PASSWORD: 'other' })).not.toEqual(key)
    expect(keyFor({ AUTH_USERNAME: 'other' })).not.toEqual(key)
  })

  it('exits with an error when SESSION_SECRET is too short', () => {
    withEnv(
      {
        ...REQUIRED_ENV,
        SESSION_SECRET: 'x'.repeat(MIN_SESSION_SECRET_LENGTH - 1),
      },
      () => {
        const exit = mockExit()
        const consoleError = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {})

        expect(() => loadEnv()).toThrow('process.exit:1')
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('SESSION_SECRET is too short'),
        )
        expect(exit).toHaveBeenCalledWith(1)
      },
    )
  })

  it('derives a stable session key from the credentials when SESSION_SECRET is unset', () => {
    const keyFor = (overrides: Record<string, string>) =>
      withEnv(
        { ...REQUIRED_ENV, SESSION_SECRET: '  ', ...overrides },
        () => loadEnv().sessionSecret,
      )

    const key = keyFor({})
    expect(key).toHaveLength(32)
    // Stable across restarts, so sessions survive them...
    expect(keyFor({})).toEqual(key)
    // ...but rotating any of the credentials it comes from logs everyone out.
    expect(keyFor({ WP_APP_PASSWORD: 'other' })).not.toEqual(key)
    expect(keyFor({ AUTH_USERNAME: 'other' })).not.toEqual(key)
    expect(keyFor({ AUTH_PASSWORD: 'other' })).not.toEqual(key)
  })

  it('parses SESSION_MAX_AGE_DAYS as a whole number of days', () => {
    withEnv({ ...REQUIRED_ENV, SESSION_MAX_AGE_DAYS: ' 90 ' }, () => {
      expect(loadEnv().sessionMaxAgeDays).toBe(90)
    })
    withEnv({ ...REQUIRED_ENV, SESSION_MAX_AGE_DAYS: '' }, () => {
      expect(loadEnv().sessionMaxAgeDays).toBe(30)
    })
    withEnv({ ...REQUIRED_ENV, SESSION_MAX_AGE_DAYS: '400' }, () => {
      expect(loadEnv().sessionMaxAgeDays).toBe(400)
    })
  })

  it('exits with an error when SESSION_MAX_AGE_DAYS is not valid', () => {
    for (const value of [
      '0',
      '-1',
      '1.5',
      'abc',
      '401',
      '99999999999999999999',
    ]) {
      withEnv({ ...REQUIRED_ENV, SESSION_MAX_AGE_DAYS: value }, () => {
        const exit = mockExit()
        const consoleError = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {})

        expect(() => loadEnv(), value).toThrow('process.exit:1')
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('SESSION_MAX_AGE_DAYS is not valid'),
        )
        expect(exit).toHaveBeenCalledWith(1)
      })
    }
  })
})
