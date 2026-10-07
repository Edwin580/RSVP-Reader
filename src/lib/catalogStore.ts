import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval'
import {
  bookUrl,
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
import { storageName } from './preview'

/**
 * What's been looked at in the catalog, kept on the device: pages of
 * results, books' pages and preview sections. Nothing is fetched or kept
 * ahead of being shown, what's kept is the parsed essentials (a few KB
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
  entries(): Promise<[string, unknown][]>
}

let idbStore: UseStore | null = null
const idb = (): UseStore => (idbStore ??= createStore(storageName('chapter-catalog'), 'kv'))
const indexedDb: KeyValue = {
  get: (key) => get(key, idb()),
  set: (key, value) => set(key, value, idb()),
  del: (key) => del(key, idb()),
  entries: async () => (await entries(idb())).map(([k, v]) => [String(k), v]),
}

export function memoryStore(): KeyValue & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>()
  return {
    map,
    get: async <T,>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => void map.set(key, value),
    del: async (key) => void map.delete(key),
    entries: async () => [...map.entries()],
  }
}

let kv: KeyValue = indexedDb
/** Use another store (tests). */
export function setStore(store: KeyValue) {
  kv = store
  memory.clear()
  pruned = null
}

/** How long a page of results is used without asking again: the catalog changes weekly at most. */
export const RESULTS_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** How long a book's page or a preview section is used without asking again. */
export const PAGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** The most kept at once; the least recently fetched go first. */
export const MAX_KEPT = 150

interface Kept<T> {
  at: number
  value: T
}

const memory = new Map<string, Promise<unknown>>()
let pruned: Promise<void> | null = null

/**
 * A value kept on the device: from memory, else from storage, else loaded
 * and kept. One past its age is shown straight away and refreshed in the
 * background (and still used if loading it again fails).
 */
export function cached<T>(key: string, load: () => Promise<T>, maxAge = PAGE_MAX_AGE_MS, now = Date.now()): Promise<T> {
  pruned ??= prune().catch(() => {})
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

/** Keep only the most recent MAX_KEPT entries. */
export async function prune(): Promise<void> {
  const all = (await kv.entries()).map(([key, v]) => [key, (v as Kept<unknown> | undefined)?.at ?? 0] as const)
  if (all.length <= MAX_KEPT) return
  const oldest = [...all].sort((a, b) => a[1] - b[1]).slice(0, all.length - MAX_KEPT)
  for (const [key] of oldest) await kv.del(key)
}

/** A page of search results. */
export function loadResults(query: CatalogQuery, fetcher: typeof fetch = fetch): Promise<CatalogPage> {
  const url = searchUrl(query)
  return cached(
    `results:${url}`,
    async () => {
      const page = parseCatalogPage(await fetchText(url, fetcher))
      // Only the subject's books, should the site ever ignore the filter.
      return query.subject ? { ...page, books: page.books.filter((b) => b.tags.includes(query.subject!)) } : page
    },
    RESULTS_MAX_AGE_MS,
  )
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
