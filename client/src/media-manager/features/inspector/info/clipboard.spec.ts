import { describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

describe('copyText', () => {
  it('writes the text and reports success', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    await expect(
      copyText('https://example.com/a.jpg', { writeText }),
    ).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://example.com/a.jpg')
  })

  it('reports failure when the clipboard rejects', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    await expect(copyText('x', { writeText })).resolves.toBe(false)
  })

  it('reports failure without a clipboard', async () => {
    await expect(copyText('x', null)).resolves.toBe(false)
    await expect(
      copyText(
        'x',
        {} as unknown as { writeText(text: string): Promise<void> },
      ),
    ).resolves.toBe(false)
  })
})
