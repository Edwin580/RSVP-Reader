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
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
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
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
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
