import JSZip from 'jszip'
import { nextChapterStart, paragraphsBetween } from './pages'
import type { Book } from './types'

/**
 * The book as an EPUB, for reading on an e-reader (an Xteink, say). Built
 * from the parsed text, since the original file isn't kept: a section per
 * chapter, paragraphs as they were, headings as headings. Carries both
 * tables of contents, EPUB 3's and EPUB 2's, as small e-readers often read
 * only the older one. The book's cover (a data URL), if it has one, goes in
 * as the cover image and a first page.
 */
export async function buildEpub(book: Book, now = new Date()): Promise<ArrayBuffer> {
  const zip = new JSZip()
  // Must be first and uncompressed, so readers can recognise the file.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  )
  const sections = epubSections(book)
  const id = `urn:chapter:${book.id}`
  const title = escapeXml(book.title)
  sections.forEach((s, k) => zip.file(`OEBPS/${sectionFile(k)}`, page(s.title, s.html)))
  const cover = book.cover ? dataUrl(book.cover) : null
  const coverFile = cover && `cover.${cover.type === 'image/png' ? 'png' : 'jpg'}`
  if (cover && coverFile) {
    zip.file(`OEBPS/${coverFile}`, cover.data, { base64: true })
    zip.file('OEBPS/cover.xhtml', page(book.title, `<div><img src="${coverFile}" alt="${title}" style="max-width: 100%"/></div>`))
  }
  zip.file(
    'OEBPS/nav.xhtml',
    page(
      'Contents',
      `<nav epub:type="toc"><h1>Contents</h1><ol>${sections
        .map((s, k) => `<li><a href="${sectionFile(k)}">${escapeXml(s.title)}</a></li>`)
        .join('')}</ol></nav>`,
    ),
  )
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${id}"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>${sections
    .map(
      (s, k) =>
        `<navPoint id="nav${k}" playOrder="${k + 1}"><navLabel><text>${escapeXml(s.title)}</text></navLabel><content src="${sectionFile(k)}"/></navPoint>`,
    )
    .join('')}</navMap>
</ncx>`,
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${id}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${now.toISOString().replace(/\.\d+Z$/, 'Z')}</meta>${cover ? '\n    <meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${
      cover
        ? `\n    <item id="cover-image" href="${coverFile}" media-type="${cover.type}" properties="cover-image"/>\n    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`
        : ''
    }
${sections.map((_, k) => `    <item id="s${k}" href="${sectionFile(k)}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">${cover ? '\n    <itemref idref="cover"/>' : ''}
${sections.map((_, k) => `    <itemref idref="s${k}"/>`).join('\n')}
  </spine>
</package>`,
  )
  return zip.generateAsync({ type: 'arraybuffer', mimeType: 'application/epub+zip' })
}

/** One section per chapter (the whole book if it has none), as XHTML paragraphs and headings. */
export function epubSections(book: Book): { title: string; html: string }[] {
  const { words } = book
  const ends = new Set(book.paragraphEnds)
  const headingStarts = new Set((book.headings ?? []).map((h) => h.start))
  const chapters = book.chapters.length ? book.chapters : [{ title: book.title, start: 0 }]
  const starts = chapters.map((c) => c.start)
  return chapters.map((c) => {
    const to = nextChapterStart(starts, c.start, words.length) - 1
    const html = paragraphsBetween(ends, c.start, to)
      .map((para) => {
        const tag = headingStarts.has(para[0]) ? 'h2' : 'p'
        return `<${tag}>${escapeXml(para.map((i) => words[i]).join(' '))}</${tag}>`
      })
      .join('\n')
    return { title: c.title || book.title, html }
  })
}

/** A file name for the EPUB: the title, without characters file systems refuse. */
export function epubFileName(title: string): string {
  return `${title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'book'}.epub`
}

const sectionFile = (k: number) => `section${k + 1}.xhtml`

/** An image data URL's type and base64 data, or null for anything else. */
function dataUrl(url: string): { type: string; data: string } | null {
  const match = url.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/)
  return match ? { type: match[1], data: match[2] } : null
}

const page = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeXml(title)}</title></head>
<body>
${body}
</body>
</html>`

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
