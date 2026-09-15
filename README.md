# WordPress Media Uploader

A local web app for uploading multiple media files to your WordPress site in parallel, via the WordPress REST API.

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. In WordPress, create an Application Password: **wp-admin → Users → Profile → Application Passwords**. Give it a name (e.g. "media uploader") and copy the generated password (it includes spaces — keep them).

3. Configure the server:

   ```
   cp server/.env.example server/.env
   ```

   Edit `server/.env` and set `WP_URL`, `WP_USERNAME`, `WP_APP_PASSWORD`, and a login for the app itself: `AUTH_USERNAME` / `AUTH_PASSWORD` (pick a long, random password — this is what stands between the internet and your WordPress site if you expose this app publicly).

## Run in development

```
npm run dev
```

This starts the Express API on `http://localhost:3001` and the Vite dev server on `http://localhost:5173` (which proxies `/api` requests to the backend). Open `http://localhost:5173`.

Note: in this mode, login is only enforced on the `/api/*` calls (proxied to Express), not on the page itself (served directly by Vite). Use `npm run serve` instead — see below — for anything other than local development on your own machine, since that's the mode where the whole app, including the initial page load, is behind login.

## Run as a single local app

```
npm run serve
```

Builds the React app and starts the Express server, which serves both the UI and the API from one process on `http://localhost:3001` (port configurable via `PORT` in `.env`). `npm run build` and `npm run start` remain available separately if you only need one of the two steps (e.g. re-running the server without rebuilding).

## Accessing from another device on your network

By default both the Express server and the Vite dev server bind to all network interfaces, so the app is also reachable at `http://<this-machine's-LAN-IP>:3001` (production) or `:5173` (dev). Set `HOST=127.0.0.1` in `server/.env` if you want to restrict it back to this machine only.

## Exposing this publicly

The app is protected by a login (HTTP Basic Auth, checked against `AUTH_USERNAME`/`AUTH_PASSWORD`) covering every route, with a lockout after 10 failed attempts from the same IP within 5 minutes. That login is the only thing standing between the internet and your WordPress credentials, so before putting this on the open internet:

- **Always put a TLS-terminating reverse proxy in front of it** (nginx, Caddy, Cloudflare Tunnel, your hosting platform's load balancer, etc.) pointed at this app's port over plain HTTP on localhost/an internal network. This app does not terminate HTTPS itself. Basic Auth credentials are base64-encoded, not encrypted — sent over plain HTTP, they're as good as sent in cleartext.
- **Only run it via `npm run serve`** (single origin, both UI and API behind login) for anything public-facing — never `npm run dev`.
- **Set `TRUST_PROXY=true` only if** the reverse proxy in front of it is one you control and it overwrites (not appends to) the `X-Forwarded-For` header itself. Otherwise leave it `false` — enabling it without a proxy that behaves this way lets any client fake their IP and bypass the login rate limit entirely.
- Use a long, random `AUTH_PASSWORD` — it's a shared secret with no username enumeration protection beyond the lockout.

## Notes

- Credentials are only ever stored server-side in `server/.env` — the browser never sees them.
- Changes to `.env` require restarting the server (`npm run dev` / `npm run start`).
- Parallel upload count is adjustable in the UI (1–6) and remembered in the browser.
