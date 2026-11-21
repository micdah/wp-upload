# wp-upload

Web app for uploading many media files to a WordPress site in parallel via the WordPress REST API.

## Layout

npm workspaces:

- `server/` — Express 4 on Node 24, running `.ts` files directly (no build step). Proxies to the WordPress
  REST API and the optional FileBird API, and serves the built client from `client/dist` with an SPA
  fallback. HTTP Basic Auth protects every route except `/healthz`.
- `client/` — Vite + React 18 + Mantine. Talks to the server only through its `/api` routes.

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

`npm run dev` runs both dev servers; Vite proxies `/api` to the server on port 3001.

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
- Relative URLs resolve against the page URL, so the app has a single entry URL (the mount root). The
  server's SPA fallback serves `index.html` for nested paths too, but assets don't resolve there. Adding a
  client-side router would need a different approach (e.g. a runtime `<base>`).

## No deployment specifics

This repository is public. Don't put hostnames, mount paths or other details of any particular deployment
in code, docs, commit messages or PRs. Use placeholders such as `example.com` and `/wp-upload/`.
