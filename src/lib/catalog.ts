/**
 * Free books to browse, from Standard Ebooks (standardebooks.org): carefully
 * edited public-domain books, with covers, descriptions, a read-online copy
 * for previews, and EPUB downloads. Their site allows other sites to read it
 * (CORS), so the app reads its public catalog pages directly; their catalog
 * feeds are for paying supporters only.
 *
 * The parsers here are pure (HTML in, data out) and only ever turn the
 * catalog's own links into addresses under /ebooks/<author>/<title>, so no
 * other link on a page is followed. (The pages carry a hidden trap link that
 * bans whoever follows it.)
 */

export const CATALOG_ORIGIN = 'https://standardebooks.org'
export const CATALOG_NAME = 'Standard Ebooks'

/** A book in the catalog's list. */
export interface CatalogBook {
  /** Its path under /ebooks, like "jane-austen/pride-and-prejudice". */
  id: string
  title: string
  author: string
  /** Cover image (absolute URL). */
  cover?: string
  words?: number
  /** Flesch reading ease: higher is easier. */
  readingEase?: number
  subjects: string[]
  /** The subjects as the catalog names them in addresses ("science-fiction"), for filtering. */
  tags: string[]
}

export interface CatalogPage {
  books: CatalogBook[]
  /** Whether there's a next page. */
  hasMore: boolean
  /** The number of the last page, from the page links (1 if there are none). */
  lastPage: number
}

/** A book's own page: everything shown before it's added. */
export interface CatalogDetails extends CatalogBook {
  /** One line about the book. */
  summary?: string
  /** The longer description, as paragraphs of plain text. */
  description: string[]
  translator?: string
  /** The EPUB to download (absolute URL). */
  epub: string
  /** The read-online table of contents, for a preview (absolute URL). */
  contents?: string
}

export interface ContentsEntry {
  label: string
  /** The section's read-online page (absolute URL). */
  href: string
}

/** A section of a book read online, for a preview. */
export interface PreviewSection {
  title?: string
  paragraphs: string[]
}

export const SUBJECTS: { value: string; label: string }[] = [
  { value: 'fiction', label: 'Fiction' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'mystery', label: 'Mystery' },
  { value: 'science-fiction', label: 'Science fiction' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'horror', label: 'Horror' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'satire', label: 'Satire' },
  { value: 'drama', label: 'Drama' },
  { value: 'poetry', label: 'Poetry' },
  { value: 'shorts', label: 'Short stories' },
  { value: 'childrens', label: 'Children’s' },
  { value: 'nonfiction', label: 'Nonfiction' },
  { value: 'biography', label: 'Biography' },
  { value: 'autobiography', label: 'Autobiography' },
  { value: 'memoir', label: 'Memoir' },
  { value: 'philosophy', label: 'Philosophy' },
  { value: 'spirituality', label: 'Spirituality' },
  { value: 'travel', label: 'Travel' },
]

export type CatalogSort = 'popularity' | 'newest' | 'reading-ease' | 'length' | 'relevance'
export const SORTS: { value: CatalogSort; label: string }[] = [
  { value: 'popularity', label: 'Popular' },
  { value: 'newest', label: 'Newest' },
  { value: 'reading-ease', label: 'Easiest' },
  { value: 'length', label: 'Shortest' },
]

export interface CatalogQuery {
  query?: string
  /** A subject slug ("science-fiction"), or none for all. */
  subject?: string
  sort?: CatalogSort | null
  /** From 1. */
  page?: number
}

/** Books per page of results: a screenful or two, so each page is light. */
export const PER_PAGE = 24

/**
 * A book id: lower-case path segments, at least author and title. Several
 * authors or translators are joined with underscores
 * ("war-and-peace/louise-maude_aylmer-maude").
 */
const ID = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)+$/

export function isBookId(id: string): boolean {
  return ID.test(id)
}

/**
 * A page of search results, in the list view (which has word counts and
 * subjects). A subject goes in twice: given once, the site sends the
 * request on to its /subjects/ page, which other sites aren't allowed to
 * read (it has no CORS header); given twice, it answers here, filtered.
 */
export function searchUrl({ query = '', subject, sort, page = 1 }: CatalogQuery): string {
  const params = new URLSearchParams()
  const q = query.trim()
  if (q) params.set('query', q)
  if (subject) {
    params.append('tags[]', subject)
    params.append('tags[]', subject)
  }
  // With words to match, the best matches first; otherwise the chosen order.
  params.set('sort', sort ?? (q ? 'relevance' : 'popularity'))
  params.set('view', 'list')
  params.set('per-page', String(PER_PAGE))
  if (page > 1) params.set('page', String(page))
  return `${CATALOG_ORIGIN}/ebooks?${params}`
}

/** Books per page when fetching the whole list for searching: the most the site gives, so the fewest requests. */
export const INDEX_PER_PAGE = 48

/** A page of the whole catalog, most popular first, for the list searched on the device (see catalogIndex.ts). */
export function indexUrl(page = 1): string {
  const params = new URLSearchParams({ sort: 'popularity', view: 'list', 'per-page': String(INDEX_PER_PAGE) })
  if (page > 1) params.set('page', String(page))
  return `${CATALOG_ORIGIN}/ebooks?${params}`
}

export function bookUrl(id: string): string {
  if (!isBookId(id)) throw new Error('Not a book in the catalog.')
  return `${CATALOG_ORIGIN}/ebooks/${id}`
}

/** The id of a link to a book, or undefined for any other link. */
function idFromHref(href: string | null | undefined): string | undefined {
  if (!href) return
  let path: string
  try {
    const url = new URL(href, CATALOG_ORIGIN)
    if (url.origin !== CATALOG_ORIGIN) return
    path = url.pathname
  } catch {
    return
  }
  const match = path.match(/^\/ebooks\/(.+?)\/?$/)
  return match && isBookId(match[1]) ? match[1] : undefined
}

/** An address on the catalog's site, or undefined if it's anywhere else. */
function catalogAddress(href: string | null | undefined, base = CATALOG_ORIGIN): string | undefined {
  if (!href) return
  try {
    const url = new URL(href, base)
    return url.origin === CATALOG_ORIGIN ? url.href : undefined
  } catch {
    return
  }
}

/** Subject slugs from links like /subjects/science-fiction. */
function tagsOf(links: Iterable<Element>): string[] {
  return [...links].map((a) => a.getAttribute('href')?.match(/\/subjects\/([a-z0-9-]+)/)?.[1]).filter((t): t is string => !!t)
}

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

/** "121,970 words • 60.95 reading ease" */
function wordsAndEase(line: string): { words?: number; readingEase?: number } {
  const words = line.match(/([\d,]+)\s+words/)
  const ease = line.match(/([\d.]+)\s+reading ease/)
  return {
    ...(words && { words: Number(words[1].replace(/,/g, '')) }),
    ...(ease && { readingEase: Number(ease[1]) }),
  }
}

function coverOf(scope: Element): string | undefined {
  const jpeg = scope.querySelector('source[type="image/jpeg"]')?.getAttribute('srcset')
  // "…/cover@2x.jpg 2x, …/cover.jpg 1x": the sharper one, for high-density screens.
  const best = jpeg?.split(',')[0]?.trim().split(/\s+/)[0]
  return catalogAddress(best ?? scope.querySelector('img')?.getAttribute('src'))
}

export function parseCatalogPage(html: string): CatalogPage {
  const doc = parse(html)
  const books: CatalogBook[] = []
  for (const item of doc.querySelectorAll('li[typeof="schema:Book"]')) {
    const id = idFromHref(item.getAttribute('about'))
    const title = text(item.querySelector('[property="schema:name"]'))
    if (!id || !title) continue
    const authors = [...item.querySelectorAll('.author')].map(text).filter(Boolean)
    const details = text(item.querySelector('.details p'))
    books.push({
      id,
      title,
      author: authors.join(' & '),
      cover: coverOf(item),
      ...wordsAndEase(details),
      subjects: [...item.querySelectorAll('.tags a')].map(text).filter(Boolean),
      tags: tagsOf(item.querySelectorAll('.tags a')),
    })
  }
  const pages = [...doc.querySelectorAll('.pagination a[href]')].map((a) => Number(new URL(a.getAttribute('href')!, CATALOG_ORIGIN).searchParams.get('page')) || 1)
  return { books, hasMore: !!doc.querySelector('.pagination a[rel="next"]'), lastPage: Math.max(1, ...pages) }
}

export function parseDetails(html: string, id: string): CatalogDetails {
  const doc = parse(html)
  const article = doc.querySelector('article.ebook') ?? doc.body
  const title = text(article.querySelector('h1'))
  if (!title) throw new Error('Couldn’t read this book’s page.')
  const authors = [...article.querySelectorAll('hgroup [property="schema:author"] [property="schema:name"]')].map(text)
  const summary = article.querySelector('meta[property="schema:abstract"]')?.getAttribute('content')?.trim()
  const description = [...article.querySelectorAll('#description [property="schema:description"] p')]
    .map(text)
    .filter(Boolean)
  const words = Number(article.querySelector('meta[property="schema:wordCount"]')?.getAttribute('content')) || undefined
  const ease = text(article.querySelector('#reading-ease')).match(/reading ease of ([\d.]+)/)
  const translator = article.querySelector('[property="schema:translator"] meta[property="schema:name"]')?.getAttribute('content')
  // The "compatible" EPUB, which suits every reading app; not the advanced or Kobo ones.
  const links = [...article.querySelectorAll<HTMLAnchorElement>('#download a[href$=".epub"]')]
    .map((a) => a.getAttribute('href') ?? '')
    .filter((href) => !/_advanced\.epub$|\.kepub\.epub$/.test(href))
  const epub = catalogAddress(links[0])
  if (!epub || !epub.startsWith(`${bookUrl(id)}/`)) throw new Error('This book has no EPUB to download.')
  const contents = catalogAddress(article.querySelector('#read-online a.list')?.getAttribute('href'))
  return {
    id,
    title,
    author: authors.join(' & '),
    cover: coverOf(article.querySelector('#read-free') ?? article),
    ...(words && { words }),
    ...(ease && { readingEase: Number(ease[1]) }),
    subjects: [...article.querySelectorAll('#reading-ease .tags a')].map(text).filter(Boolean),
    tags: tagsOf(article.querySelectorAll('#reading-ease .tags a')),
    ...(summary && { summary }),
    description,
    ...(translator && { translator }),
    epub,
    ...(contents?.startsWith(`${bookUrl(id)}/`) && { contents }),
  }
}

/** Parts of a book before or after the text proper, skipped by the preview. */
const NOT_THE_TEXT = /\/(titlepage|imprint|halftitlepage|dedication|epigraph|colophon|uncopyright|endnotes|loi|acknowledgements)$/

export function parseContents(html: string, contentsUrl: string): ContentsEntry[] {
  const doc = parse(html)
  const base = contentsUrl.endsWith('/') ? contentsUrl : `${contentsUrl}/`
  const book = contentsUrl.replace(/\/text\/?$/, '')
  const entries: ContentsEntry[] = []
  for (const a of doc.querySelectorAll('#toc a')) {
    // Relative to the book ("text/chapter-1"), so resolved against the book's page.
    const href = catalogAddress(a.getAttribute('href'), `${book}/`) ?? catalogAddress(a.getAttribute('href'), base)
    if (!href?.startsWith(`${book}/text/`)) continue
    const label = text(a)
    if (label && !entries.some((e) => e.href === href)) entries.push({ label, href })
  }
  return entries
}

/** Where a preview starts: the first part that's the text itself. */
export function previewStart(entries: ContentsEntry[]): number {
  const k = entries.findIndex((e) => !NOT_THE_TEXT.test(e.href))
  return k === -1 ? 0 : k
}

export function parseSection(html: string): PreviewSection {
  const doc = parse(html)
  const section = doc.querySelector('section, article') ?? doc.body
  const heading = section.querySelector('h1, h2, h3, hgroup')
  const title = heading ? text(heading) : undefined
  const paragraphs = [...section.querySelectorAll('p')]
    .filter((p) => !p.closest('header, nav, footer, hgroup'))
    .map(text)
    .filter(Boolean)
  return { ...(title && { title }), paragraphs }
}

/** How hard a book is to read, from its Flesch reading ease. */
export function easeLabel(ease: number): string {
  if (ease >= 80) return 'Easy'
  if (ease >= 60) return 'Average'
  if (ease >= 40) return 'Fairly hard'
  return 'Hard'
}

/** The EPUB's address for downloading (without the query, the site shows a thank-you page instead). */
export function downloadUrl(epub: string): string {
  const url = new URL(epub)
  url.searchParams.set('source', 'download')
  return url.href
}

/** Chapters before the text proper, by their titles in a downloaded book. */
const FRONT_MATTER = /^(imprint|dedication|epigraph|half ?title|title ?page|contents|table of contents)$/i

/**
 * Where a book from the catalog starts: its first chapter past the title
 * page, imprint, dedication and so on (Standard Ebooks puts these first).
 * Only looked for near the start (the first tenth, or 1,000 words), so a
 * book that's all one chapter starts at the start.
 */
export function textStart(book: { title: string; words: { length: number }; chapters: { title: string; start: number }[] }): number {
  const limit = Math.max(book.words.length / 10, 1000)
  const isTitle = (t: string) => t.trim().toLowerCase() === book.title.trim().toLowerCase()
  for (const c of book.chapters) {
    if (c.start > limit) break
    if (!FRONT_MATTER.test(c.title.trim()) && !isTitle(c.title)) return c.start
  }
  return 0
}

// ——— Fetching ———

/** Wait before trying a page again after a dropped connection (ms). */
const RETRY_MS = 600

/** A catalog page's HTML. A dropped connection is tried once more, after a moment, before giving up. */
export function fetchText(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!url.startsWith(`${CATALOG_ORIGIN}/`)) return Promise.reject(new Error('Not a catalog page.'))
  const get = () => fetcher(url, { credentials: 'omit' })
  return get()
    .catch((e) => {
      if (!(e instanceof TypeError)) throw e
      return new Promise<void>((done) => setTimeout(done, RETRY_MS)).then(get)
    })
    .then((response) => {
      if (!response.ok) throw new Error(`${CATALOG_NAME} answered ${response.status}.`)
      return response.text()
    })
    .catch((e) => {
      throw e instanceof TypeError ? new Error(`Couldn’t reach ${CATALOG_NAME}. Check your connection.`) : e
    })
}

/** Download a book's EPUB, as a file ready to add like an uploaded one. */
export async function downloadBook(
  details: Pick<CatalogDetails, 'epub' | 'id'>,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<File> {
  if (!details.epub.startsWith(`${bookUrl(details.id)}/`)) throw new Error('Not a book in the catalog.')
  const get = () => fetcher(downloadUrl(details.epub), { credentials: 'omit', signal })
  let response: Response
  try {
    // A dropped connection is tried once more, as for pages.
    response = await get().catch(async (e) => {
      if (signal?.aborted || !(e instanceof TypeError)) throw e
      await new Promise((done) => setTimeout(done, RETRY_MS))
      return get()
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error(`Couldn’t reach ${CATALOG_NAME}. Check your connection.`)
  }
  if (!response.ok) throw new Error(`${CATALOG_NAME} answered ${response.status}.`)
  const total = Number(response.headers.get('content-length')) || 0
  const chunks: Uint8Array[] = []
  if (response.body && total) {
    const reader = response.body.getReader()
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      onProgress?.(Math.min(1, received / total))
    }
  } else {
    chunks.push(new Uint8Array(await response.arrayBuffer()))
  }
  const name = decodeURIComponent(new URL(details.epub).pathname.split('/').pop() || 'book.epub')
  return new File(chunks as BlobPart[], name, { type: 'application/epub+zip' })
}
