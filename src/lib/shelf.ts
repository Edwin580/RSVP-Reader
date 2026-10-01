import type { BookMeta, Progress } from './types'

/** How far through the book the reader is, from 0 to 1. */
export function fractionRead(book: Pick<BookMeta, 'wordCount'>, progress: Progress | undefined): number {
  return book.wordCount > 1 ? (progress?.index ?? 0) / (book.wordCount - 1) : 0
}

/** Read to the end: shown as 100%, so at (or within half a percent of) the last word. */
export function readToEnd(book: Pick<BookMeta, 'wordCount'>, progress: Progress | undefined): boolean {
  return Math.round(fractionRead(book, progress) * 100) === 100
}

/** On the Read shelf: read to the end, or marked as read. */
export function isRead(book: BookMeta, progress: Progress | undefined): boolean {
  return book.readAt !== undefined || readToEnd(book, progress)
}
