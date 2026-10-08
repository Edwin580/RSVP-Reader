import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildEpub, epubFileName, epubSections } from '../exportEpub'
import type { Book } from '../types'

// Two chapters, each a heading and a paragraph; the second paragraph needs escaping.
const words = 'Chapter 1 The rabbit ran. Chapter 2 Alice & <the> "hole".'.split(' ')
const book: Book = {
  id: 'abc',
  title: 'A <Story>',
  words,
  paragraphEnds: [1, 4, 6, 10],
  chapters: [
    { title: 'Chapter 1', start: 0 },
    { title: 'Chapter 2', start: 5 },
  ],
  headings: [
    { start: 0, end: 1 },
    { start: 5, end: 6 },
  ],
}

describe('EPUB export', () => {
  it('makes a section per chapter, with headings and escaped paragraphs', () => {
    expect(epubSections(book)).toEqual([
      { title: 'Chapter 1', html: '<h2>Chapter 1</h2>\n<p>The rabbit ran.</p>' },
      { title: 'Chapter 2', html: '<h2>Chapter 2</h2>\n<p>Alice &amp; &lt;the&gt; &quot;hole&quot;.</p>' },
    ])
    // No chapters: the whole book is one section.
    expect(epubSections({ ...book, chapters: [], headings: [] })).toHaveLength(1)
  })

  it('builds a valid EPUB: mimetype first and uncompressed, both tables of contents', async () => {
    const data = await buildEpub(book, new Date('2026-10-08T12:00:00.123Z'))
    // The first entry's local header: compression method 0 (stored), then its name and contents.
    const head = new Uint8Array(data, 0, 30 + 8 + 20)
    expect(head[8] | (head[9] << 8)).toBe(0)
    expect(new TextDecoder().decode(head.slice(30))).toBe('mimetypeapplication/epub+zip')
    const zip = await JSZip.loadAsync(data)
    const names = Object.keys(zip.files)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:title>A &lt;Story&gt;</dc:title>')
    expect(opf).toContain('2026-10-08T12:00:00Z')
    expect(names).toEqual(expect.arrayContaining(['OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/section1.xhtml', 'OEBPS/section2.xhtml']))
  })

  it('names the file after the title', () => {
    expect(epubFileName('War: and/or Peace?')).toBe('War and or Peace.epub')
    expect(epubFileName('???')).toBe('book.epub')
  })
})
