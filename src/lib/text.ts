import type { Book, Chapter } from './types'

/** A section of raw text, e.g. an EPUB chapter or a PDF page. */
export interface Section {
  title?: string
  /** Paragraphs of plain text. */
  paragraphs: string[]
  /** Indices into `paragraphs` that are headings (e.g. the chapter title). */
  headings?: number[]
}

/**
 * Split a paragraph into display words. Em/en dashes glued between words
 * ("this—that") are split so each side is shown on its own.
 */
export function splitWords(paragraph: string): string[] {
  return paragraph
    .replace(/([\p{L}\p{N}])([—–])(?=[\p{L}\p{N}])/gu, '$1$2 ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Split plain text into paragraphs on blank lines, unwrapping hard-wrapped lines. */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/-\n(?=\p{Ll})/gu, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** Strip the most common Markdown syntax so it isn't flashed at the reader. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}(#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, '')
    .replace(/(\*\*|__|\*|_|`|~~)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, '')
}

export function buildBook(id: string, title: string, sections: Section[]): Book {
  const words: string[] = []
  const paragraphEnds: number[] = []
  const chapters: Chapter[] = []
  const headings: { start: number; end: number }[] = []

  sections.forEach((section, i) => {
    const start = words.length
    const headingSet = new Set(section.headings)
    section.paragraphs.forEach((paragraph, p) => {
      const parts = splitWords(paragraph)
      if (parts.length === 0) return
      if (headingSet.has(p)) headings.push({ start: words.length, end: words.length + parts.length - 1 })
      words.push(...parts)
      paragraphEnds.push(words.length - 1)
    })
    if (words.length > start) {
      chapters.push({ title: section.title?.trim() || `Section ${i + 1}`, start })
    }
  })

  return { id, title, words, paragraphEnds, chapters, headings }
}

const NUMBER_WORD =
  '(?:\\d+|(?=[mdclxvi])m{0,3}(?:c[md]|d?c{0,3})(?:x[cl]|l?x{0,3})(?:i[xv]|v?i{0,3})|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)'
const NUMBERED_HEADING = new RegExp(
  `^(?:chapter|chap\\.|part|book|volume|vol\\.|act|canto|letter)\\s+${NUMBER_WORD}\\b(?:[\\s.:—–-].{0,60})?$`,
  'i',
)
const NAMED_HEADING = /^(?:prologue|epilogue|introduction|preface|foreword|afterword|interlude|conclusion|appendix)\b.{0,40}$/i

/** Does this standalone paragraph look like a chapter heading ("CHAPTER XII.", "Chapter 3: The Storm", "Prologue")? */
export function isChapterHeading(paragraph: string): boolean {
  const p = paragraph.trim()
  return p.split(/\s+/).length <= 12 && (NUMBERED_HEADING.test(p) || NAMED_HEADING.test(p))
}

/** A short line under a heading that reads as its subtitle ("Down the Rabbit-Hole"). */
function isSubtitle(paragraph: string): boolean {
  const p = paragraph.trim()
  return p.split(/\s+/).length <= 8 && !/[.!?,;:]["'”’)]*$/.test(p) && /\p{Lu}/u.test(p.charAt(0)) && !isChapterHeading(p)
}

/**
 * Split plain-text paragraphs into chapters at lines that look like chapter
 * headings. Needs at least two headings to be confident; otherwise the text
 * stays one section.
 */
export function splitTextChapters(paragraphs: string[]): Section[] {
  const starts = paragraphs.flatMap((p, i) => (isChapterHeading(p) ? [i] : []))
  if (starts.length < 2) return [{ paragraphs }]
  const sections: Section[] = []
  if (starts[0] > 0) sections.push({ title: 'Beginning', paragraphs: paragraphs.slice(0, starts[0]) })
  starts.forEach((start, k) => {
    const chunk = paragraphs.slice(start, starts[k + 1] ?? paragraphs.length)
    const hasSubtitle = chunk.length > 2 && isSubtitle(chunk[1])
    const heading = chunk[0].trim().replace(/[.:]$/, '')
    sections.push({
      title: hasSubtitle ? `${heading}: ${chunk[1].trim()}` : heading,
      paragraphs: chunk,
      headings: hasSubtitle ? [0, 1] : [0],
    })
  })
  return sections
}

/**
 * Markdown to sections: '#' and '##' headings start chapters; deeper headings
 * are kept as headings inside them. Markdown syntax is stripped from the text.
 */
export function splitMarkdownChapters(md: string): Section[] {
  const blocks = md
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .flatMap((b) => {
      // A heading line directly followed by text becomes its own block.
      const m = b.match(/^(\s{0,3}#{1,6}[ \t][^\n]*)\n([\s\S]+)$/)
      return m ? [m[1], m[2]] : [b]
    })
  const sections: Section[] = []
  let current: Section = { paragraphs: [], headings: [] }
  for (const block of blocks) {
    const heading = block.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/)
    const text = heading ? stripMarkdown(heading[2]).trim() : splitParagraphs(stripMarkdown(block)).join(' ')
    if (!text) continue
    if (heading && heading[1].length <= 2) {
      if (current.paragraphs.length) sections.push(current)
      current = { title: text, paragraphs: [], headings: [] }
    }
    if (heading) current.headings!.push(current.paragraphs.length)
    current.paragraphs.push(text)
  }
  if (current.paragraphs.length) sections.push(current)
  return sections
}
