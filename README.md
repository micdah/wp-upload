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
npm run build
npm run start
```

This builds the React app and serves it directly from the Express server on `http://localhost:3001` (port configurable via `PORT` in `.env`).

## Notes

- Credentials are only ever stored server-side in `server/.env` — the browser never sees them.
- Changes to `.env` require restarting the server (`npm run dev` / `npm run start`).
- Parallel upload count is adjustable in the UI (1–6) and remembered in the browser.
- This app has no login of its own and is intended for local, single-user use.
