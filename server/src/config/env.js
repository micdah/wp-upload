import dotenv from 'dotenv';

dotenv.config();

const REQUIRED_VARS = ['WP_URL', 'WP_USERNAME', 'WP_APP_PASSWORD', 'AUTH_USERNAME', 'AUTH_PASSWORD'];

function loadEnv() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(', ')}.\n` +
        'Copy server/.env.example to server/.env and fill in your WordPress site details ' +
        '(create an Application Password under wp-admin -> Users -> Profile).'
    );
    process.exit(1);
  }

  let wpUrl;
  try {
    wpUrl = new URL(process.env.WP_URL);
  } catch {
    console.error(`WP_URL is not a valid URL: "${process.env.WP_URL}"`);
    process.exit(1);
  }

  return {
    wpUrl: wpUrl.toString().replace(/\/$/, ''),
    wpUsername: process.env.WP_USERNAME,
    wpAppPassword: process.env.WP_APP_PASSWORD,
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 3001,
    uploadConcurrency: Number(process.env.UPLOAD_CONCURRENCY) || 8,
    maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB) || 200,
    authUsername: process.env.AUTH_USERNAME,
    authPassword: process.env.AUTH_PASSWORD,
    // Only enable if a reverse proxy in front of this app sets X-Forwarded-For
    // itself and strips any client-supplied one - otherwise this lets clients
    // spoof their IP and bypass the login rate limit entirely.
    trustProxy: process.env.TRUST_PROXY === 'true',
  };
}

export const env = loadEnv();
