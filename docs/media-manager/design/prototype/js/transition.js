// Shared-element "morph" between a grid tile and the detail stage, using the
// View Transitions API. Only the one element involved gets a
// view-transition-name. Under reduced motion it falls back to the default
// root cross-fade. Without API support the update just happens.

import { prefersReducedMotion } from './util.js'

const HERO = 'hero'

export function morph(applyUpdate, { from, to } = {}) {
  if (!document.startViewTransition) {
    applyUpdate()
    return
  }
  const animateHero = !prefersReducedMotion()
  if (animateHero && from) from.style.viewTransitionName = HERO
  let target = null
  const transition = document.startViewTransition(() => {
    if (from) from.style.viewTransitionName = ''
    applyUpdate()
    target = animateHero ? to?.() : null
    if (target) target.style.viewTransitionName = HERO
  })
  transition.finished.finally(() => {
    if (target) target.style.viewTransitionName = ''
  })
}
