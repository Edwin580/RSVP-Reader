import JSZip from 'jszip'
import { isChapterHeading, type Section } from '../text'

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'td', 'th', 'tr', 'ul',
])
const SKIP_TAGS = new Set(['script', 'style', 'head', 'svg', 'math', 'img', 'rt'])

function parseXml(source: string, type: DOMParserSupportedType): Document {
  const doc = new DOMParser().parseFromString(source, type)
  // Some EPUBs ship XHTML that isn't well-formed XML; fall back to the lenient HTML parser.
  if (type !== 'text/html' && doc.getElementsByTagName('parsererror').length > 0) {
    return new DOMParser().parseFromString(source, 'text/html')
  }
  return doc
}

function resolvePath(base: string, href: string): string {
  const parts = base.split('/').slice(0, -1)
  for (const seg of decodeURIComponent(href.split('#')[0]).split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/**
 * Walk the DOM collecting text, emitting a paragraph break around block
 * elements, and noting which paragraphs came from heading elements.
 */
function extractParagraphs(root: Element): { paragraphs: string[]; headings: number[] } {
  const paragraphs: string[] = []
  const headings: number[] = []
  let current = ''
  let inHeading = 0
  const flush = () => {
    const text = current.replace(/\s+/g, ' ').trim()
    if (text) {
      if (inHeading > 0) headings.push(paragraphs.length)
      paragraphs.push(text)
    }
    current = ''
  }
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.nodeValue ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const tag = (node as Element).localName.toLowerCase()
    if (SKIP_TAGS.has(tag)) return
    if (tag === 'br') {
      current += ' '
      return
    }
    const heading = HEADING_TAGS.has(tag)
    const block = heading || BLOCK_TAGS.has(tag)
    if (block) flush()
    if (heading) inHeading++
    node.childNodes.forEach(walk)
    if (block) flush()
    if (heading) inHeading--
  }
  walk(root)
  flush()
  // Some books style headings as ordinary paragraphs ("<p class=ct>CHAPTER I</p>").
  if (headings.length === 0 && paragraphs.length > 1 && isChapterHeading(paragraphs[0])) headings.push(0)
  return { paragraphs, headings }
}

export async function parseEpub(data: ArrayBuffer): Promise<{ title?: string; sections: Section[] }> {
  const zip = await JSZip.loadAsync(data)
  const read = async (path: string) => {
    const file = zip.file(path)
    if (!file) throw new Error(`EPUB is missing ${path}`)
    return file.async('string')
  }

  const container = parseXml(await read('META-INF/container.xml'), 'application/xml')
  const opfPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  if (!opfPath) throw new Error('EPUB has no package document')
  const opf = parseXml(await read(opfPath), 'application/xml')

  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || undefined

  const manifest = new Map<string, { href: string; type: string }>()
  for (const item of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    manifest.set(item.getAttribute('id') ?? '', {
      href: item.getAttribute('href') ?? '',
      type: item.getAttribute('media-type') ?? '',
    })
  }

  const sections: Section[] = []
  for (const ref of Array.from(opf.getElementsByTagNameNS('*', 'itemref'))) {
    if (ref.getAttribute('linear') === 'no') continue
    const item = manifest.get(ref.getAttribute('idref') ?? '')
    if (!item || !/html|xml/.test(item.type)) continue
    const path = resolvePath(opfPath, item.href)
    if (!zip.file(path)) continue

    const doc = parseXml(await read(path), 'application/xhtml+xml')
    const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement
    const { paragraphs, headings } = extractParagraphs(body)
    if (paragraphs.length === 0) continue

    // Title from the opening heading(s): "Chapter 1" + "The Beginning" → "Chapter 1: The Beginning".
    const lead = headings[0] === 0 ? (headings[1] === 1 ? [0, 1] : [0]) : []
    const title = lead.map((i) => paragraphs[i].replace(/[.:]$/, '')).join(': ')
    sections.push({ title: title || doc.querySelector('title')?.textContent?.trim(), paragraphs, headings })
  }

  if (sections.length === 0) throw new Error('No readable text found in this EPUB')
  return { title, sections }
}
