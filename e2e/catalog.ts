import type { Page } from '@playwright/test'
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'

/**
 * Stands in for standardebooks.org, so the browse tests never touch the real
 * site: its pages are the ones saved for the unit tests, and its EPUB is a
 * small one built here, with the title page and imprint Standard Ebooks puts
 * first.
 */
const fixture = (name: string) => readFileSync(`src/lib/__tests__/fixtures/standard-ebooks/${name}.html`, 'utf8')

// A 1×1 cover.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

async function epub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  const sections = [
    ['titlepage', '<h1>Pride and Prejudice</h1><p>By Jane Austen.</p>'],
    ['imprint', '<h2>Imprint</h2><p>This ebook is the product of many hours of hard work by volunteers.</p>'],
    ['chapter-1', '<h2>I</h2><p>It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.</p>'],
    ['chapter-2', '<h2>II</h2><p>Mr. Bennet was among the earliest of those who waited on Mr. Bingley.</p>'],
  ]
  zip.file(
    'content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Pride and Prejudice</dc:title></metadata><manifest>${sections
      .map(([id]) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`)
      .join('')}</manifest><spine>${sections.map(([id]) => `<itemref idref="${id}"/>`).join('')}</spine></package>`,
  )
  for (const [id, body] of sections) {
    zip.file(`${id}.xhtml`, `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><section>${body}</section></body></html>`)
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** The stand-in catalog: 60 books, 48 to a page as on the site, most popular first. */
const BOOKS: { id: string; title: string; author: string; words: number; ease: number; tags: string[] }[] = [
  { id: 'jane-austen/pride-and-prejudice', title: 'Pride and Prejudice', author: 'Jane Austen', words: 121970, ease: 60.95, tags: ['fiction'] },
  { id: 'mary-shelley/frankenstein', title: 'Frankenstein', author: 'Mary Shelley', words: 77898, ease: 56.29, tags: ['fiction', 'horror', 'science-fiction'] },
  { id: 'robert-louis-stevenson/treasure-island', title: 'Treasure Island', author: 'Robert Louis Stevenson', words: 67000, ease: 80.1, tags: ['adventure', 'fiction'] },
  { id: 'arthur-conan-doyle/the-hound-of-the-baskervilles', title: 'The Hound of the Baskervilles', author: 'Arthur Conan Doyle', words: 59000, ease: 75.4, tags: ['fiction', 'mystery'] },
  { id: 'jane-austen/emma', title: 'Emma', author: 'Jane Austen', words: 160000, ease: 63.1, tags: ['fiction'] },
  { id: 'jules-verne/twenty-thousand-leagues-under-the-seas', title: 'Twenty Thousand Leagues Under the Seas', author: 'Jules Verne', words: 140000, ease: 70.2, tags: ['adventure', 'fiction', 'science-fiction'] },
  ...Array.from({ length: 54 }, (_, k) => ({
    id: `author-${k}/book-${k}`,
    title: `Book ${k + 1}`,
    author: `Author ${k + 1}`,
    words: 10000 + k * 1000,
    ease: 50 + (k % 30),
    tags: ['fiction', ...(k % 3 === 0 ? ['adventure'] : []), ...(k % 5 === 0 ? ['poetry'] : [])],
  })),
]
export const CATALOG_SIZE = BOOKS.length

/** A page of results, in the site's own markup (see the saved pages in fixtures/), searched and sorted roughly as the site does. */
function listPage(params: URLSearchParams) {
  const perPage = Number(params.get('per-page') ?? 12)
  const page = Number(params.get('page') ?? 1)
  const query = (params.get('query') ?? '').toLowerCase()
  const tag = params.get('tags[]')
  let books = BOOKS.filter((b) => (!tag || b.tags.includes(tag)) && (!query || `${b.title} ${b.author}`.toLowerCase().includes(query)))
  const sort = params.get('sort')
  if (sort === 'newest') books = [...books].reverse()
  if (sort === 'length') books = [...books].sort((a, b) => a.words - b.words)
  if (sort === 'reading-ease') books = [...books].sort((a, b) => b.ease - a.ease)
  const last = Math.max(1, Math.ceil(books.length / perPage))
  const items = books
    .slice((page - 1) * perPage, page * perPage)
    .map(
      (b) => `<li typeof="schema:Book" about="/ebooks/${b.id}">
        <div class="thumbnail-container"><picture><source srcset="/images/covers/${b.id.replace('/', '_')}/1/cover@2x.jpg 2x, /images/covers/${b.id.replace('/', '_')}/1/cover.jpg 1x" type="image/jpeg"/><img src="/images/covers/${b.id.replace('/', '_')}/1/cover@2x.jpg" alt=""/></picture></div>
        <p><a href="/ebooks/${b.id}" property="schema:url"><span property="schema:name">${b.title}</span></a></p>
        <div><p class="author"><a href="/ebooks/${b.id.split('/')[0]}">${b.author}</a></p></div>
        <div class="details"><p>${b.words.toLocaleString('en-US')} words • ${b.ease} reading ease</p>
        <ul class="tags">${b.tags.map((t) => `<li><a href="/subjects/${t}">${t}</a></li>`).join('')}</ul></div>
      </li>`,
    )
    .join('')
  const links = Array.from({ length: last }, (_, k) => `<li><a href="/ebooks?page=${k + 1}&amp;view=list">${k + 1}</a></li>`).join('')
  const next = page < last ? `<a href="/ebooks?page=${page + 1}&amp;view=list" rel="next">Next</a>` : '<a aria-disabled="true">Next</a>'
  if (!items) return `<!DOCTYPE html><html><body><main><p class="no-results">No ebooks matched your filters.</p></main></body></html>`
  return `<!DOCTYPE html><html><body><main><ol class="ebooks-list list">${items}</ol><nav class="pagination"><ol>${links}</ol>${next}</nav></main></body></html>`
}

export interface Catalog {
  /** Every request to the catalog, in order. */
  requests: URL[]
  /** Requests for a page of the catalog's list. */
  searches: () => URL[]
  /** Requests for a book's own page. */
  bookPages: () => URL[]
  /** Requests for the EPUB. */
  downloads: () => URL[]
  /** Make the next request for a page whose address matches fail, as a dropped connection would. */
  failNext: (match: RegExp) => void
}

export async function mockCatalog(page: Page): Promise<Catalog> {
  const requests: URL[] = []
  const book = await epub()
  const failing: RegExp[] = []
  await page.route('https://standardebooks.org/**', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    const fail = failing.findIndex((m) => m.test(url.href))
    if (fail !== -1) {
      failing.splice(fail, 1)
      return route.abort('connectionreset')
    }
    const headers = { 'access-control-allow-origin': '*' }
    const html = (name: string) => route.fulfill({ headers, contentType: 'text/html; charset=utf-8', body: fixture(name) })
    const path = url.pathname
    if (path === '/ebooks') {
      // As the site does: one subject is sent on to its /subjects/ page,
      // which other sites aren't allowed to read (no CORS header).
      const tags = url.searchParams.getAll('tags[]')
      if (tags.length === 1) return route.fulfill({ status: 302, headers: { ...headers, location: `/subjects/${tags[0]}` } })
      return route.fulfill({ headers, contentType: 'text/html; charset=utf-8', body: listPage(url.searchParams) })
    }
    if (path.startsWith('/subjects/')) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: listPage(new URLSearchParams()) })
    if (path === '/ebooks/jane-austen/pride-and-prejudice') return html('book-pride-and-prejudice')
    if (path === '/ebooks/jane-austen/pride-and-prejudice/text') return html('toc-pride-and-prejudice')
    if (path.startsWith('/ebooks/jane-austen/pride-and-prejudice/text/')) return html('chapter-1-pride-and-prejudice')
    if (path.endsWith('.epub')) {
      return route.fulfill({ headers: { ...headers, 'content-length': String(book.length) }, contentType: 'application/epub+zip', body: book })
    }
    if (/\.(jpe?g|png|avif)$/.test(path)) return route.fulfill({ headers, contentType: 'image/png', body: PIXEL })
    return route.fulfill({ status: 404, headers, body: 'Not found' })
  })
  return {
    requests,
    searches: () => requests.filter((u) => u.pathname === '/ebooks'),
    bookPages: () => requests.filter((u) => /^\/ebooks\/[^/]+\/[^/]+$/.test(u.pathname)),
    downloads: () => requests.filter((u) => u.pathname.endsWith('.epub')),
    failNext: (match) => void failing.push(match),
  }
}

/** From the library to the free books, once they've loaded. */
export async function openBrowse(page: Page) {
  await page.getByRole('button', { name: /Find a free book/ }).click()
  await page.getByRole('list', { name: 'Books' }).waitFor()
}
