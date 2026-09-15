export function NyanUnicorn({ size = 240 }) {
  const height = Math.round((size * 110) / 240);

  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 240 110"
      role="img"
      aria-label="Nyan-cat-inspired unicorn"
      className="nyan-unicorn"
    >
      <defs>
        <pattern id="nyanTrail" width="24" height="56" patternUnits="userSpaceOnUse">
          <rect width="24" height="8" y="0" fill="#ff2d6f" />
          <rect width="24" height="8" y="8" fill="#ff9a2e" />
          <rect width="24" height="8" y="16" fill="#ffe14d" />
          <rect width="24" height="8" y="24" fill="#3ddc84" />
          <rect width="24" height="8" y="32" fill="#00c2ff" />
          <rect width="24" height="8" y="40" fill="#7c4dff" />
          <rect width="24" height="8" y="48" fill="#ff2d6f" />
        </pattern>
        <linearGradient id="nyanHorn" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#0070e0" />
          <stop offset="100%" stopColor="#b3fbff" />
        </linearGradient>
        <radialGradient id="nyanBody" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dbe4ff" />
        </radialGradient>
      </defs>

      <rect x="0" y="27" width="150" height="56" fill="url(#nyanTrail)" />

      <g>
        <circle cx="150" cy="70" r="7" fill="#ff2d6f" />
        <circle cx="158" cy="76" r="6" fill="#ffe14d" />
        <circle cx="166" cy="70" r="6" fill="#00c2ff" />
      </g>

      <ellipse cx="180" cy="62" rx="42" ry="24" fill="url(#nyanBody)" stroke="#b8c7ff" strokeWidth="1.5" />

      <rect x="150" y="80" width="8" height="16" rx="3" fill="#eef1ff" stroke="#b8c7ff" strokeWidth="1" />
      <rect x="170" y="82" width="8" height="16" rx="3" fill="#eef1ff" stroke="#b8c7ff" strokeWidth="1" />
      <rect x="192" y="82" width="8" height="16" rx="3" fill="#eef1ff" stroke="#b8c7ff" strokeWidth="1" />
      <rect x="208" y="80" width="8" height="16" rx="3" fill="#eef1ff" stroke="#b8c7ff" strokeWidth="1" />

      <circle cx="205" cy="34" r="20" fill="url(#nyanBody)" stroke="#b8c7ff" strokeWidth="1.5" />

      <path d="M 191 21 L 195 9 L 200 19 Z" fill="#eef1ff" stroke="#b8c7ff" strokeWidth="1" />
      <path d="M 201 18 L 205 0 L 209 18 Z" fill="url(#nyanHorn)" />

      <g>
        <circle cx="188" cy="24" r="6" fill="#ff2d6f" />
        <circle cx="184" cy="34" r="6" fill="#ffe14d" />
        <circle cx="186" cy="45" r="6" fill="#00c2ff" />
        <circle cx="192" cy="53" r="6" fill="#7c4dff" />
      </g>

      <circle cx="213" cy="32" r="2.2" fill="#12202f" />
      <circle cx="222" cy="40" r="3" fill="#ff9ac2" opacity="0.7" />
      <path d="M 212 40 Q 215 43 218 40" stroke="#12202f" strokeWidth="1.4" fill="none" strokeLinecap="round" />

      <path className="nyan-star nyan-star-1" d="M40 12 L42 18 L48 18 L43 22 L45 28 L40 24 L35 28 L37 22 L32 18 L38 18 Z" fill="#e6feff" />
      <path className="nyan-star nyan-star-2" d="M85 55 L86.5 59 L90.5 59 L87 61.5 L88 65.5 L85 63 L82 65.5 L83 61.5 L79.5 59 L83.5 59 Z" fill="#e6feff" />
      <path className="nyan-star nyan-star-3" d="M110 20 L111 23 L114 23 L111.5 25 L112.5 28 L110 26 L107.5 28 L108.5 25 L106 23 L109 23 Z" fill="#e6feff" />
    </svg>
  );
}
