// A handful of small canvas-drawn images, reused by all 50k tiles, so the
// view-transition snapshots carry real image content.

const COLOURS = [
  '#e4572e',
  '#29335c',
  '#f3a712',
  '#669bbc',
  '#a8c686',
  '#8e44ad',
  '#16a085',
  '#c0392b',
]

function drawImage(index: number): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = 180
  const context = canvas.getContext('2d')
  if (!context) {
    return Promise.resolve('')
  }
  context.fillStyle = COLOURS[index] ?? '#888'
  context.fillRect(0, 0, 240, 180)
  context.fillStyle = 'rgba(255,255,255,0.85)'
  context.beginPath()
  context.arc(70, 70, 40, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = 'rgba(0,0,0,0.6)'
  context.fillRect(110, 110, 110, 50)
  context.fillStyle = '#fff'
  context.font = 'bold 36px sans-serif'
  context.fillText(String(index), 150, 148)
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? URL.createObjectURL(blob) : '')
    }, 'image/png')
  })
}

export function makeImages(count: number): Promise<string[]> {
  return Promise.all(
    Array.from({ length: count }, (_, index) => drawImage(index)),
  )
}
