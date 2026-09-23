import type { Book, Chapter } from './types'

/** A section of raw text, e.g. an EPUB chapter or a PDF page. */
export interface Section {
  title?: string
  /** Paragraphs of plain text. */
  paragraphs: string[]
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

  sections.forEach((section, i) => {
    const start = words.length
    for (const paragraph of section.paragraphs) {
      const parts = splitWords(paragraph)
      if (parts.length === 0) continue
      words.push(...parts)
      paragraphEnds.push(words.length - 1)
    }
    if (words.length > start) {
      chapters.push({ title: section.title?.trim() || `Section ${i + 1}`, start })
    }
  })

  return { id, title, words, paragraphEnds, chapters }
}
