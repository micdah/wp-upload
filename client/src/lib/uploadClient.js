// Wraps XMLHttpRequest (not fetch) because it reliably exposes upload
// progress events for the browser -> local backend leg.
export function uploadFile(file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.open('POST', '/api/media');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let body;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = { code: 'invalid_response', message: 'Server returned an unreadable response.' };
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
      } else {
        reject(body);
      }
    };

    xhr.onerror = () => reject({ code: 'network_error', message: 'Network error contacting the local server.' });
    xhr.onabort = () => reject({ code: 'aborted', message: 'Upload cancelled.' });

    if (signal) {
      signal.addEventListener('abort', () => xhr.abort());
    }

    xhr.send(formData);
  });
}
