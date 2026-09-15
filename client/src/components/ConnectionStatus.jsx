import { useEffect, useState } from 'react';

export function ConnectionStatus({ onStatus }) {
  const [status, setStatus] = useState({ loading: true });

  useEffect(() => {
    fetch('/api/status')
      .then((res) => res.json())
      .then((data) => {
        setStatus({ loading: false, ...data });
        onStatus?.(data);
      })
      .catch(() =>
        setStatus({
          loading: false,
          connected: false,
          reason: 'Could not reach the local server. Is it running?',
        })
      );
  }, [onStatus]);

  if (status.loading) {
    return <div className="banner banner-neutral">Checking connection…</div>;
  }

  if (status.connected) {
    return (
      <div className="banner banner-ok">
        Connected to <strong>{status.wpUrl}</strong> as <strong>{status.user}</strong>
      </div>
    );
  }

  return (
    <div className="banner banner-error">
      Not connected: {status.reason || 'unknown error'}
      <div className="banner-hint">Check server/.env and restart the server.</div>
    </div>
  );
}
