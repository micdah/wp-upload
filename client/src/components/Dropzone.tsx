import { Text } from "@mantine/core"
import {
  type FileWithPath,
  Dropzone as MantineDropzone,
} from "@mantine/dropzone"

interface DropzoneProps {
  onFiles: (files: FileWithPath[]) => void
}

export function Dropzone({ onFiles }: DropzoneProps) {
  return (
    <MantineDropzone onDrop={onFiles} multiple className="cyber-dropzone">
      <Text ta="center" c="dimmed">
        Drag &amp; drop media files here, or click to browse
      </Text>
    </MantineDropzone>
  )
}
