# WordPress Media Uploader

A local web app for uploading multiple media files to your WordPress site in parallel, via the WordPress REST API.

![Screenshot of the WordPress Media Uploader interface, showing a cyberpunk-themed upload queue with image thumbnails, a FileBird folder picker with a nested folder selected as the upload target, queue items labelled with the folder they're being filed into, uploaded, duplicate, failed and finalizing items, and a bottom status bar with WordPress connection info and live CPU/memory/disk usage rings](docs/screenshot.png)

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
      FILEBIRD_API_KEY: ${FILEBIRD_API_KEY:-}
      SESSION_SECRET: ${SESSION_SECRET:-}
      SESSION_MAX_AGE_DAYS: ${SESSION_MAX_AGE_DAYS:-30}
    restart: unless-stopped
```

And a `.env` file next to it with the required values filled in:

```
WP_URL=https://example.com
WP_USERNAME=your-username
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
AUTH_USERNAME=admin
AUTH_PASSWORD=change-me-to-something-long-and-random
# Generate with: openssl rand -base64 48
SESSION_SECRET=
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
| `AUTH_USERNAME` | Required | Username for logging into this app itself, on its login page. |
| `AUTH_PASSWORD` | Required | Password for logging into this app itself. Pick a long, random value, especially if the app is reachable from the internet. |
| `HOST` | Default `0.0.0.0` | Network interface the server binds to. `0.0.0.0` is reachable from other devices on your LAN; set to `127.0.0.1` to restrict to this machine only. |
| `PORT` | Default `3001` | Port the server listens on. |
| `UPLOAD_CONCURRENCY` | Default `8` | Maximum number of uploads sent to WordPress in parallel, across all browsers and tabs. Also reported to the UI as the cap on the user-adjustable, per-browser parallel upload setting (which can go above the browser's own connection limit — see [Notes](#notes)). |
| `MAX_FILE_SIZE_MB` | Default `200` | Maximum accepted upload size, in megabytes. |
| `WP_REQUEST_TIMEOUT_MS` | Default `300000` (5 minutes) | How long to wait for WordPress before aborting a request. Deliberately generous: WordPress keeps the connection open while it generates scaled-down image versions after receiving the file, which can take minutes when many uploads are processing in parallel. |
| `TRUST_PROXY` | Default `false` | Which client IP the login lockout sees when the app runs behind reverse proxies (passed to Express's [`trust proxy`](https://expressjs.com/en/guide/behind-proxies.html) setting). Leave `false` when clients connect directly. Behind proxies, set it to the **number of proxies** in front of the app — e.g. `1` for a single proxy that appends to `X-Forwarded-For` (such as nginx with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`) — so the address the proxy appended is used rather than one the client supplied. Also accepts a comma-separated list of trusted proxy IPs/CIDR subnets and the presets `loopback`, `linklocal`, `uniquelocal` (e.g. `loopback, 172.16.0.0/12`). `true` trusts the *leftmost* `X-Forwarded-For` entry, which clients control unless your proxy overwrites the header, so prefer a hop count. Invalid values stop the server at startup. See [Network access](#network-access-and-exposing-this-publicly). |
| `SESSION_SECRET` | Optional, default derived | Key that signs the login session cookie. Use at least 32 random characters, e.g. the output of `openssl rand -base64 48`; shorter values stop the server at startup. If unset, `WP_APP_PASSWORD` stands in for it, so sessions still survive restarts. Changing it, `AUTH_USERNAME` or `AUTH_PASSWORD` (or `WP_APP_PASSWORD` while `SESSION_SECRET` is unset) logs out every browser. |
| `SESSION_MAX_AGE_DAYS` | Default `30` | How long a login lasts, in whole days (1–400). Using the app (opening it, or returning to its tab) renews the session at most once a day, so a device that uses the app at least this often stays logged in. |
| `FILEBIRD_API_KEY` | Optional, default unset | FileBird REST API key (wp-admin → Settings → FileBird → API). Setting it enables the [FileBird folder picker](#filebird-folders-optional); leave it unset to disable FileBird support entirely. |

A couple of things worth knowing that aren't configurable: the login lockout (10 failed attempts within 5 minutes, per IP) is fixed in code, not an env var — only wrong usernames/passwords submitted to the login form count, not requests made without a session; and the `docker-compose.yml` shown above hardcodes `PORT`/`HOST` *inside* the container to `3001`/`0.0.0.0` — the `${PORT:-3001}` substitution there only changes the **host-side** port mapping, and `WP_REQUEST_TIMEOUT_MS` isn't declared in that file by default, though you can add it to the `environment:` block the same way as the others.

## FileBird folders (optional)

If your site uses the [FileBird](https://ninjateam.gitbook.io/filebird/) media folders plugin, uploads can be filed straight into a FileBird folder:

1. In wp-admin, go to **Settings → FileBird → API** and generate a REST API key.
2. Set it as `FILEBIRD_API_KEY` (in `server/.env`, or `-e`/`environment:` for Docker) and restart the server.

A folder picker then appears below the drop zone. Folders are shown as a tree, collapsed by default. Click a folder to make it the upload target, or use **+** next to any folder (or **New folder** for the top level) to create one, which is then selected automatically. **No folder (Uncategorized)** is the default and leaves uploads where FileBird normally puts them.

Each file goes into the folder that was selected **when it was dropped** — changing the selection only affects files you drop afterwards, never ones already queued or uploading. If an upload succeeds but filing it into the folder fails (e.g. the folder was deleted in wp-admin meanwhile), the file stays in WordPress, in Uncategorized, and the queue item shows a warning saying so.

Without `FILEBIRD_API_KEY` the picker is hidden entirely and the app behaves exactly as before. The FileBird API key is only ever used server-side, like the WordPress credentials. If FileBird's per-user folders mode is on, the folders shown are those of the user who generated the API key.

## Network access and exposing this publicly

By default the server binds to all network interfaces, so it's also reachable at `http://<this-machine's-LAN-IP>:3001`. Set `HOST=127.0.0.1` if you want to restrict it back to this machine only.

The app is protected by a login page checked against `AUTH_USERNAME`/`AUTH_PASSWORD`. Logging in sets a session cookie (`wp_upload_session`: `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, signed with `SESSION_SECRET`) that every `/api` request needs. The page itself, its scripts, styles and icons are public, since they contain no secrets, and so is `/healthz`. The login is the only thing standing between the internet and your WordPress credentials, so before putting this on the open internet:

- **Always put a TLS-terminating reverse proxy in front of it** (nginx, Caddy, Cloudflare Tunnel, your hosting platform's load balancer, etc.) pointed at this app's port over plain HTTP on localhost/an internal network. This app does not terminate HTTPS itself. Over plain HTTP, the password you log in with and the session cookie travel in cleartext. Have the proxy send `X-Forwarded-Proto` and set `TRUST_PROXY` (below) so the app sees the request as HTTPS and marks the cookie `Secure`.
- **Never run the development server (`npm run dev`) publicly** — it's meant for local development only. Serve a build via `npm run serve` or the Docker image instead. See [Development](#development) below.
- **Set `TRUST_PROXY` to the number of reverse proxies in front of the app** (usually `1`), so the login lockout is keyed on each client's real IP. Left at `false`, every request appears to come from the proxy, so all users share one lockout counter and a few wrong passwords lock everyone out. Avoid `true` unless your proxy overwrites (rather than appends to) `X-Forwarded-For`: it trusts the leftmost entry, which lets clients fake their IP and bypass the lockout.
- **Only expose the app through the proxy** when `TRUST_PROXY` is set — otherwise clients could connect to it directly with their own `X-Forwarded-For` header and get a fresh lockout counter on every request. The `docker-compose.yml` above publishes the port on all interfaces, and Docker-published ports bypass host firewalls such as ufw; if the proxy runs on the same host, bind it to localhost (`"127.0.0.1:${PORT:-3001}:3001"`), or put the proxy and app on a shared Docker network and drop `ports:` entirely.
- Use a long, random `AUTH_PASSWORD` — it's a shared secret with no username enumeration protection beyond the lockout.
- **Set `SESSION_SECRET`** to a long random value. Sessions are stateless signed cookies: logging out removes the cookie from that browser, but a copied cookie stays valid until it expires. Change `SESSION_SECRET` or `AUTH_PASSWORD` to log out every browser at once.

Logging in sends no browser-level authentication (no HTTP Basic Auth), so browsers never show their own login prompt. State-changing requests are protected against cross-site request forgery: the cookie is `SameSite=Lax`, and the server rejects non-GET requests that the browser marks as coming from another site, including sibling subdomains (`Sec-Fetch-Site`).

### Serving under a sub-path

The app can be served at the root of a domain or under any sub-path (e.g. `https://example.com/wp-upload/`) — the client only uses relative URLs. The reverse proxy must strip the prefix before forwarding, and the page must be loaded with the trailing slash. With nginx, trailing slashes on both the `location` and the `proxy_pass` URL strip the prefix, and nginx redirects `/wp-upload` to `/wp-upload/` on its own:

```nginx
location /wp-upload/ {
    proxy_pass http://127.0.0.1:3001/;

    # The client's address, for the login lockout. Pair with TRUST_PROXY=1
    # (one proxy in front); $proxy_add_x_forwarded_for works with it too.
    proxy_set_header X-Forwarded-For $remote_addr;
    # So the app knows the request was HTTPS and marks the session cookie Secure
    # (needs TRUST_PROXY too).
    proxy_set_header X-Forwarded-Proto $scheme;

    # nginx's default (1 MB) is too small for media uploads. Keep it a bit above
    # MAX_FILE_SIZE_MB to allow for the multipart overhead.
    client_max_body_size 210m;
}
```

The default read timeouts are fine: uploads respond as soon as the file has reached this server, and the WordPress upload continues in the background. The same settings apply when serving the app at the root. Pair `X-Forwarded-For` with `TRUST_PROXY=1` (the number of proxies in front of the app), otherwise every user shares the proxy's IP for the login lockout, and the session cookie isn't marked `Secure`.

The session cookie is set without a `Path` by the login endpoint at the app's root (`<mount>/session`), so the browser scopes it to the mount path (`/wp-upload` here). Other apps on the same host never receive it, even though the app doesn't know its external prefix.

### Scripted access

There is no HTTP Basic Auth. Scripts log in like the browser does and keep the session cookie, e.g. with curl's cookie jar:

```sh
curl -c cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"username": "admin", "password": "..."}' \
  https://example.com/wp-upload/session

curl -b cookies.txt https://example.com/wp-upload/api/status
```

`DELETE <mount>/session` logs out. `GET <mount>/session` returns the logged-in user, or `401` without a valid session.

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

This starts the Express API on `http://localhost:3001` and the Vite dev server on `http://localhost:5173` (which proxies the `/api` and `/session` requests to the backend). Open `http://localhost:5173`. Login works the same as in production; the session cookie just isn't `Secure` over plain HTTP. Use `npm run serve` instead for anything other than local development on your own machine.

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

`typecheck` runs `tsc` across both workspaces; `test` runs the server's Vitest suite. Both also run in CI (`.github/workflows/ci.yml`) on every pull request, alongside a smoke test that builds the Docker image, checks `/healthz` and the public page, and logs in to call `/api/status`.

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
- Parallel upload count is adjustable in the UI (capped at the server's `UPLOAD_CONCURRENCY`) and remembered in the browser. It isn't limited by the browser's ~6-connections-per-site limit: a file only holds a browser connection while it's being sent to this server (at most 5 at once, leaving one free for the UI's status polling). The server then uploads it to WordPress in the background and the UI follows its progress.
- Removing a file in the UI cancels its upload, even after it has reached the server, as long as WordPress hasn't finished processing it yet. Once WordPress has created the media item, it stays in the media library (and is still filed into its FileBird folder, if one was selected). Also, once a file has been fully sent to this server, closing the browser tab no longer stops it: the server finishes the WordPress upload anyway.
