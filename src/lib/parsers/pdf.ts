// The legacy build is transpiled for browsers that lack the newest JS
// built-ins the modern build relies on (e.g. Map#getOrInsertComputed).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { COVER_RENDER_WIDTH } from '../covers'
import type { Section } from '../text'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Join a page's text lines, merging words hyphenated across line breaks. */
function pageText(items: TextItem[]): string {
  let text = ''
  for (const item of items) {
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return text
    .replace(/(\p{L})-\n(?=\p{Ll})/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function parsePdf(
  data: ArrayBuffer,
  onProgress?: (fraction: number) => void,
): Promise<{ title?: string; sections: Section[]; cover?: string }> {
  const task = pdfjs.getDocument({ data })
  const doc = await task.promise
  try {
    const meta = await doc.getMetadata().catch(() => null)
    const info = meta?.info as { Title?: string } | undefined

    const pages: { n: number; text: string }[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const text = pageText(content.items.filter((i): i is TextItem => 'str' in i))
      if (text) pages.push({ n, text })
      page.cleanup()
      onProgress?.(n / doc.numPages)
    }

    if (pages.length === 0) {
      throw new Error('No text found in this PDF (it may be scanned images)')
    }
    const outline = await outlineChapters(doc).catch(() => [])
    const cover = await firstPageImage(doc).catch(() => undefined)
    return { title: info?.Title?.trim() || undefined, sections: groupPages(pages, outline), cover }
  } finally {
    await task.destroy()
  }
}

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>

/** The first page, rendered small, as the book's cover. */
async function firstPageImage(doc: PdfDocument): Promise<string | undefined> {
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: COVER_RENDER_WIDTH / page.getViewport({ scale: 1 }).width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  await page.render({ canvas, viewport }).promise
  page.cleanup()
  return canvas.toDataURL('image/jpeg', 0.82)
}

/** Top-level bookmarks as { title, page } (1-based), in page order. */
async function outlineChapters(doc: PdfDocument): Promise<{ title: string; page: number }[]> {
  const outline = await doc.getOutline()
  if (!outline?.length) return []
  const chapters: { title: string; page: number }[] = []
  for (const item of outline) {
    const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest
    const ref = dest?.[0]
    if (!ref) continue
    const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref)
    chapters.push({ title: item.title.trim(), page: index + 1 })
  }
  return chapters.sort((a, b) => a.page - b.page)
}

/**
 * Chapters from the PDF's bookmarks when it has them (each spanning the pages
 * up to the next bookmark), otherwise one section per page.
 */
function groupPages(pages: { n: number; text: string }[], outline: { title: string; page: number }[]): Section[] {
  if (outline.length < 2) return pages.map((p) => ({ title: `Page ${p.n}`, paragraphs: [p.text] }))
  const sections: Section[] = []
  const before = pages.filter((p) => p.n < outline[0].page)
  if (before.length) sections.push({ title: 'Beginning', paragraphs: before.map((p) => p.text) })
  outline.forEach((ch, k) => {
    const next = outline[k + 1]?.page ?? Infinity
    const inside = pages.filter((p) => p.n >= ch.page && p.n < next)
    if (inside.length) sections.push({ title: ch.title, paragraphs: inside.map((p) => p.text) })
  })
  return sections
}
