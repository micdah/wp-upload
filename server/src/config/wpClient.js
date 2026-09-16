import axios from 'axios';
import { env } from './env.js';

export const authHeader = `Basic ${Buffer.from(`${env.wpUsername}:${env.wpAppPassword}`).toString('base64')}`;

// On Node, axios' `timeout` is an idle-socket timeout (it resets whenever
// bytes flow in either direction) rather than a wall-clock cap on total
// request duration. That covers slow-but-active transfers, but NOT the gap
// after WordPress has received the whole file and is generating scaled-down
// versions before responding - no bytes move during that processing, so it
// looks identical to a dead connection. This value must be generous enough
// to outlast the slowest realistic WP processing time under concurrent
// uploads, not just a "reasonable network response" duration - see #1.
export const wpAxios = axios.create({
  baseURL: env.wpUrl,
  headers: { Authorization: authHeader },
  timeout: env.wpRequestTimeoutMs,
});

// In-memory connection status, refreshed at startup, periodically re-checked
// on a TTL when /api/status is polled, and invalidated eagerly on upload
// auth failures. Exposed via /api/status.
export const connectionState = {
  connected: false,
  user: null,
  reason: null,
  lastCheckedAt: null,
};

const STALE_AFTER_MS = 2 * 60 * 1000;

// Dedupes overlapping calls (startup, TTL refresh, concurrent /api/status
// requests all racing) so we never fire more than one check at a time.
let inFlightCheck = null;

async function performCheck() {
  try {
    const { data } = await wpAxios.get('/wp-json/wp/v2/users/me', { timeout: 10_000 });
    connectionState.connected = true;
    connectionState.user = data?.name ?? env.wpUsername;
    connectionState.reason = null;
    console.log(`Connected to WordPress at ${env.wpUrl} as "${connectionState.user}".`);
  } catch (err) {
    connectionState.connected = false;
    connectionState.user = null;
    if (err.response) {
      connectionState.reason =
        err.response.status === 401 || err.response.status === 403
          ? 'WordPress rejected the configured credentials.'
          : `WordPress responded with HTTP ${err.response.status}.`;
    } else {
      connectionState.reason = `Could not reach ${env.wpUrl} (${err.code || err.message}).`;
    }
    console.error(`WordPress self-check failed: ${connectionState.reason}`);
  } finally {
    connectionState.lastCheckedAt = Date.now();
  }
}

export function checkConnection() {
  if (!inFlightCheck) {
    inFlightCheck = performCheck().finally(() => {
      inFlightCheck = null;
    });
  }
  return inFlightCheck;
}

// Fire-and-forget: called from the /api/status handler so a stale cached
// state gets refreshed for the *next* request, without adding the WP
// round-trip's latency to the current one.
export function refreshConnectionIfStale() {
  if (!connectionState.lastCheckedAt || Date.now() - connectionState.lastCheckedAt >= STALE_AFTER_MS) {
    checkConnection();
  }
}

// Lets an upload failure mark the connection down immediately, rather than
// waiting up to STALE_AFTER_MS for the next passive refresh to notice.
export function invalidateConnection(reason) {
  connectionState.connected = false;
  connectionState.user = null;
  connectionState.reason = reason;
  connectionState.lastCheckedAt = Date.now();
  console.error(`WordPress connection invalidated: ${reason}`);
}
