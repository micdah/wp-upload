import { useCallback, useRef, useState } from 'react';

export function Dropzone({ onFiles }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      setIsDragging(false);
      if (event.dataTransfer.files.length > 0) {
        onFiles(event.dataTransfer.files);
      }
    },
    [onFiles]
  );

  return (
    <div
      className={`dropzone ${isDragging ? 'dropzone-active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <p>Drag &amp; drop media files here, or click to browse</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files.length > 0) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
