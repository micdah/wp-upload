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

   Edit `server/.env` and set `WP_URL`, `WP_USERNAME`, and `WP_APP_PASSWORD`.

## Run in development

```
npm run dev
```

This starts the Express API on `http://localhost:3001` and the Vite dev server on `http://localhost:5173` (which proxies `/api` requests to the backend). Open `http://localhost:5173`.

## Run as a single local app

```
npm run serve
```

Builds the React app and starts the Express server, which serves both the UI and the API from one process on `http://localhost:3001` (port configurable via `PORT` in `.env`). `npm run build` and `npm run start` remain available separately if you only need one of the two steps (e.g. re-running the server without rebuilding).

## Accessing from another device on your network

By default both the Express server and the Vite dev server bind to all network interfaces, so the app is also reachable at `http://<this-machine's-LAN-IP>:3001` (production) or `:5173` (dev). Set `HOST=127.0.0.1` in `server/.env` if you want to restrict it back to this machine only.

**Security note:** this app has no login of its own — anyone who can reach the port can upload media as your configured WordPress user. Only expose it on a network you trust (e.g. your home/office LAN), never over the open internet.

## Notes

- Credentials are only ever stored server-side in `server/.env` — the browser never sees them.
- Changes to `.env` require restarting the server (`npm run dev` / `npm run start`).
- Parallel upload count is adjustable in the UI (1–6) and remembered in the browser.
