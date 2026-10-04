// The legacy build is transpiled for browsers that lack the newest JS
// built-ins the modern build relies on (e.g. Map#getOrInsertComputed).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { COVER_RENDER_WIDTH } from '../covers'
import { stripPageEdges, type PageLine } from '../pageArtifacts'
import { readPages, type PageReader } from '../readPages'
import type { Section } from '../text'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** A page's text as lines, each with its height on the page. */
function pageLines(items: TextItem[]): PageLine[] {
  const lines: PageLine[] = []
  let text = ''
  let y: number | null = null
  const end = () => {
    const line = text.replace(/\s+/g, ' ').trim()
    if (line && y !== null) lines.push({ text: line, y })
    text = ''
    y = null
  }
  for (const item of items) {
    if (y === null && item.str.trim()) y = item.transform[5]
    text += item.str
    if (item.hasEOL) end()
  }
  end()
  return lines
}

/** Join a page's lines, merging words hyphenated across line breaks. */
function joinLines(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/(\p{L})-\n(?=\p{Ll})/gu, '$1')
    // A "--" dash split over two lines.
    .replace(/-\n-/g, '--')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function parsePdf(
  data: ArrayBuffer,
  onProgress?: (fraction: number) => void,
): Promise<{ title?: string; sections: Section[]; cover?: string }> {
  // pdf.js takes over the buffer it's given, so the copy for a second
  // worker has to be made first (see SECOND_WORKER_MIN_PAGES).
  const copy =
    data.byteLength <= SECOND_WORKER_MAX_BYTES && (navigator.hardwareConcurrency ?? 1) >= 4 ? data.slice(0) : null
  const task = pdfjs.getDocument({ data })
  const doc = await task.promise
  const second = copy && doc.numPages >= SECOND_WORKER_MIN_PAGES ? pdfjs.getDocument({ data: copy }) : null
  // If it fails to open, the first copy reads everything.
  const secondReader = second?.promise.then(pageReader)
  secondReader?.catch(() => {})
  try {
    const meta = await doc.getMetadata().catch(() => null)
    const info = meta?.info as { Title?: string } | undefined

    const lines = await readPages(doc.numPages, pageReader(doc), secondReader, onProgress)
    // Without the running headers, footers and page numbers.
    const pages = stripPageEdges(lines)
      .map((page, i) => ({ n: i + 1, text: joinLines(page) }))
      .filter((p) => p.text)

    if (pages.length === 0) {
      throw new Error('There’s no text in this PDF. It may be scanned pages, which are only pictures.')
    }
    const outline = await outlineChapters(doc).catch(() => [])
    const cover = await firstPageImage(doc).catch(() => undefined)
    return { title: info?.Title?.trim() || undefined, sections: groupPages(pages, outline), cover }
  } finally {
    await Promise.all([task.destroy(), second?.destroy()])
  }
}

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>

/**
 * pdf.js reads a document in one background worker. For longer PDFs a second
 * worker opens its own copy and reads alongside: about a quarter faster
 * overall (a third didn't help). Not for files so big that a second copy
 * would strain memory.
 */
const SECOND_WORKER_MIN_PAGES = 40
const SECOND_WORKER_MAX_BYTES = 50 * 1024 * 1024

const pageReader =
  (doc: PdfDocument): PageReader<PageLine[]> =>
  async (n) => {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    page.cleanup()
    return pageLines(content.items.filter((i): i is TextItem => 'str' in i))
  }

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
