// The legacy build is transpiled for browsers that lack the newest JS
// built-ins the modern build relies on (e.g. Map#getOrInsertComputed).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
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
): Promise<{ title?: string; sections: Section[] }> {
  const task = pdfjs.getDocument({ data })
  const doc = await task.promise
  try {
    const meta = await doc.getMetadata().catch(() => null)
    const info = meta?.info as { Title?: string } | undefined

    const sections: Section[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const text = pageText(content.items.filter((i): i is TextItem => 'str' in i))
      if (text) sections.push({ title: `Page ${n}`, paragraphs: [text] })
      page.cleanup()
      onProgress?.(n / doc.numPages)
    }

    if (sections.length === 0) {
      throw new Error('No text found in this PDF (it may be scanned images)')
    }
    return { title: info?.Title?.trim() || undefined, sections }
  } finally {
    await task.destroy()
  }
}
