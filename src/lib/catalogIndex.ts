import type { CatalogBook, CatalogSort } from './catalog'

/**
 * The whole catalog kept on the device, so searching, filtering and sorting
 * are instant and work offline. Built from the catalog's own pages (see
 * catalogStore.ts); everything here is pure.
 */

export interface IndexedBook extends CatalogBook {
  /** Place in the catalog's most-popular order, from 0. */
  popular: number
  /** Place in its newest-first order, once that's been fetched. */
  newest?: number
}

export interface CatalogIndex {
  version: number
  /** When it was fetched (ms). */
  builtAt: number
  books: IndexedBook[]
  /** Whether the newest-first order has been fetched too. */
  hasNewest: boolean
}

/** Bumped when the shape changes, so an old index is fetched again. */
export const INDEX_VERSION = 1
/** An index older than this is refreshed in the background. */
export const INDEX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Lower case, accents and punctuation gone: "Émile Zola’s" → "emile zola s". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** A book's words, normalized once and kept beside it for searching. */
interface Searchable {
  book: IndexedBook
  title: string[]
  author: string[]
  subjects: string[]
}

const words = (text: string) => normalize(text).split(' ').filter(Boolean)
const cache = new WeakMap<IndexedBook[], Searchable[]>()
function searchable(books: IndexedBook[]): Searchable[] {
  let list = cache.get(books)
  if (!list) {
    list = books.map((book) => ({ book, title: words(book.title), author: words(book.author), subjects: words(book.subjects.join(' ')) }))
    cache.set(books, list)
  }
  return list
}

/**
 * How well a book matches the words searched for: every word must start a
 * word of its title, author or subjects (the last one may be partly typed).
 * Title matches count most, then author, then subject; 0 is no match.
 */
function score(entry: Searchable, terms: string[]): number {
  let total = 0
  for (const term of terms) {
    const hit = (list: string[]) => (list.includes(term) ? 2 : list.some((w) => w.startsWith(term)) ? 1 : 0)
    const best = Math.max(hit(entry.title) * 3, hit(entry.author) * 2, hit(entry.subjects))
    if (best === 0) return 0
    total += best
  }
  // The words in order in the title, as typed: best of all.
  if (` ${entry.title.join(' ')} `.includes(` ${terms.join(' ')}`)) total += 10
  return total
}

export interface IndexQuery {
  query?: string
  /** A subject slug ("science-fiction"), or none for all. */
  subject?: string
  sort?: CatalogSort | null
}

/** The books matching a search, in the order asked for (best matches first when searching). */
export function searchIndex(books: IndexedBook[], { query = '', subject, sort }: IndexQuery): IndexedBook[] {
  const terms = words(query)
  let found: { book: IndexedBook; score: number }[] = []
  for (const entry of searchable(books)) {
    if (subject && !entry.book.tags.includes(subject)) continue
    const s = terms.length ? score(entry, terms) : 1
    if (s > 0) found.push({ book: entry.book, score: s })
  }
  const order = sort ?? (terms.length ? 'relevance' : 'popularity')
  const last = Number.POSITIVE_INFINITY
  const by: Record<CatalogSort, (a: (typeof found)[number], b: (typeof found)[number]) => number> = {
    relevance: (a, b) => b.score - a.score,
    popularity: () => 0,
    newest: (a, b) => (a.book.newest ?? last) - (b.book.newest ?? last),
    'reading-ease': (a, b) => (b.book.readingEase ?? -last) - (a.book.readingEase ?? -last),
    length: (a, b) => (a.book.words ?? last) - (b.book.words ?? last),
  }
  // Ties go to the more popular book.
  found = found.sort((a, b) => by[order](a, b) || a.book.popular - b.book.popular)
  return found.map((f) => f.book)
}

/** Whether an index can be shown as it is, and whether it should be fetched again. */
export function freshness(index: CatalogIndex | undefined, now: number): 'missing' | 'stale' | 'fresh' {
  if (!index || index.version !== INDEX_VERSION || index.books.length === 0) return 'missing'
  return now - index.builtAt > INDEX_MAX_AGE_MS ? 'stale' : 'fresh'
}

/** Put the newest-first order into an index, by book id. */
export function withNewest(books: IndexedBook[], newestFirst: string[]): IndexedBook[] {
  const place = new Map(newestFirst.map((id, k) => [id, k]))
  return books.map((b) => ({ ...b, newest: place.get(b.id) }))
}
