import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  answerPendingConfirm,
  type ConfirmFocusEnvironment,
  confirm,
  pendingConfirm,
  setConfirmFocusEnvironmentForTesting,
} from './confirm'

interface FakeElement {
  name: string
  isConnected: boolean
  focus(): void
}

function fakeFocus() {
  let focused: FakeElement | null = null
  const frames: (() => void)[] = []
  const env: ConfirmFocusEnvironment = {
    focused: () => focused,
    afterUnmount: (run) => {
      frames.push(run)
    },
  }
  function element(name: string): FakeElement {
    const el: FakeElement = {
      name,
      isConnected: true,
      focus() {
        focused = el
      },
    }
    return el
  }
  return {
    env,
    element,
    focus(el: FakeElement | null) {
      focused = el
    },
    focused: () => focused,
    /** Runs the pending "next frame" callbacks. */
    frame() {
      for (const run of frames.splice(0)) {
        run()
      }
    },
  }
}

let dom: ReturnType<typeof fakeFocus>

beforeEach(() => {
  dom = fakeFocus()
  setConfirmFocusEnvironmentForTesting(dom.env)
})

afterEach(() => {
  while (pendingConfirm()) {
    answerPendingConfirm(false)
  }
  setConfirmFocusEnvironmentForTesting(null)
})

describe('confirm()', () => {
  it('resolves with the answer, one request at a time', async () => {
    const first = confirm({ title: 'Delete 3 items?' })
    const second = confirm({ title: 'Empty the Trash?' })
    expect(pendingConfirm()?.title).toBe('Delete 3 items?')
    answerPendingConfirm(true)
    expect(pendingConfirm()?.title).toBe('Empty the Trash?')
    answerPendingConfirm(false)
    expect(await first).toBe(true)
    expect(await second).toBe(false)
  })

  it('returns focus to the opener once the dialog has gone (spike C4)', () => {
    const opener = dom.element('delete button')
    dom.focus(opener)
    void confirm({ title: 'Delete?' })
    // The dialog takes focus; closing it unmounts it and focus falls to body.
    dom.focus(dom.element('confirm button'))
    answerPendingConfirm(true)
    dom.focus(null)
    dom.frame()
    expect(dom.focused()).toBe(opener)
  })

  it('leaves focus alone when something else took it meanwhile', () => {
    const opener = dom.element('delete button')
    dom.focus(opener)
    void confirm({ title: 'Delete?' })
    answerPendingConfirm(true)
    const next = dom.element('next tile')
    dom.focus(next)
    dom.frame()
    expect(dom.focused()).toBe(next)
  })

  it('skips an opener that left the page', () => {
    const opener = dom.element('menu item')
    dom.focus(opener)
    void confirm({ title: 'Delete?' })
    answerPendingConfirm(false)
    opener.isConnected = false
    dom.focus(null)
    dom.frame()
    expect(dom.focused()).toBeNull()
  })

  it('waits for the last queued request before restoring focus', () => {
    const opener = dom.element('button')
    dom.focus(opener)
    void confirm({ title: 'First?' })
    void confirm({ title: 'Second?' })
    answerPendingConfirm(true)
    dom.focus(null)
    dom.frame()
    expect(dom.focused()).toBeNull()
    answerPendingConfirm(true)
    dom.frame()
    expect(dom.focused()).toBe(opener)
  })

  it('returns focus to the first opener of a queued chain', () => {
    const opener = dom.element('delete button')
    dom.focus(opener)
    void confirm({ title: 'First?' })
    // The second request is made while the first dialog has focus.
    const inDialog = dom.element('confirm button')
    dom.focus(inDialog)
    void confirm({ title: 'Second?' })
    answerPendingConfirm(true)
    answerPendingConfirm(true)
    inDialog.isConnected = false
    dom.focus(null)
    dom.frame()
    expect(dom.focused()).toBe(opener)
  })
})
