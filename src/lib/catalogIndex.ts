import { CATALOG_ORIGIN, SUBJECTS, type CatalogBook, type CatalogSort } from './catalog'
import { editDistance, stem, tokenize } from './search'

/**
 * Searching the catalog's titles and authors on the device. The site's own
 * search only matches whole, exactly spelled words ("sherl" and "dostoyevsky"
 * find nothing) and ranks words in descriptions alongside titles, so once
 * someone searches, the app fetches a compact list of every book (see
 * catalogStore.ts) and searches that: as you type, forgiving a slip, titles
 * first. Words are read the same way as when searching a book (search.ts):
 * case, accents and punctuation ignored, word forms joined, slips forgiven.
 * Everything here is pure.
 */

export interface IndexedBook extends CatalogBook {
  /** Place in the catalog's most-popular order, from 0: breaks ties. */
  popular: number
}

/** A title, author or list of subjects as searched: its words, and the forms they stand for. */
interface Field {
  words: string[]
  stems: string[]
}
const field = (text: string): Field => {
  const words = tokenize(text)
  return { words, stems: words.map(stem) }
}

/** Ways people ask for a subject, as the catalog names it. */
const SUBJECT_WORDS: Record<string, string> = {
  'sci fi': 'science fiction',
  scifi: 'science fiction',
  sf: 'science fiction',
  'short stories': 'shorts',
  'short story': 'shorts',
  kids: 'childrens',
  children: 'childrens',
  childrens: 'childrens',
  'non fiction': 'nonfiction',
  detective: 'mystery',
  poems: 'poetry',
  plays: 'drama',
  scary: 'horror',
}

/** The words searched for, with common ways of naming a subject turned into the catalog's own. */
export function searchTerms(query: string): string[] {
  let text = ` ${tokenize(query).join(' ')} `
  for (const [said, meant] of Object.entries(SUBJECT_WORDS)) text = text.replace(` ${said} `, ` ${meant} `)
  return text.split(' ').filter(Boolean)
}

interface Searchable {
  book: IndexedBook
  title: Field
  author: Field
  subjects: Field
}

const fields = (book: CatalogBook) => ({ title: field(book.title), author: field(book.author), subjects: field([...book.subjects, ...book.tags].join(' ')) })

const cache = new WeakMap<readonly IndexedBook[], Searchable[]>()
function searchable(books: readonly IndexedBook[]): Searchable[] {
  let list = cache.get(books)
  if (!list) {
    list = books.map((book) => ({ book, ...fields(book) }))
    cache.set(books, list)
  }
  return list
}

/**
 * How well one word searched for matches a field: 4 exactly, 3 as another
 * form of it (mysteries, mystery), 2 as the start of one (still being typed),
 * 1 one slip away (only when allowed, and from five letters on, so short
 * words don't match everything), 0 not at all.
 */
function wordMatch(term: string, { words, stems }: Field, slips: boolean): number {
  const form = stem(term)
  let best = 0
  for (let k = 0; k < words.length; k++) {
    const w = words[k]
    if (w === term) return 4
    if (stems[k] === form) best = 3
    else if (w.startsWith(term)) best = Math.max(best, 2)
    else if (slips && best < 1 && term.length >= 5 && editDistance(term, w, 1) <= 1) best = 1
  }
  return best
}

/** Whether the words are in the title (or author) as typed: whole words, the last perhaps still being typed. */
function asTyped({ words }: Field, terms: string[]): 'whole' | 'typing' | null {
  const text = ` ${words.join(' ')} `
  if (text.includes(` ${terms.join(' ')} `)) return 'whole'
  return terms.at(-1)!.length >= 3 && text.includes(` ${terms.join(' ')}`) ? 'typing' : null
}

/**
 * How well a book matches: every word searched for must match its title,
 * author or subjects. Title matches count most, then author, then subject,
 * and the words in order in the title, as typed, most of all. 0 is no match.
 */
export function score(book: Searchable | CatalogBook, terms: string[], slips = false): number {
  if (terms.length === 0) return 0
  const entry = 'book' in book ? book : fields(book)
  let total = 0
  for (const term of terms) {
    const best = Math.max(wordMatch(term, entry.title, slips) * 3, wordMatch(term, entry.author, slips) * 2, wordMatch(term, entry.subjects, slips))
    if (best === 0) return 0
    total += best
  }
  const bonus = { whole: 20, typing: 8 }
  const title = asTyped(entry.title, terms)
  const author = asTyped(entry.author, terms)
  return total + Math.max(title ? bonus[title] : 0, author ? bonus[author] * 0.6 : 0)
}

export interface IndexQuery {
  query: string
  /** A subject slug ("science-fiction"), or none for all. */
  subject?: string
  sort?: CatalogSort | null
}

/**
 * The books matching a search, best first (or in the order asked for), and
 * apart from them those only a typing slip away ("frankenstien"), which go
 * last, after anything else that matches.
 */
export function searchIndex(books: readonly IndexedBook[], { query, subject, sort }: IndexQuery): { matches: IndexedBook[]; close: IndexedBook[] } {
  const terms = searchTerms(query)
  if (terms.length === 0) return { matches: [], close: [] }
  const matches: { book: IndexedBook; score: number }[] = []
  const close: { book: IndexedBook; score: number }[] = []
  for (const entry of searchable(books)) {
    if (subject && !entry.book.tags.includes(subject)) continue
    const s = score(entry, terms)
    if (s > 0) matches.push({ book: entry.book, score: s })
    else {
      const c = score(entry, terms, true)
      if (c > 0) close.push({ book: entry.book, score: c })
    }
  }
  return { matches: sortFound(matches, sort), close: sortFound(close, sort) }
}

const LAST = Number.POSITIVE_INFINITY
type Found<T extends CatalogBook> = { book: T; score: number; popular?: number }

/** Order matches: best match (the default), or popularity, ease or length; ties to the more popular. */
export function sortFound<T extends CatalogBook>(found: Found<T>[], sort?: CatalogSort | null): T[] {
  const popular = (f: Found<T>) => f.popular ?? (f.book as Partial<IndexedBook>).popular ?? LAST
  const by: Partial<Record<CatalogSort, (a: Found<T>, b: Found<T>) => number>> = {
    relevance: (a, b) => b.score - a.score,
    'reading-ease': (a, b) => (b.book.readingEase ?? -LAST) - (a.book.readingEase ?? -LAST),
    length: (a, b) => (a.book.words ?? LAST) - (b.book.words ?? LAST),
  }
  const order = by[sort ?? 'relevance'] ?? (() => 0)
  return [...found].sort((a, b) => order(a, b) || popular(a) - popular(b)).map((f) => f.book)
}

/**
 * The site's own results, for while the list is on its way: those matching
 * the title or author first, best first, then those it found by other words
 * (in their descriptions), in the site's order.
 */
export function rerank<T extends CatalogBook>(books: T[], query: string, sort?: CatalogSort | null): T[] {
  const terms = searchTerms(query)
  if (terms.length === 0 || (sort && sort !== 'relevance')) return books
  const scored = books.map((book, k) => ({ book, score: score(book, terms), popular: k }))
  return [...sortFound(scored.filter((f) => f.score > 0), 'relevance'), ...scored.filter((f) => f.score === 0).map((f) => f.book)]
}

// ——— Kept compactly ———

/** A book as kept in the list: id, title, author, words, reading ease, subjects. About 90 bytes. */
export type IndexRow = [string, string, string, number | null, number | null, string]

/** The list as kept on the device: only what searching and listing need. */
export function packIndex(books: readonly IndexedBook[]): IndexRow[] {
  return books.map((b) => [b.id, b.title, b.author, b.words ?? null, b.readingEase ?? null, b.tags.join(' ')])
}

const LABELS = new Map(SUBJECTS.map((s) => [s.value, s.label]))
const label = (tag: string) => LABELS.get(tag) ?? tag.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Back from the kept list: covers are found from each book's address, and subjects named from their slugs. */
export function unpackIndex(rows: readonly IndexRow[]): IndexedBook[] {
  return rows.map(([id, title, author, words, readingEase, tags], popular) => {
    const slugs = tags ? tags.split(' ') : []
    return {
      id,
      title,
      author,
      cover: `${CATALOG_ORIGIN}/ebooks/${id}/downloads/cover-thumbnail.jpg`,
      ...(words !== null && { words }),
      ...(readingEase !== null && { readingEase }),
      tags: slugs,
      subjects: slugs.map(label),
      popular,
    }
  })
}
