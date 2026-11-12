import JSZip from 'jszip'
import { coverPageImage, pickCoverItem, picture, thumbnail, type ManifestItem } from '../covers'
import { isChapterHeading, pictureMark, type Section } from '../text'
import type { PictureImage } from '../types'

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

/** A picture found in a page: its address there, and the paragraph it comes before (or inside). */
interface ImageRef {
  href: string
  alt: string
  paragraph: number
}

/**
 * Walk the DOM collecting text, emitting a paragraph break around block
 * elements, and noting which paragraphs came from heading elements and
 * where the pictures are.
 */
function extractParagraphs(root: Element): { paragraphs: string[]; headings: number[]; images: ImageRef[] } {
  const paragraphs: string[] = []
  const headings: number[] = []
  const images: ImageRef[] = []
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
    // A picture, as an image or wrapped in an SVG (as covers and plates often are).
    const image = tag === 'img' ? (node as Element) : tag === 'svg' ? (node as Element).getElementsByTagNameNS('*', 'image')[0] : undefined
    const href = image?.getAttribute('src') ?? image?.getAttribute('xlink:href') ?? image?.getAttribute('href')
    if (href) images.push({ href, alt: image!.getAttribute('alt')?.trim() ?? '', paragraph: paragraphs.length })
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
  return { paragraphs, headings, images }
}

/** No book needs more pictures than this; past it they're left out, to keep the book a sensible size. */
const MAX_PICTURES = 300

export async function parseEpub(data: ArrayBuffer): Promise<{ title?: string; sections: Section[]; cover?: string; images: PictureImage[] }> {
  const zip = await JSZip.loadAsync(data)
  const read = async (path: string) => {
    const file = zip.file(path)
    if (!file) throw new Error(`This EPUB looks damaged (${path} is missing).`)
    return file.async('string')
  }

  const container = parseXml(await read('META-INF/container.xml'), 'application/xml')
  const opfPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  if (!opfPath) throw new Error('This EPUB looks damaged (it has no contents list).')
  const opf = parseXml(await read(opfPath), 'application/xml')

  const title = opf.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || undefined

  const manifest = new Map<string, ManifestItem>()
  for (const item of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    const id = item.getAttribute('id') ?? ''
    manifest.set(id, {
      id,
      href: item.getAttribute('href') ?? '',
      type: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? '',
    })
  }

  const sections: Section[] = []
  const images: PictureImage[] = []
  // A picture used twice (an ornament between scenes) is kept once.
  const kept = new Map<string, number | undefined>()
  for (const ref of Array.from(opf.getElementsByTagNameNS('*', 'itemref'))) {
    if (ref.getAttribute('linear') === 'no') continue
    const item = manifest.get(ref.getAttribute('idref') ?? '')
    if (!item || !/html|xml/.test(item.type)) continue
    const path = resolvePath(opfPath, item.href)
    if (!zip.file(path)) continue

    const doc = parseXml(await read(path), 'application/xhtml+xml')
    const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement
    const { paragraphs, headings, images: found } = extractParagraphs(body)
    if (paragraphs.length === 0 && found.length === 0) continue

    // Title from the opening heading(s): "Chapter 1" + "The Beginning" → "Chapter 1: The Beginning".
    const lead = headings[0] === 0 ? (headings[1] === 1 ? [0, 1] : [0]) : []
    const title = lead.map((i) => paragraphs[i].replace(/[.:]$/, '')).join(': ')
    // Each picture becomes a mark in the text where it stood (see pictureMark),
    // put in from the last back so the places of those before stay right.
    for (const image of found.reverse()) {
      const file = resolvePath(path, image.href)
      if (!kept.has(file)) {
        const entry = images.length < MAX_PICTURES ? zip.file(file) : null
        const type = [...manifest.values()].find((i) => resolvePath(opfPath, i.href) === file)?.type ?? ''
        const scaled = entry && (await picture(new Blob([await entry.async('arraybuffer')], { type })))
        kept.set(file, scaled ? images.push({ ...scaled, ...(image.alt && { alt: image.alt }) }) - 1 : undefined)
      }
      const id = kept.get(file)
      if (id === undefined) continue
      paragraphs.splice(image.paragraph, 0, pictureMark(id))
      headings.forEach((h, k) => h >= image.paragraph && (headings[k] = h + 1))
    }
    if (paragraphs.length === 0) continue
    sections.push({ title: title || doc.querySelector('title')?.textContent?.trim(), paragraphs, headings })
  }

  if (sections.length === 0) throw new Error('There’s no readable text in this EPUB.')
  return { title, sections, cover: await epubCover(zip, opf, opfPath, manifest), images }
}

async function epubCover(zip: JSZip, opf: Document, opfPath: string, manifest: Map<string, ManifestItem>) {
  const metaCover = Array.from(opf.getElementsByTagNameNS('*', 'meta'))
    .find((m) => m.getAttribute('name') === 'cover')
    ?.getAttribute('content')
  const items = [...manifest.values()]
  let path = pickCoverItem(items, metaCover)?.href
  let base = opfPath
  if (!path) {
    // No cover named: the book's first page, if it's a picture (often left out of the reading order).
    const first = manifest.get(opf.getElementsByTagNameNS('*', 'itemref')[0]?.getAttribute('idref') ?? '')
    const page = first && /html|xml/.test(first.type) && zip.file(resolvePath(opfPath, first.href))
    if (!first || !page) return undefined
    base = resolvePath(opfPath, first.href)
    path = coverPageImage(parseXml(await page.async('string'), 'application/xhtml+xml'))
  }
  const file = path && zip.file(resolvePath(base, path))
  if (!file) return undefined
  const full = resolvePath(base, path!)
  const type = items.find((i) => resolvePath(opfPath, i.href) === full)?.type ?? ''
  return thumbnail(new Blob([await file.async('arraybuffer')], { type }))
}
