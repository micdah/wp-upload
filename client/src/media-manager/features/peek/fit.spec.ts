import { describe, expect, it } from 'vitest'
import { peekSize, truncateMiddle } from './fit'

const AREA = { width: 1000, height: 700 }

describe('peekSize', () => {
  it('fits a wide picture to 86 % of the width', () => {
    expect(peekSize({ width: 4000, height: 2000 }, AREA)).toEqual({
      width: 860,
      height: 430,
    })
  })

  it('fits a tall picture to 80 % of the height', () => {
    expect(peekSize({ width: 2000, height: 4000 }, AREA)).toEqual({
      width: 280,
      height: 560,
    })
  })

  it('never upscales a small picture', () => {
    expect(peekSize({ width: 300, height: 200 }, AREA)).toEqual({
      width: 300,
      height: 200,
    })
  })

  it('treats an unknown size as a square in the area', () => {
    expect(peekSize({ width: 0, height: 0 }, AREA)).toEqual({
      width: 560,
      height: 560,
    })
  })

  it('copes with an area of nothing', () => {
    expect(
      peekSize({ width: 100, height: 100 }, { width: 0, height: 0 }),
    ).toEqual({ width: 0, height: 0 })
  })
})

describe('truncateMiddle', () => {
  it('keeps short names and the ends of long ones', () => {
    expect(truncateMiddle('beach.jpg', 20)).toBe('beach.jpg')
    const long = 'a-very-long-file-name-from-a-camera-export.jpeg'
    const short = truncateMiddle(long, 20)
    expect(short).toHaveLength(20)
    expect(short.startsWith('a-very-lon')).toBe(true)
    expect(short.endsWith('port.jpeg')).toBe(true)
    expect(short).toContain('…')
  })
})
