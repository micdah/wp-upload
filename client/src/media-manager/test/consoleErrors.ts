import { afterEach, beforeEach, expect, vi } from 'vitest'

// Fails a browser spec on React warnings that point at a lifecycle bug,
// which React only logs with console.error (the test would pass otherwise).
// The iPad feel review found "flushSync was called from inside a lifecycle
// method": the grid followed the item in detail by dispatching a scroll
// event inside a layout effect, and the virtualiser answered with flushSync.
//
//   failOnReactWarnings()   // at the top level of a spec file

const REACT_LIFECYCLE_WARNINGS = [
  /flushSync was called from inside a lifecycle method/,
  /Cannot update a component .* while rendering a different component/,
  /Maximum update depth exceeded/,
]

function describeArguments(args: readonly unknown[]): string {
  return args
    .map((value) => (value instanceof Error ? value.message : String(value)))
    .join(' ')
}

export function failOnReactWarnings(): void {
  let warnings: string[] = []
  beforeEach(() => {
    warnings = []
    const original = console.error
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const message = describeArguments(args)
      if (REACT_LIFECYCLE_WARNINGS.some((pattern) => pattern.test(message))) {
        warnings.push(message)
      }
      original(...args)
    })
  })
  afterEach(() => {
    vi.mocked(console.error).mockRestore()
    expect(warnings, 'React lifecycle warnings').toEqual([])
  })
}
