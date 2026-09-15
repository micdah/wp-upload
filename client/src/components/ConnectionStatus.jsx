import { useEffect, useState } from 'react';
import { Alert, Text } from '@mantine/core';

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
    return (
      <Alert color="gray" variant="light">
        Checking connection…
      </Alert>
    );
  }

  if (status.connected) {
    return (
      <Alert color="green" variant="light" title="Connected">
        <Text span fw={600}>
          {status.wpUrl}
        </Text>{' '}
        as{' '}
        <Text span fw={600}>
          {status.user}
        </Text>
      </Alert>
    );
  }

  return (
    <Alert color="red" variant="light" title="Not connected">
      {status.reason || 'Unknown error'}
      <Text size="xs" c="dimmed" mt={4}>
        Check server/.env and restart the server.
      </Text>
    </Alert>
  );
}
