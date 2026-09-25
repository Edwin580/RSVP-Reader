import { buildBook, splitMarkdownChapters, splitParagraphs, splitTextChapters, type Section } from './text'
import type { Book } from './types'

/**
 * The CPU-heavy part of reading a file: turning text into words, paragraphs,
 * chapters and headings. Runs in a Web Worker (see parseClient.ts), so it
 * has no DOM access; EPUB and PDF extraction happen first on the main thread
 * and hand their sections over.
 */
export type AssembleRequest =
  | { kind: 'text' | 'markdown'; id: string; title: string; data: ArrayBuffer }
  | { kind: 'sections'; id: string; title: string; sections: Section[] }

export function assemble(request: AssembleRequest): Book {
  let sections: Section[]
  if (request.kind === 'sections') {
    sections = request.sections
  } else {
    const text = new TextDecoder().decode(request.data)
    sections = request.kind === 'text' ? splitTextChapters(splitParagraphs(text)) : splitMarkdownChapters(text)
  }
  return buildBook(request.id, request.title, sections)
}

/**
 * Words never contain whitespace, so a book crosses between threads with its
 * words as one newline-joined string: far cheaper to copy than an array of
 * hundreds of thousands of strings.
 */
export type PackedBook = Omit<Book, 'words'> & { words: string }

export const packBook = (book: Book): PackedBook => ({ ...book, words: book.words.join('\n') })

export const unpackBook = (packed: PackedBook): Book => ({
  ...packed,
  words: packed.words ? packed.words.split('\n') : [],
})
