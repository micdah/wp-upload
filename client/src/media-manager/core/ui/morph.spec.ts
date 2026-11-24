import { describe, expect, it, vi } from 'vitest'
import {
  MORPH_NAME,
  MORPH_TARGET_TIMEOUT_MS,
  type MorphEnvironment,
  morphWith,
} from './morph'

function fakeElement(): Element {
  return { style: { viewTransitionName: '' } } as unknown as Element
}

function nameOf(element: Element): string {
  return (element as unknown as { style: { viewTransitionName: string } }).style
    .viewTransitionName
}

interface Recorder {
  env: MorphEnvironment
  log: string[]
}

function setup(options: {
  api?: boolean
  reducedMotion?: boolean
  timeoutMs?: number
}): Recorder {
  const log: string[] = []
  const env: MorphEnvironment = {
    startViewTransition:
      options.api === false
        ? null
        : (update) => {
            log.push('start')
            const finished = update().then(() => {
              log.push('snapshot')
            })
            return { finished }
          },
    reducedMotion: () => options.reducedMotion ?? false,
    flush: (update) => {
      log.push('flush')
      update()
    },
    timeoutMs: options.timeoutMs ?? MORPH_TARGET_TIMEOUT_MS,
  }
  return { env, log }
}

describe('morph', () => {
  it('names from in the old snapshot and to in the new one, then clears both', async () => {
    const { env } = setup({})
    const from = fakeElement()
    const to = fakeElement()
    let fromNameAtStart = ''
    let toNameAfterUpdate = ''
    const start = env.startViewTransition
    env.startViewTransition = (update) => {
      fromNameAtStart = nameOf(from)
      return start?.(async () => {
        await update()
        toNameAfterUpdate = nameOf(to)
      }) as { finished: Promise<void> }
    }
    await morphWith(env, () => {}, { from: () => from, to: () => to })
    expect(fromNameAtStart).toBe(MORPH_NAME)
    expect(toNameAfterUpdate).toBe(MORPH_NAME)
    expect(nameOf(from)).toBe('')
    expect(nameOf(to)).toBe('')
  })

  it('calls to (the reveal) under reduced motion, without naming anything', async () => {
    const { env } = setup({ reducedMotion: true })
    const from = vi.fn(fakeElement)
    const element = fakeElement()
    const to = vi.fn(() => element)
    await morphWith(env, () => {}, { from, to })
    expect(from).not.toHaveBeenCalled()
    expect(to).toHaveBeenCalledTimes(1)
    expect(nameOf(element)).toBe('')
  })

  it('without the API: runs the update, then to', async () => {
    const { env, log } = setup({ api: false })
    const to = vi.fn(() => {
      log.push('to')
      return null
    })
    await morphWith(env, () => log.push('update'), { to })
    expect(log).toEqual(['flush', 'update', 'to'])
  })

  it('gives up on the hero when to takes longer than the timeout', async () => {
    vi.useFakeTimers()
    const { env } = setup({ timeoutMs: MORPH_TARGET_TIMEOUT_MS })
    const late = fakeElement()
    const done = morphWith(env, () => {}, {
      to: () => new Promise((resolve) => setTimeout(() => resolve(late), 1000)),
    })
    await vi.advanceTimersByTimeAsync(MORPH_TARGET_TIMEOUT_MS)
    await done
    vi.useRealTimers()
    expect(nameOf(late)).toBe('')
  })

  it('uses a 150 ms timeout (spike C2)', () => {
    expect(MORPH_TARGET_TIMEOUT_MS).toBe(150)
  })

  it('survives a skipped transition', async () => {
    const { env } = setup({})
    env.startViewTransition = (update) => ({
      finished: update().then(() => Promise.reject(new Error('skipped'))),
    })
    await expect(morphWith(env, () => {}, {})).resolves.toBeUndefined()
  })
})
