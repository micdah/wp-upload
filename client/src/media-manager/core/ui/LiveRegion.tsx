import { VisuallyHidden } from '@mantine/core'
import { useEffect, useState } from 'react'
import { subscribeAnnouncements } from './announce'

// How long the region stays empty before new text goes in. Screen readers
// only speak a change, so clearing first makes a repeated message speak again.
const CLEAR_MS = 60

/** The app's one polite live region. Mount it once, near the root. */
export function LiveRegion() {
  const [text, setText] = useState('')
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribeAnnouncements((message) => {
      setText('')
      clearTimeout(timer)
      timer = setTimeout(() => setText(message), CLEAR_MS)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [])
  return (
    <VisuallyHidden
      role='status'
      aria-live='polite'
      aria-atomic='true'
      data-mm-live-region=''
    >
      {text}
    </VisuallyHidden>
  )
}
