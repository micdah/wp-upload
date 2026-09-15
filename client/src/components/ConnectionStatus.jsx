import { useEffect, useState } from 'react';
import { Box, Group, Text } from '@mantine/core';

export const STATUS_BAR_HEIGHT = 36;

const DOT_COLOR = { loading: 'gray', connected: 'teal', error: 'red' };

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

  let state = 'loading';
  let label = 'Checking connection…';

  if (!status.loading) {
    if (status.connected) {
      state = 'connected';
      label = `Connected to ${status.wpUrl} as ${status.user}`;
    } else {
      state = 'error';
      label = `Not connected: ${status.reason || 'unknown error'}`;
    }
  }

  return (
    <Box className="cyber-statusbar" h={STATUS_BAR_HEIGHT} px="md">
      <Group gap={8} wrap="nowrap" justify="center" h="100%">
        <Box w={7} h={7} bg={DOT_COLOR[state]} style={{ borderRadius: '50%', flexShrink: 0 }} />
        <Text size="xs" c="dimmed" truncate maw="90%">
          {label}
        </Text>
      </Group>
    </Box>
  );
}
