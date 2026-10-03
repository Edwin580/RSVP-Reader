import type { BookMeta, Progress } from './types'

/** How far through the book the reader is, from 0 to 1. */
export function fractionRead(book: Pick<BookMeta, 'wordCount'>, progress: Progress | undefined): number {
  return book.wordCount > 1 ? (progress?.index ?? 0) / (book.wordCount - 1) : 0
}

/** At the end: shown as 100%, so at (or within half a percent of) the last word. */
export function atEnd(wordCount: number, index: number): boolean {
  return Math.round(fractionRead({ wordCount }, { index, updatedAt: 0 }) * 100) === 100
}

export function readToEnd(book: Pick<BookMeta, 'wordCount'>, progress: Progress | undefined): boolean {
  return atEnd(book.wordCount, progress?.index ?? 0)
}

/**
 * On the Read shelf: marked as read, or closed at the end (which marks it
 * too, see App). Books finished before `readAt` existed count by position.
 */
export function isRead(book: BookMeta, progress: Progress | undefined): boolean {
  return book.readAt !== undefined || readToEnd(book, progress)
}
