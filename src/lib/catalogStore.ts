import { createStore, del, entries, get, keys, set, type UseStore } from 'idb-keyval'
import {
  INDEX_PER_PAGE,
  bookUrl,
  indexUrl,
  fetchText,
  parseCatalogPage,
  parseContents,
  parseDetails,
  parseSection,
  searchUrl,
  type CatalogDetails,
  type CatalogPage,
  type CatalogQuery,
  type ContentsEntry,
  type PreviewSection,
} from './catalog'
import { packIndex, unpackIndex, type IndexRow, type IndexedBook } from './catalogIndex'
import { storageName } from './preview'

/**
 * What's been looked at in the catalog, kept on the device: pages of
 * results, books' pages and preview sections, and (once someone searches)
 * the list of every book's title and author. Nothing is fetched or kept
 * ahead of being needed, what's kept is the parsed essentials (a few KB
 * each, not the pages' HTML), and only the most recent are kept.
 *
 * It's a separate database from the library's, so backups don't carry it
 * and clearing it never touches a book.
 */

/** Where things are kept: IndexedDB in the app, a Map in tests. */
export interface KeyValue {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  /** Just the keys: cheap, unlike entries, which reads every value. */
  keys(): Promise<string[]>
  entries(): Promise<[string, unknown][]>
}

let idbStore: UseStore | null = null
const idb = (): UseStore => (idbStore ??= createStore(storageName('chapter-catalog'), 'kv'))
const indexedDb: KeyValue = {
  get: (key) => get(key, idb()),
  set: (key, value) => set(key, value, idb()),
  del: (key) => del(key, idb()),
  keys: async () => (await keys(idb())).map(String),
  entries: async () => (await entries(idb())).map(([k, v]) => [String(k), v]),
}

export function memoryStore(): KeyValue & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>()
  return {
    map,
    get: async <T,>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => void map.set(key, value),
    del: async (key) => void map.delete(key),
    keys: async () => [...map.keys()],
    entries: async () => [...map.entries()],
  }
}

let kv: KeyValue = indexedDb
/** Use another store (tests). */
export function setStore(store: KeyValue) {
  kv = store
  memory.clear()
  pruned = null
  index = null
  indexPages.clear()
}

/** How long a page of results is used without asking again: the catalog changes weekly at most. */
export const RESULTS_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** How long a book's page or a preview section is used without asking again. */
export const PAGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** The most kept at once; past it, the least recently fetched go until KEPT_AFTER_PRUNE are left. */
export const MAX_KEPT = 150
/** Pruning goes this far below the cap, so the next prune is a while off. */
export const KEPT_AFTER_PRUNE = 120

interface Kept<T> {
  at: number
  value: T
}

const memory = new Map<string, Promise<unknown>>()
let pruned: Promise<void> | null = null

/** Loaded once this visit, then answered from memory. A failed load is forgotten, so it can be tried again. */
function remembered<T>(key: string, load: () => Promise<T>): Promise<T> {
  let value = memory.get(key) as Promise<T> | undefined
  if (!value) {
    value = load()
    memory.set(key, value)
    value.catch(() => memory.delete(key))
  }
  return value
}

/**
 * A value kept on the device: from memory, else from storage, else loaded
 * and kept. One past its age is shown straight away and refreshed in the
 * background (and still used if loading it again fails).
 */
export function cached<T>(key: string, load: () => Promise<T>, maxAge = PAGE_MAX_AGE_MS, now = Date.now()): Promise<T> {
  return remembered(key, async () => {
    const kept = await kv.get<Kept<T>>(key).catch(() => undefined)
    const keep = (v: T) => {
      // Only something new can take the store past its cap, so that's when to
      // look, once a visit, and after what's on screen has had its turn.
      pruned ??= new Promise((done) => setTimeout(done, PRUNE_DELAY_MS)).then(prune).catch(() => {})
      return kv.set(key, { at: Date.now(), value: v } satisfies Kept<T>).catch(() => {})
    }
    if (kept && now - kept.at <= maxAge) return kept.value
    if (kept) {
      load().then(keep, () => {})
      return kept.value
    }
    const loaded = await load()
    await keep(loaded)
    return loaded
  })
}

/** How long after the first thing kept in a visit the store is pruned (ms). */
const PRUNE_DELAY_MS = 3000

/**
 * Past MAX_KEPT entries, keep only the KEPT_AFTER_PRUNE most recent. Counts
 * the keys first, which is cheap; only past the cap are the entries read,
 * every value with them (pages, preview sections), to find the oldest.
 */
export async function prune(): Promise<void> {
  // The list searched on the device is one entry, kept apart from the count.
  if ((await kv.keys()).filter((key) => key !== 'index').length <= MAX_KEPT) return
  const all = (await kv.entries()).filter(([key]) => key !== 'index').map(([key, v]) => [key, (v as Kept<unknown> | undefined)?.at ?? 0] as const)
  const oldest = [...all].sort((a, b) => a[1] - b[1]).slice(0, all.length - KEPT_AFTER_PRUNE)
  for (const [key] of oldest) await kv.del(key)
}

/**
 * A page of results. Browsing's pages are kept on the device for a day; a
 * search's only for this visit: what's typed rarely repeats, and the list
 * on the device answers it anyway, so they'd only push out what's been read.
 */
export function loadResults(query: CatalogQuery, fetcher: typeof fetch = fetch): Promise<CatalogPage> {
  const url = searchUrl(query)
  const load = async () => {
    const page = parseCatalogPage(await fetchText(url, fetcher))
    // Only the subject's books, should the site ever ignore the filter.
    return query.subject ? { ...page, books: page.books.filter((b) => b.tags.includes(query.subject!)) } : page
  }
  return query.query?.trim() ? remembered(`results:${url}`, load) : cached(`results:${url}`, load, RESULTS_MAX_AGE_MS)
}

/** A book's page: its description, length and the EPUB's address. */
export function loadDetails(id: string, fetcher: typeof fetch = fetch): Promise<CatalogDetails> {
  return cached(`book:${id}`, async () => parseDetails(await fetchText(bookUrl(id), fetcher), id))
}

/** A book's read-online contents, for its preview. */
export function loadContents(details: Pick<CatalogDetails, 'id' | 'contents'>, fetcher: typeof fetch = fetch): Promise<ContentsEntry[]> {
  const url = details.contents
  if (!url) return Promise.resolve([])
  return cached(`contents:${details.id}`, async () => parseContents(await fetchText(url, fetcher), url))
}

/** A section of a book read online. */
export function loadSection(href: string, fetcher: typeof fetch = fetch): Promise<PreviewSection> {
  return cached(`section:${href}`, async () => parseSection(await fetchText(href, fetcher)))
}

// ——— The list searched on the device ———

/** How long the list of every book is used before it's fetched again (in the background). */
export const INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Pages fetched at once: quick, and gentle on a volunteer site. */
const CONCURRENCY = 4
/** Tries for each page, so one bad moment on the network doesn't stop the whole list. */
const PAGE_TRIES = 3
const PAGE_RETRY_MS = 800

/** Pages of the list fetched this visit, so if one fails, trying again picks up where it stopped. */
const indexPages = new Map<number, CatalogPage>()

async function indexPage(page: number, fetcher: typeof fetch): Promise<CatalogPage> {
  for (let attempt = 1; ; attempt++) {
    try {
      const kept = indexPages.get(page) ?? parseCatalogPage(await fetchText(indexUrl(page), fetcher))
      indexPages.set(page, kept)
      return kept
    } catch (e) {
      if (attempt >= PAGE_TRIES) throw e
      await new Promise((done) => setTimeout(done, PAGE_RETRY_MS * attempt))
    }
  }
}

/** Every book in the catalog, most popular first, a few pages at a time (about 32 small pages). */
export async function fetchIndex(fetcher: typeof fetch = fetch): Promise<IndexedBook[]> {
  const first = await indexPage(1, fetcher)
  const pages: CatalogPage['books'][] = [first.books]
  let next = 2
  const worker = async () => {
    while (next <= first.lastPage) {
      const page = next++
      pages[page - 1] = (await indexPage(page, fetcher)).books
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, first.lastPage - 1) }, worker))
  indexPages.clear()
  const seen = new Set<string>()
  return pages
    .flatMap((books, p) => books.map((b, k) => ({ ...b, popular: p * INDEX_PER_PAGE + k })))
    .filter((b) => !seen.has(b.id) && seen.add(b.id))
}

/**
 * The list of every book, for searching: fetched the first time someone
 * searches, then kept, and refreshed in the background once a week old.
 */
export function loadIndex(fetcher: typeof fetch = fetch): Promise<IndexedBook[]> {
  index ??= cached<IndexRow[]>('index', async () => packIndex(await fetchIndex(fetcher)), INDEX_MAX_AGE_MS)
    .then(unpackIndex)
    .catch((e) => {
      index = null
      throw e
    })
  return index
}
let index: Promise<IndexedBook[]> | null = null
