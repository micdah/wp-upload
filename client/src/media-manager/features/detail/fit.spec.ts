import { describe, expect, it } from 'vitest'
import { fitInto, scaleOf, zoomedSize } from './fit'

describe('fitInto', () => {
  it('fits a landscape image to the width and a portrait one to the height', () => {
    expect(
      fitInto({ kind: 'image', width: 3000, height: 2000 }, 900, 900),
    ).toEqual({
      width: 900,
      height: 600,
    })
    expect(
      fitInto({ kind: 'image', width: 2000, height: 3000 }, 900, 600),
    ).toEqual({
      width: 400,
      height: 600,
    })
  })

  it('never upscales past the image’s own pixels', () => {
    expect(
      fitInto({ kind: 'image', width: 300, height: 200 }, 900, 900),
    ).toEqual({
      width: 300,
      height: 200,
    })
  })

  it('treats unknown sizes as square and documents as a portrait page', () => {
    expect(fitInto({ kind: 'image', width: 0, height: 0 }, 800, 400)).toEqual({
      width: 400,
      height: 400,
    })
    expect(
      fitInto({ kind: 'document', width: 0, height: 0 }, 900, 400),
    ).toEqual({
      width: 300,
      height: 400,
    })
  })

  it('shows a video of unknown size as 16:9', () => {
    expect(fitInto({ kind: 'video', width: 0, height: 0 }, 800, 800)).toEqual({
      width: 800,
      height: 450,
    })
  })

  it('is empty without room', () => {
    expect(fitInto({ kind: 'image', width: 10, height: 10 }, 0, 100)).toEqual({
      width: 0,
      height: 0,
    })
  })
})

describe('zoomedSize', () => {
  it('scales the item’s own pixels', () => {
    expect(
      zoomedSize({ kind: 'image', width: 3000, height: 2000 }, 0.5),
    ).toEqual({
      width: 1500,
      height: 1000,
    })
    expect(zoomedSize({ kind: 'image', width: 300, height: 200 }, 2)).toEqual({
      width: 600,
      height: 400,
    })
  })
})

describe('scaleOf', () => {
  it('is the shown width over the item’s own', () => {
    expect(
      scaleOf(
        { kind: 'image', width: 3000, height: 2000 },
        { width: 900, height: 600 },
      ),
    ).toBeCloseTo(0.3)
    expect(
      scaleOf(
        { kind: 'image', width: 0, height: 0 },
        { width: 400, height: 400 },
      ),
    ).toBe(1)
  })
})
