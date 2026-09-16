import fs from 'node:fs';
import axios from 'axios';
import { invalidateConnection, wpAxios } from '../config/wpClient.ts';

export interface WpError {
  status: number;
  code: string;
  message: string;
}

export interface UploadResult {
  id: number;
  title: string;
  sourceUrl: string;
  mimeType: string;
}

// Streams a multer temp file to WordPress's media endpoint. Never buffers
// the whole file in memory. Throws a normalised { status, code, message }
// on any failure so the route handler can respond consistently.
export async function uploadToWordPress(file: Express.Multer.File): Promise<UploadResult> {
  const stream = fs.createReadStream(file.path);

  try {
    const { data } = await wpAxios.post('/wp-json/wp/v2/media', stream, {
      headers: {
        'Content-Type': file.mimetype || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.originalname)}"`,
        'Content-Length': file.size,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return {
      id: data.id,
      title: data.title?.rendered ?? file.originalname,
      sourceUrl: data.source_url,
      mimeType: data.mime_type,
    };
  } catch (err) {
    const wpError = normaliseWpError(err);
    if (wpError.status === 401 || wpError.status === 403) {
      invalidateConnection('WordPress rejected the configured credentials.');
    }
    throw wpError;
  }
}

function normaliseWpError(err: unknown): WpError {
  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED') {
      return {
        status: 504,
        code: 'wp_timeout',
        message: 'WordPress did not respond in time. The upload was aborted so it would not block others.',
      };
    }

    if (err.response) {
      const { status, data } = err.response;
      // WordPress normally returns JSON like { code, message }, but a WAF,
      // maintenance mode, or a PHP fatal can return an HTML page instead.
      if (data && typeof data === 'object' && data.message) {
        return { status, code: data.code || 'wp_error', message: data.message };
      }
      return {
        status,
        code: 'wp_unexpected_response',
        message: `WordPress returned an unexpected response (HTTP ${status}). ` +
          'This can happen if the host has a size limit, WAF rule, or maintenance mode enabled.',
      };
    }

    return {
      status: 502,
      code: 'wp_unreachable',
      message: `Could not reach WordPress (${err.code || err.message}).`,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return { status: 502, code: 'wp_unreachable', message: `Could not reach WordPress (${message}).` };
}
