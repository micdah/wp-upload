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

// In-memory connection status, refreshed at startup and exposed via /api/status.
export const connectionState = {
  connected: false,
  user: null,
  reason: null,
};

export async function checkConnection() {
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
  }
}
