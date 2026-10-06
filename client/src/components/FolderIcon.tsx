interface FolderIconProps {
  size?: number
  open?: boolean
}

// Inline SVG rather than an icon library - it's the only icon the app needs.
export function FolderIcon({ size = 14, open = false }: FolderIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      style={{ flexShrink: 0 }}
    >
      {open ? (
        <path d='M5 19a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h7a2 2 0 0 1 2 2v2M5 19h14a2 2 0 0 0 2-1.5l1.5-6A1 1 0 0 0 21.5 10H8a2 2 0 0 0-1.9 1.4L4 19' />
      ) : (
        <path d='M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z' />
      )}
    </svg>
  )
}
