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

export interface Catalog {
  /** Every request to the catalog, in order. */
  requests: URL[]
  /** Requests for a page of the catalog's list. */
  searches: () => URL[]
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
      const query = url.searchParams.get('query') ?? ''
      if (/nothing/.test(query)) return html('search-empty')
      if (/austen/.test(query)) return html('search-austen')
      // A second page: some of the same books, and some new ones.
      return html(url.searchParams.get('page') === '2' ? 'search-austen' : 'search-all')
    }
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
    downloads: () => requests.filter((u) => u.pathname.endsWith('.epub')),
    failNext: (match) => void failing.push(match),
  }
}

/** From the library to the free books, once they've loaded. */
export async function openBrowse(page: Page) {
  await page.getByRole('button', { name: /Find a free book/ }).click()
  await page.getByRole('list', { name: 'Books' }).waitFor()
}
