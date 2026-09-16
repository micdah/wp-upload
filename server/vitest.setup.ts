// Provides fallback env vars so importing config/env.ts in specs doesn't
// trip loadEnv()'s process.exit(1) path. `??=` never overrides a value a
// spec has deliberately set beforehand.
process.env.WP_URL ??= "https://example.invalid"
process.env.WP_USERNAME ??= "test-user"
process.env.WP_APP_PASSWORD ??= "test-app-password"
process.env.AUTH_USERNAME ??= "test-auth-user"
process.env.AUTH_PASSWORD ??= "test-auth-password"
