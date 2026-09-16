import { describe, it, expect, vi } from 'vitest';
import { loadEnv } from './env.ts';

const REQUIRED_ENV = {
  WP_URL: 'https://wp.example.invalid',
  WP_USERNAME: 'wp-user',
  WP_APP_PASSWORD: 'wp-app-password',
  AUTH_USERNAME: 'auth-user',
  AUTH_PASSWORD: 'auth-password',
};

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const original = { ...process.env };
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    process.env = original;
  }
}

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code}`);
  });
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
        const exit = mockExit();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => loadEnv()).toThrow('process.exit:1');

        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('Missing required environment variable')
        );
        expect(exit).toHaveBeenCalledWith(1);
      }
    );
  });

  it('exits with an error when WP_URL is not a valid URL', () => {
    withEnv({ ...REQUIRED_ENV, WP_URL: 'not-a-url' }, () => {
      const exit = mockExit();
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => loadEnv()).toThrow('process.exit:1');
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

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
        });
      }
    );
  });

  it('falls back to defaults when numeric vars are not valid numbers', () => {
    withEnv({ ...REQUIRED_ENV, PORT: 'abc', UPLOAD_CONCURRENCY: 'nope' }, () => {
      const result = loadEnv();

      expect(result.port).toBe(3001);
      expect(result.uploadConcurrency).toBe(8);
    });
  });

  it('only treats the literal string "true" as trustProxy', () => {
    withEnv({ ...REQUIRED_ENV, TRUST_PROXY: 'yes' }, () => {
      expect(loadEnv().trustProxy).toBe(false);
    });
    withEnv({ ...REQUIRED_ENV, TRUST_PROXY: 'true' }, () => {
      expect(loadEnv().trustProxy).toBe(true);
    });
  });
});
