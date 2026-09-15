import crypto from 'node:crypto';
import { env } from '../config/env.js';

const MAX_FAILURES = 10;
const WINDOW_MS = 5 * 60 * 1000;

// IP -> { count, windowStart }. In-memory is fine for a single-process,
// single-instance app; a restart just resets the lockout.
const failures = new Map();

function hash(value) {
  return crypto.createHash('sha256').update(value).digest();
}

// Hashing both sides to a fixed length first lets us use timingSafeEqual
// (which throws on mismatched lengths) without leaking the real
// username/password length through an early length-check branch.
function safeEqual(a, b) {
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function isLockedOut(ip) {
  const entry = failures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(ip) {
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.windowStart > WINDOW_MS) {
    failures.set(ip, { count: 1, windowStart: Date.now() });
  } else {
    entry.count += 1;
  }
}

export function basicAuth(req, res, next) {
  const ip = req.ip;

  if (isLockedOut(ip)) {
    res.set('Retry-After', String(WINDOW_MS / 1000));
    return res.status(429).json({
      code: 'too_many_attempts',
      message: 'Too many failed login attempts. Try again later.',
    });
  }

  const reject = () => {
    recordFailure(ip);
    res.set('WWW-Authenticate', 'Basic realm="WP Media Uploader", charset="UTF-8"');
    return res.status(401).json({ code: 'unauthorized', message: 'Authentication required.' });
  };

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) return reject();

  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return reject();
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) return reject();

  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);

  if (!safeEqual(user, env.authUsername) || !safeEqual(pass, env.authPassword)) {
    return reject();
  }

  failures.delete(ip);
  next();
}
