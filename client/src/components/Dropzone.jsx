import { Dropzone as MantineDropzone } from '@mantine/dropzone';
import { Text } from '@mantine/core';

export function Dropzone({ onFiles }) {
  return (
    <MantineDropzone onDrop={onFiles} multiple>
      <Text ta="center" c="dimmed">
        Drag &amp; drop media files here, or click to browse
      </Text>
    </MantineDropzone>
  );
}
