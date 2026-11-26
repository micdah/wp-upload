// The mock build's service worker. vite.mock.config.ts serves it as
// `mock-sw.js`, next to MSW's own `mockServiceWorker.js`, which it imports
// unchanged (MSW's "merging service workers" recipe). Plain JavaScript,
// because the browser runs it as it is.
//
// The one listener below runs before MSW's and keeps two kinds of request
// away from MSW, so the browser handles them natively:
//
// - Page navigations (except to `api/`, where the mock answers downloads).
//   MSW sends every request to the page and waits for its answer. WebKit
//   gives a service worker 70 s to answer a top-level navigation; when one
//   takes longer it loads the page from the network and from then on sends
//   every request of every tab straight to the network, past the worker,
//   until the worker is replaced. The mock never answers a navigation, so
//   the worker has no reason to see one.
// - Requests to other origins (picsum.photos photos, web fonts). No handler
//   matches them, and in the 50k feel review they are hundreds of round
//   trips through the worker and the page.

/** Whether MSW should never see this request (tested in serviceWorker.spec.ts). */
function shouldBypassMock(request, scope) {
  const url = new URL(request.url)
  const scopeUrl = new URL(scope)
  if (url.origin !== scopeUrl.origin) {
    return true
  }
  if (request.mode !== 'navigate') {
    return false
  }
  const path = url.pathname.startsWith(scopeUrl.pathname)
    ? url.pathname.slice(scopeUrl.pathname.length)
    : url.pathname
  return !path.startsWith('api/')
}

self.addEventListener('fetch', (event) => {
  if (shouldBypassMock(event.request, self.registration.scope)) {
    // Without respondWith() the browser loads the request itself.
    event.stopImmediatePropagation()
  }
})

importScripts('./mockServiceWorker.js')
