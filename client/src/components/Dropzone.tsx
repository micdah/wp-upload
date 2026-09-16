import { Dropzone as MantineDropzone, type FileWithPath } from '@mantine/dropzone';
import { Text } from '@mantine/core';

interface DropzoneProps {
  onFiles: (files: FileWithPath[]) => void;
}

export function Dropzone({ onFiles }: DropzoneProps) {
  return (
    <MantineDropzone onDrop={onFiles} multiple className="cyber-dropzone">
      <Text ta="center" c="dimmed">
        Drag &amp; drop media files here, or click to browse
      </Text>
    </MantineDropzone>
  );
}
