import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval'
import {
  PER_PAGE,
  bookUrl,
  fetchPage,
  fetchText,
  listUrl,
  parseCatalogPage,
  parseContents,
  parseDetails,
  parseSection,
  type CatalogBook,
  type CatalogDetails,
  type CatalogOrder,
  type ContentsEntry,
  type PreviewSection,
} from './catalog'
import { INDEX_VERSION, freshness, withNewest, type CatalogIndex, type IndexedBook } from './catalogIndex'
import { storageName } from './preview'

/**
 * The catalog kept on the device: the index of every book (fetched once and
 * refreshed weekly, in the background), and each book's page and preview
 * sections once looked at. Browsing opens straight away from what's kept,
 * works offline, and only waits on the network for what hasn't been seen.
 *
 * It's a separate database from the library's, so backups don't carry it
 * and clearing it never touches a book.
 */

/** Where things are kept: IndexedDB in the app, a Map in tests. */
export interface KeyValue {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  keys(): Promise<string[]>
}

let idbStore: UseStore | null = null
const idb = (): UseStore => (idbStore ??= createStore(storageName('chapter-catalog'), 'kv'))
const indexedDb: KeyValue = {
  get: (key) => get(key, idb()),
  set: (key, value) => set(key, value, idb()),
  del: (key) => del(key, idb()),
  keys: async () => (await entries(idb())).map(([k]) => String(k)),
}

export function memoryStore(): KeyValue & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>()
  return {
    map,
    get: async <T,>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => void map.set(key, value),
    del: async (key) => void map.delete(key),
    keys: async () => [...map.keys()],
  }
}

let kv: KeyValue = indexedDb
/** Use another store (tests). */
export function setStore(store: KeyValue) {
  kv = store
  memory.clear()
  state = INITIAL
  started = null
  newestStarted = null
}

// ——— The index ———

const INDEX_KEY = 'index'
/** Catalog pages fetched at once while building the index: quick, and gentle on a volunteer site. */
const CONCURRENCY = 4
/** Tries for each catalog page, so one bad moment on the network doesn't stop the whole catalog. */
const PAGE_TRIES = 3
const PAGE_RETRY_MS = 800

async function listPage(order: CatalogOrder, page: number, fetcher: typeof fetch) {
  for (let attempt = 1; ; attempt++) {
    try {
      return parseCatalogPage(await fetchText(listUrl(order, page), fetcher))
    } catch (e) {
      if (attempt >= PAGE_TRIES) throw e
      await new Promise((done) => setTimeout(done, PAGE_RETRY_MS * attempt))
    }
  }
}

/**
 * Every book in the catalog, in one order, a few pages at a time. Each page
 * is reported as it arrives, so the list fills in while the rest loads.
 */
export async function crawl(
  order: CatalogOrder,
  onProgress?: (books: (CatalogBook & { rank: number })[], loaded: number, total: number) => void,
  fetcher: typeof fetch = fetch,
): Promise<(CatalogBook & { rank: number })[]> {
  const ranked = (books: CatalogBook[], page: number) => books.map((b, k) => ({ ...b, rank: (page - 1) * PER_PAGE + k }))
  const first = await listPage(order, 1, fetcher)
  const pages: (CatalogBook & { rank: number })[][] = [ranked(first.books, 1)]
  const all = () => {
    const seen = new Set<string>()
    return pages.flat().filter((b) => !seen.has(b.id) && seen.add(b.id))
  }
  let loaded = 1
  onProgress?.(all(), loaded, first.lastPage)
  let next = 2
  let failure: unknown = null
  const worker = async () => {
    while (next <= first.lastPage && !failure) {
      const page = next++
      try {
        pages[page - 1] = ranked((await listPage(order, page, fetcher)).books, page)
        loaded++
        onProgress?.(all(), loaded, first.lastPage)
      } catch (e) {
        failure = e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, first.lastPage - 1) }, worker))
  if (failure) throw failure
  return all()
}

export interface IndexState {
  books: IndexedBook[]
  /** loading: reading what's kept; building: fetching the catalog for the first time. */
  status: 'loading' | 'building' | 'ready' | 'error'
  /** Catalog pages fetched so far, and in all, while building. */
  loaded: number
  total: number
  error?: string
  builtAt?: number
  /** The newest-first order: not fetched, being fetched, or there. */
  newest: 'none' | 'building' | 'ready'
}

const INITIAL: IndexState = { books: [], status: 'loading', loaded: 0, total: 0, newest: 'none' }
let state: IndexState = INITIAL
const listeners = new Set<() => void>()
const update = (change: Partial<IndexState>) => {
  state = { ...state, ...change }
  for (const l of listeners) l()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const indexState = () => state

const toIndexed = (books: (CatalogBook & { rank: number })[]): IndexedBook[] => books.map(({ rank, ...b }) => ({ ...b, popular: rank }))

let started: Promise<void> | null = null

/**
 * Have the index ready: what's kept, straight away; fetched for the first
 * time (filling in as it comes); or refreshed in the background once it's
 * a week old. Safe to call again: it only starts once.
 */
export function ensureIndex(fetcher: typeof fetch = fetch, now = Date.now()): Promise<void> {
  started ??= (async () => {
    const kept = await kv.get<CatalogIndex>(INDEX_KEY).catch(() => undefined)
    const fresh = freshness(kept, now)
    if (kept && fresh !== 'missing') {
      update({ books: kept.books, status: 'ready', builtAt: kept.builtAt, newest: kept.hasNewest ? 'ready' : 'none' })
      if (fresh === 'stale') refresh(fetcher).catch(() => {})
      pruneCache(now).catch(() => {})
      return
    }
    update({ status: 'building', loaded: 0, total: 0, error: undefined })
    try {
      const books = await crawl('popularity', (books, loaded, total) => update({ books: toIndexed(books), loaded, total }), fetcher)
      const index: CatalogIndex = { version: INDEX_VERSION, builtAt: Date.now(), books: toIndexed(books), hasNewest: false }
      await kv.set(INDEX_KEY, index).catch(() => {})
      update({ books: index.books, status: 'ready', builtAt: index.builtAt })
    } catch (e) {
      // What arrived stays listed; trying again fetches the rest.
      update({ status: 'error', error: message(e) })
      started = null
    }
  })()
  return started
}

/** A fresh copy of the catalog, swapped in only once it's complete. */
async function refresh(fetcher: typeof fetch) {
  const books = toIndexed(await crawl('popularity', undefined, fetcher))
  const index: CatalogIndex = { version: INDEX_VERSION, builtAt: Date.now(), books, hasNewest: false }
  await kv.set(INDEX_KEY, index)
  newestStarted = null
  update({ books, builtAt: index.builtAt, newest: 'none' })
}

let newestStarted: Promise<void> | null = null

/** Fetch the newest-first order (only when it's asked for), and keep it with the index. */
export function ensureNewest(fetcher: typeof fetch = fetch): Promise<void> {
  if (state.newest === 'ready') return Promise.resolve()
  newestStarted ??= (async () => {
    update({ newest: 'building' })
    try {
      const order = await crawl('newest', (books) => update({ books: withNewest(state.books, books.map((b) => b.id)) }), fetcher)
      const books = withNewest(state.books, order.map((b) => b.id))
      update({ books, newest: 'ready' })
      if (state.status === 'ready') {
        await kv.set(INDEX_KEY, { version: INDEX_VERSION, builtAt: state.builtAt ?? Date.now(), books, hasNewest: true } satisfies CatalogIndex)
      }
    } catch {
      update({ newest: 'none' })
      newestStarted = null
    }
  })()
  return newestStarted
}

/** Try again after the first fetch failed. */
export function retryIndex(fetcher: typeof fetch = fetch): Promise<void> {
  if (state.status === 'error') started = null
  return ensureIndex(fetcher)
}

// ——— Pages kept once seen ———

/** How long a kept book page or preview section is used without asking again. */
export const PAGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** Kept pages not looked at for this long are cleared away. */
const PAGE_FORGET_MS = 90 * 24 * 60 * 60 * 1000

interface Kept<T> {
  at: number
  value: T
}

const memory = new Map<string, Promise<unknown>>()

/**
 * A value kept on the device: from memory, else from storage, else loaded
 * and kept. One past its age is used straight away and refreshed in the
 * background (and used if loading it again fails).
 */
export function cached<T>(key: string, load: () => Promise<T>, maxAge = PAGE_MAX_AGE_MS, now = Date.now()): Promise<T> {
  let value = memory.get(key) as Promise<T> | undefined
  if (!value) {
    value = (async () => {
      const kept = await kv.get<Kept<T>>(key).catch(() => undefined)
      const keep = (v: T) => kv.set(key, { at: Date.now(), value: v } satisfies Kept<T>).catch(() => {})
      if (kept && now - kept.at <= maxAge) return kept.value
      if (kept) {
        load().then(keep, () => {})
        return kept.value
      }
      const loaded = await load()
      await keep(loaded)
      return loaded
    })()
    memory.set(key, value)
    value.catch(() => memory.delete(key))
  }
  return value
}

/** A book's page: its description, length and the EPUB's address. */
export function loadDetails(id: string, fetcher: typeof fetch = fetch): Promise<CatalogDetails> {
  return cached(`book:${id}`, async () => parseDetails(await fetchPage(bookUrl(id), fetcher), id))
}

/** A book's read-online contents, for its preview. */
export function loadContents(details: Pick<CatalogDetails, 'id' | 'contents'>, fetcher: typeof fetch = fetch): Promise<ContentsEntry[]> {
  const url = details.contents
  if (!url) return Promise.resolve([])
  return cached(`contents:${details.id}`, async () => parseContents(await fetchPage(url, fetcher), url))
}

/** A section of a book read online. */
export function loadSection(href: string, fetcher: typeof fetch = fetch): Promise<PreviewSection> {
  return cached(`section:${href}`, async () => parseSection(await fetchPage(href, fetcher)))
}

/**
 * Get a book's page ready before it's opened (on a touch or hover of its
 * row), so it opens with everything there. Failures are left for opening.
 */
export function prefetchBook(id: string): void {
  loadDetails(id).catch(() => {})
}

/** Clear kept pages that haven't been fetched again in a long while. */
async function pruneCache(now: number) {
  for (const key of await kv.keys()) {
    if (key === INDEX_KEY) continue
    const kept = await kv.get<Kept<unknown>>(key)
    if (!kept || now - kept.at > PAGE_FORGET_MS) await kv.del(key)
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
