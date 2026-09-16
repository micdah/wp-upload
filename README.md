# WordPress Media Uploader

A local web app for uploading multiple media files to your WordPress site in parallel, via the WordPress REST API.

![Screenshot of the WordPress Media Uploader interface, showing a cyberpunk-themed upload queue with image thumbnails, three uploaded files and two finalizing, and a bottom status bar with WordPress connection info and live CPU/memory/disk usage rings](docs/screenshot.png)

## Using the Docker image

A pre-built image is published to GHCR on every merge to `master`: [`ghcr.io/micdah/wp-upload`](https://github.com/micdah/wp-upload/pkgs/container/wp-upload), tagged `latest` and with a version tag (e.g. `v1.0.8`).

Before you start, create a WordPress Application Password: **wp-admin → Users → Profile → Application Passwords**. Give it a name (e.g. "media uploader") and copy the generated password (it includes spaces — keep them).

### `docker run`

```
docker run -d -p 3001:3001 \
  -e WP_URL=https://example.com \
  -e WP_USERNAME=your-username \
  -e WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx" \
  -e AUTH_USERNAME=admin \
  -e AUTH_PASSWORD=change-me-to-something-long-and-random \
  ghcr.io/micdah/wp-upload:latest
```

Open `http://localhost:3001` and log in with `AUTH_USERNAME`/`AUTH_PASSWORD`.

### `docker compose`

Create a `docker-compose.yml`:

```yaml
services:
  app:
    image: ghcr.io/micdah/wp-upload:latest
    ports:
      - "${PORT:-3001}:3001"
    environment:
      WP_URL: ${WP_URL}
      WP_USERNAME: ${WP_USERNAME}
      WP_APP_PASSWORD: ${WP_APP_PASSWORD}
      AUTH_USERNAME: ${AUTH_USERNAME}
      AUTH_PASSWORD: ${AUTH_PASSWORD}
      HOST: 0.0.0.0
      PORT: 3001
      UPLOAD_CONCURRENCY: ${UPLOAD_CONCURRENCY:-8}
      MAX_FILE_SIZE_MB: ${MAX_FILE_SIZE_MB:-200}
      TRUST_PROXY: ${TRUST_PROXY:-false}
    restart: unless-stopped
```

And a `.env` file next to it with the required values filled in:

```
WP_URL=https://example.com
WP_USERNAME=your-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
AUTH_USERNAME=admin
AUTH_PASSWORD=change-me-to-something-long-and-random
```

Then:

```
docker compose up -d
```

Run `docker compose pull && docker compose up -d` whenever you want to update to the latest published image.

### Notes on the image

- The image is a multi-stage build ending on `gcr.io/distroless/nodejs24-debian13:nonroot` — no shell, no package manager, and the process runs as a non-root user (UID 65532).
- There's no `.env` file inside the image; every setting is passed in via `-e`/`environment:` (or your orchestrator's env/secret mechanism) — see [Configuration options](#configuration-options) below for the full list.
- A `GET /healthz` route (no login required) is available for container/orchestrator health checks — it just confirms the process is up, without touching WordPress or requiring credentials.

## Configuration options

All options are environment variables read once at startup by the server (`server/src/config/env.ts`). The client has no configuration of its own — it talks to the server over the same origin.

| Variable | Required / default | Description |
| --- | --- | --- |
| `WP_URL` | Required | Base URL of your WordPress site (no trailing slash). Used for every WordPress REST API call. |
| `WP_USERNAME` | Required | WordPress username the Application Password below was generated for. |
| `WP_APP_PASSWORD` | Required | WordPress Application Password (wp-admin → Users → Profile → Application Passwords). Used as HTTP Basic Auth against the WordPress REST API. Keep the spaces exactly as WordPress shows them. |
| `AUTH_USERNAME` | Required | Username for logging into this app itself (HTTP Basic Auth — your browser will prompt for it). |
| `AUTH_PASSWORD` | Required | Password for logging into this app itself. Pick a long, random value, especially if the app is reachable from the internet. |
| `HOST` | Default `0.0.0.0` | Network interface the server binds to. `0.0.0.0` is reachable from other devices on your LAN; set to `127.0.0.1` to restrict to this machine only. |
| `PORT` | Default `3001` | Port the server listens on. |
| `UPLOAD_CONCURRENCY` | Default `8` | Maximum number of uploads sent to WordPress in parallel. Also reported to the UI as the cap on the user-adjustable, per-browser parallel upload setting. |
| `MAX_FILE_SIZE_MB` | Default `200` | Maximum accepted upload size, in megabytes. |
| `WP_REQUEST_TIMEOUT_MS` | Default `300000` (5 minutes) | How long to wait for WordPress before aborting a request. Deliberately generous: WordPress keeps the connection open while it generates scaled-down image versions after receiving the file, which can take minutes when many uploads are processing in parallel. |
| `TRUST_PROXY` | Default `false` | Set to `true` only if this app sits behind a reverse proxy that you control and that overwrites (not appends to) `X-Forwarded-For` itself. Controls whether that header is trusted for the login rate-limiter's IP check. Enabling this without such a proxy lets any client fake their IP and bypass the rate limit. |

A couple of things worth knowing that aren't configurable: the login lockout (10 failed attempts within 5 minutes, per IP) is fixed in code, not an env var; and the `docker-compose.yml` shown above hardcodes `PORT`/`HOST` *inside* the container to `3001`/`0.0.0.0` — the `${PORT:-3001}` substitution there only changes the **host-side** port mapping, and `WP_REQUEST_TIMEOUT_MS` isn't declared in that file by default, though you can add it to the `environment:` block the same way as the others.

## Network access and exposing this publicly

By default the server binds to all network interfaces, so it's also reachable at `http://<this-machine's-LAN-IP>:3001`. Set `HOST=127.0.0.1` if you want to restrict it back to this machine only.

The app is protected by a login (HTTP Basic Auth, checked against `AUTH_USERNAME`/`AUTH_PASSWORD`) covering every route except `/healthz`. That login is the only thing standing between the internet and your WordPress credentials, so before putting this on the open internet:

- **Always put a TLS-terminating reverse proxy in front of it** (nginx, Caddy, Cloudflare Tunnel, your hosting platform's load balancer, etc.) pointed at this app's port over plain HTTP on localhost/an internal network. This app does not terminate HTTPS itself. Basic Auth credentials are base64-encoded, not encrypted — sent over plain HTTP, they're as good as sent in cleartext.
- **Never run the development server (`npm run dev`) publicly** — only a build served via `npm run serve` (or the Docker image, which does the same thing) puts the entire app, including the initial page load, behind login. See [Development](#development) below.
- **Set `TRUST_PROXY=true` only if** the reverse proxy in front of it is one you control and it overwrites (not appends to) the `X-Forwarded-For` header itself. Otherwise leave it `false`.
- Use a long, random `AUTH_PASSWORD` — it's a shared secret with no username enumeration protection beyond the lockout.

## Development

### Prerequisites

- Node.js `>=24`.

### Install and configure

```
npm install
```

Create a WordPress Application Password as described above, then configure the server:

```
cp server/.env.example server/.env
```

Edit `server/.env` and fill in the required variables from the [Configuration options](#configuration-options) table (`WP_URL`, `WP_USERNAME`, `WP_APP_PASSWORD`, `AUTH_USERNAME`, `AUTH_PASSWORD`).

### Run in development

```
npm run dev
```

This starts the Express API on `http://localhost:3001` and the Vite dev server on `http://localhost:5173` (which proxies `/api` requests to the backend). Open `http://localhost:5173`.

Note: in this mode, login is only enforced on the `/api/*` calls (proxied to Express), not on the page itself (served directly by Vite). Use `npm run serve` instead for anything other than local development on your own machine.

### Run as a single local app

```
npm run serve
```

Builds the React app and starts the Express server, which serves both the UI and the API from one process on `http://localhost:3001` (port configurable via `PORT` in `.env`). `npm run build` and `npm run start` remain available separately if you only need one of the two steps (e.g. re-running the server without rebuilding).

### Type-checking and tests

```
npm run typecheck
npm run test
```

`typecheck` runs `tsc` across both workspaces; `test` runs the server's Vitest suite. Both also run in CI (`.github/workflows/ci.yml`) on every pull request, alongside a smoke test that builds the Docker image and exercises `/healthz` and `/api/status`.

### Building the Docker image locally

```
docker build -t wp-upload .
docker run -d -p 3001:3001 \
  -e WP_URL=https://example.com \
  -e WP_USERNAME=your-username \
  -e WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx" \
  -e AUTH_USERNAME=admin \
  -e AUTH_PASSWORD=change-me-to-something-long-and-random \
  wp-upload
```

If you're using Docker Compose, swap `image: ghcr.io/micdah/wp-upload:latest` for `image: wp-upload` in your `docker-compose.yml` and run `docker compose up -d` after building.

## Notes

- Credentials are only ever stored server-side (in `server/.env`, or the environment you pass to the container) — the browser never sees them.
- Changes to `.env` require restarting the server (`npm run dev` / `npm run start`, or restarting the container).
- Parallel upload count is adjustable in the UI (capped at the server's `UPLOAD_CONCURRENCY`) and remembered in the browser.
