// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  bookUrl,
  downloadBook,
  downloadUrl,
  easeLabel,
  fetchText,
  isBookId,
  parseCatalogPage,
  parseContents,
  parseDetails,
  parseSection,
  previewStart,
  searchUrl,
  textStart,
} from '../catalog'

/** Pages saved from standardebooks.org, cut down to their main content. */
const fixture = (name: string) => readFileSync(join(process.cwd(), `src/lib/__tests__/fixtures/standard-ebooks/${name}.html`), 'utf8')

describe('searchUrl', () => {
  it('asks for one light page, in the list view, popular first', () => {
    const url = new URL(searchUrl({}))
    expect(url.origin + url.pathname).toBe('https://standardebooks.org/ebooks')
    expect(url.searchParams.get('view')).toBe('list')
    expect(url.searchParams.get('sort')).toBe('popularity')
    expect(url.searchParams.get('per-page')).toBe('24')
    expect(url.searchParams.has('page')).toBe(false)
  })

  it('sorts by relevance when searching, unless an order is picked', () => {
    expect(new URL(searchUrl({ query: ' austen ' })).searchParams.get('query')).toBe('austen')
    expect(new URL(searchUrl({ query: 'austen' })).searchParams.get('sort')).toBe('relevance')
    expect(new URL(searchUrl({ query: 'austen', sort: 'newest' })).searchParams.get('sort')).toBe('newest')
  })

  it('gives a subject twice, so the site answers instead of sending it to a page the app can’t read', () => {
    const url = new URL(searchUrl({ subject: 'adventure', page: 3 }))
    expect(url.searchParams.getAll('tags[]')).toEqual(['adventure', 'adventure'])
    expect(url.searchParams.get('page')).toBe('3')
  })
})

describe('parseCatalogPage', () => {
  it('reads each book: id, title, author, cover, length and subjects', () => {
    const { books, hasMore } = parseCatalogPage(fixture('search-austen'))
    expect(books.length).toBe(7)
    expect(hasMore).toBe(false)
    const northanger = books.find((b) => b.id === 'jane-austen/northanger-abbey')!
    expect(northanger).toMatchObject({ title: 'Northanger Abbey', author: 'Jane Austen', words: 77464, readingEase: 66.88 })
    expect(northanger.subjects).toContain('Fiction')
    expect(northanger.tags).toContain('fiction')
    expect(northanger.cover).toMatch(/^https:\/\/standardebooks\.org\/images\/covers\/jane-austen_northanger-abbey\/.+\.jpg$/)
  })

  it('knows when there are more pages', () => {
    const { books, hasMore } = parseCatalogPage(fixture('search-all'))
    expect(books.length).toBe(12)
    expect(hasMore).toBe(true)
    expect(books[0]).toMatchObject({ id: 'jane-austen/pride-and-prejudice', title: 'Pride and Prejudice', words: 121970 })
  })

  it('finds nothing on a page with no results', () => {
    expect(parseCatalogPage(fixture('search-empty'))).toEqual({ books: [], hasMore: false })
  })

  it('skips anything that isn’t a link to a book in the catalog', () => {
    const html = `<ol>
      <li typeof="schema:Book" about="https://example.com/ebooks/a/b"><span property="schema:name">Elsewhere</span></li>
      <li typeof="schema:Book" about="/honeypot"><span property="schema:name">Trap</span></li>
      <li typeof="schema:Book" about="/ebooks/a/b"><span property="schema:name">Fine</span></li>
    </ol>`
    expect(parseCatalogPage(html).books.map((b) => b.title)).toEqual(['Fine'])
  })
})

describe('parseDetails', () => {
  const book = parseDetails(fixture('book-pride-and-prejudice'), 'jane-austen/pride-and-prejudice')

  it('reads the title, author, length and reading ease', () => {
    expect(book).toMatchObject({ title: 'Pride and Prejudice', author: 'Jane Austen', words: 121970, readingEase: 60.95 })
    expect(book.subjects).toEqual(['Fiction'])
    expect(book.tags).toEqual(['fiction'])
  })

  it('reads the one-line summary and the description, as paragraphs of plain text', () => {
    expect(book.summary).toMatch(/^A Regency-era novel of manners/)
    expect(book.description).toHaveLength(1)
    expect(book.description[0]).toMatch(/^Pride and Prejudice may today be one of Jane Austen’s most enduring novels/)
    expect(book.description.join(' ')).not.toMatch(/</)
  })

  it('picks the compatible EPUB, and the read-online contents', () => {
    expect(book.epub).toBe('https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub')
    expect(book.contents).toBe('https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/text')
    expect(book.cover).toMatch(/^https:\/\/standardebooks\.org\/images\/covers\/jane-austen_pride-and-prejudice\/.+\.jpg$/)
  })

  it('names the translator', () => {
    const anna = parseDetails(fixture('book-anna-karenina'), 'leo-tolstoy/anna-karenina/constance-garnett')
    expect(anna).toMatchObject({ title: 'Anna Karenina', author: 'Leo Tolstoy', translator: 'Constance Garnett' })
    expect(anna.epub).toMatch(/\/ebooks\/leo-tolstoy\/anna-karenina\/constance-garnett\/downloads\/.+\.epub$/)
  })

  it('won’t take an EPUB from anywhere but the book’s own downloads', () => {
    const html = `<article class="ebook"><h1>X</h1><section id="download"><a href="https://example.com/x.epub">epub</a></section></article>`
    expect(() => parseDetails(html, 'a/b')).toThrow(/no EPUB/)
  })
})

describe('the preview', () => {
  const contents = parseContents(fixture('toc-pride-and-prejudice'), 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/text')

  it('lists the read-online sections', () => {
    expect(contents[0]).toEqual({ label: 'Titlepage', href: 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/text/titlepage' })
    expect(contents.some((e) => e.label === 'LXI')).toBe(true)
    expect(contents.every((e) => e.href.startsWith('https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/text/'))).toBe(true)
  })

  it('starts at the text itself, past the title page and imprint', () => {
    expect(contents[previewStart(contents)].href).toMatch(/\/text\/chapter-1$/)
  })

  it('reads a section as plain paragraphs', () => {
    const section = parseSection(fixture('chapter-1-pride-and-prejudice'))
    expect(section.title).toBe('I')
    expect(section.paragraphs[0]).toBe('It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.')
    expect(section.paragraphs[2]).toBe('“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”')
  })
})

describe('book ids and addresses', () => {
  it('accepts only catalog paths', () => {
    expect(isBookId('jane-austen/pride-and-prejudice')).toBe(true)
    expect(isBookId('leo-tolstoy/anna-karenina/constance-garnett')).toBe(true)
    for (const bad of ['', 'jane-austen', '../x/y', 'a/b?c', 'A/B', 'a//b', 'https://x/a/b']) expect(isBookId(bad)).toBe(false)
    expect(() => bookUrl('../../honeypot')).toThrow()
  })

  it('downloads with the query that gets the file, not the thank-you page', () => {
    expect(downloadUrl('https://standardebooks.org/ebooks/a/b/downloads/a_b.epub')).toBe(
      'https://standardebooks.org/ebooks/a/b/downloads/a_b.epub?source=download',
    )
  })

  it('labels reading ease', () => {
    expect([90, 70, 50, 20].map(easeLabel)).toEqual(['Easy', 'Average', 'Fairly hard', 'Hard'])
  })
})

describe('textStart', () => {
  const words = { length: 120000 }
  it('skips the title page and imprint to the first chapter', () => {
    const chapters = [
      { title: 'Pride and Prejudice', start: 0 },
      { title: 'Imprint', start: 6 },
      { title: 'I', start: 199 },
      { title: 'II', start: 1053 },
    ]
    expect(textStart({ title: 'Pride and Prejudice', words, chapters })).toBe(199)
  })

  it('keeps a preface or introduction, which is part of the book', () => {
    const chapters = [
      { title: 'Imprint', start: 0 },
      { title: 'Dedication', start: 150 },
      { title: 'Preface', start: 180 },
    ]
    expect(textStart({ title: 'X', words, chapters })).toBe(180)
  })

  it('starts at the start when nothing early is the text', () => {
    expect(textStart({ title: 'X', words, chapters: [{ title: 'Imprint', start: 0 }, { title: 'I', start: 50000 }] })).toBe(0)
    expect(textStart({ title: 'X', words, chapters: [] })).toBe(0)
    // A short book still skips its title page.
    expect(textStart({ title: 'X', words: { length: 300 }, chapters: [{ title: 'X', start: 0 }, { title: 'I', start: 40 }] })).toBe(40)
  })
})

describe('fetching', () => {
  it('refuses anything off the catalog', async () => {
    await expect(fetchText('https://example.com/x', vi.fn())).rejects.toThrow()
  })

  it('tries again once when the connection drops', async () => {
    const url = 'https://standardebooks.org/ebooks?test=dropped'
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response('back'))
    expect(await fetchText(url, fetcher)).toBe('back')
    expect(fetcher).toHaveBeenCalledTimes(2)
    const down = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchText('https://standardebooks.org/ebooks?test=down', down)).rejects.toThrow(/Couldn’t reach Standard Ebooks/)
    expect(down).toHaveBeenCalledTimes(2)
  })

  it('says what the site answered when it isn’t a page', async () => {
    await expect(fetchText('https://standardebooks.org/ebooks?x', vi.fn(async () => new Response('', { status: 503 })))).rejects.toThrow(/503/)
  })

  it('downloads the EPUB as a file, with progress', async () => {
    const bytes = new Uint8Array(1000).fill(7)
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => new Response(bytes, { headers: { 'content-length': '1000' } }))
    const progress: number[] = []
    const file = await downloadBook(
      { id: 'jane-austen/emma', epub: 'https://standardebooks.org/ebooks/jane-austen/emma/downloads/jane-austen_emma.epub' },
      (f) => progress.push(f),
      undefined,
      fetcher,
    )
    expect(fetcher.mock.calls[0][0]).toMatch(/\?source=download$/)
    expect(file.name).toBe('jane-austen_emma.epub')
    expect(file.size).toBe(1000)
    expect(progress.at(-1)).toBe(1)
  })

  it('won’t download from anywhere else', async () => {
    await expect(downloadBook({ id: 'a/b', epub: 'https://example.com/a.epub' }, undefined, undefined, vi.fn())).rejects.toThrow()
  })
})
