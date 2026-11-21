# wp-upload

Web app for uploading many media files to a WordPress site in parallel via the WordPress REST API.

## Layout

npm workspaces:

- `server/` — Express 4 on Node 24, running `.ts` files directly (no build step). Proxies to the WordPress
  REST API and the optional FileBird API, and serves the built client from `client/dist` with an SPA
  fallback. A login page sets a signed session cookie (`server/src/lib/session.ts`) that every `/api` route
  requires. The page shell, static assets and `/healthz` are public. There is no HTTP Basic Auth, and nothing
  may send a `WWW-Authenticate` challenge, because that makes browsers show their own login prompt.
- `client/` — Vite + React 18 + Mantine. Talks to the server only through its `/api` routes and the
  `session` endpoint (log in, log out, current user).

## Commands

Run the same steps as CI (`.github/workflows/ci.yml`) before considering a change done:

```sh
npm ci
npm run check                  # Biome format + lint
npm run typecheck -w client
npm run build                  # builds client/dist
npm run typecheck -w server
npm run test -w server         # Vitest; reads client/dist, so build first
```

`npm run dev` runs both dev servers; Vite proxies `/api` and `/session` to the server on port 3001.

## Conventions

- Biome formatting: single quotes, no semicolons, 2-space indent. The husky pre-commit hook runs
  `biome check --write --staged`.
- Tests are colocated `*.spec.ts` files under `server/src` (Vitest + supertest). The client has no tests.
- Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, …) for commit subjects and PR titles.

## The app must be deployable under any path

The app must work both at `/` and under any sub-path behind a reverse proxy that strips the prefix. Never
assume a particular mount path:

- Client code never uses root-relative URLs. API calls use `api/...` (no leading slash), static files
  `./...`.
- Keep `base: './'` in `client/vite.config.ts` so the build references `./assets/...`.
- Tests in `server/src/app.spec.ts` check that the built `index.html` and JS bundle contain no
  root-relative URLs.
- The `session` endpoint stays at the app root (not under `api/`), and the session cookie is only ever set or
  cleared from there, without a `Path` attribute. Browsers then scope the cookie to the mount path without the
  app knowing it. Setting it from a deeper URL (e.g. under `api/`) would scope it to that directory instead.
- Relative URLs resolve against the page URL, so the app has a single entry URL (the mount root). The
  server's SPA fallback serves `index.html` for nested paths too, but assets don't resolve there. Adding a
  client-side router would need a different approach (e.g. a runtime `<base>`).

## No deployment specifics

This repository is public. Don't put hostnames, mount paths or other details of any particular deployment
in code, docs, commit messages or PRs. Use placeholders such as `example.com` and `/wp-upload/`.
