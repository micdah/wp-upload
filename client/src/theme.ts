import { createTheme, type MantineColorsTuple } from '@mantine/core'

// A cyan-to-blue "neon" palette, lightest to darkest.
const neon: MantineColorsTuple = [
  '#e6feff',
  '#b3fbff',
  '#80f8ff',
  '#4df4ff',
  '#1af1ff',
  '#00e5ff',
  '#00c2ff',
  '#0099ff',
  '#0070e0',
  '#0047a3',
]

// Mantine's neutral "dark" palette, shifted from gray to a blue-black tint
// so surfaces/borders/body background all carry the cyberpunk hue instead
// of Mantine's default neutral gray.
const dark: MantineColorsTuple = [
  '#d6e4f0',
  '#aac4dd',
  '#7fa3ca',
  '#4a6f92',
  '#2c3e56',
  '#1f2c40',
  '#16202f',
  '#0d1420',
  '#080d16',
  '#03060b',
]

export const theme = createTheme({
  primaryColor: 'neon',
  primaryShade: { light: 6, dark: 4 },
  autoContrast: true,
  defaultRadius: 'md',
  colors: { neon, dark },
  fontFamily: 'Rajdhani, sans-serif',
  headings: {
    fontFamily: 'Orbitron, sans-serif',
    fontWeight: '700',
  },
})
