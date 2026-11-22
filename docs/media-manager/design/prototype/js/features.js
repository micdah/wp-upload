// Registry for feature modules added in later stages (folders CRUD, editing,
// upload, system states…). A feature gets `init()` once after the core is
// ready and `onChange(changes)` after every state update.

const features = []

export function registerFeature(feature) {
  features.push(feature)
}

export function initFeatures() {
  for (const feature of features) feature.init?.()
}

export function notifyFeatures(changes) {
  for (const feature of features) feature.onChange?.(changes)
}
