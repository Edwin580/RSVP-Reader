/* global self, caches, fetch */
/**
 * Offline support. The build fills in PRECACHE (every built file plus
 * everything in public/) and VERSION (a hash of them), so a new deploy
 * gets a fresh cache.
 *
 * - Page loads: network first, falling back to the cached app when offline
 *   or when the network takes too long, so updates show up right away
 *   online and the app still opens on a plane.
 * - Everything else: cache first. Built files have content hashes in their
 *   names, so a cached copy is never stale.
 */
const VERSION = "397e2c624541"
const PRECACHE = ["./","./assets/covers-D6T0RbYq.js","./assets/demo-CUsDH-Lr.js","./assets/epub-D723sTPO.js","./assets/index-DL8BpoIB.js","./assets/index-mWWg-AqB.css","./assets/parse.worker-C6ExXA5f.js","./assets/pdf-CMUzFUAO.js","./assets/pdf.worker.min-BmVo14Nb.mjs","./assets/search.worker-CgCEYrNq.js","./apple-touch-icon.png","./favicon.ico","./favicon.svg","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./manifest.webmanifest"]
const PREFIX = 'rsvp-reader-'
const CACHE = PREFIX + VERSION
/** Give up on the network for page loads after this long and use the cached app. */
const NAVIGATION_TIMEOUT_MS = 3000

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // Keep the previous version too: a page opened before this update
        // may still load its lazy chunks (the PDF reader, say), which the
        // new deploy no longer serves.
        const ours = keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE)
        return Promise.all(ours.slice(0, -1).map((k) => caches.delete(k)))
      })
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // Pull request previews live under this app's path but are separate apps; leave them alone.
  if (url.pathname.startsWith(new URL('pr-preview/', self.registration.scope).pathname)) return
  event.respondWith(request.mode === 'navigate' ? navigation(request) : cacheFirst(request))
})

async function navigation(request) {
  const cache = await caches.open(CACHE)
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put('./', response.clone())
    return response
  })
  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS))
  try {
    const response = await Promise.race([network, timeout])
    if (response) return response
  } catch {
    // Offline: fall through to the cached app.
  }
  const cached = await caches.match('./')
  return cached ?? network
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true })
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(CACHE)
    cache.put(request, response.clone())
  }
  return response
}
