import { sentenceStart } from './rsvp'
import type { Bookmark } from './types'

/** Where a bookmark for the word at `index` goes: the start of its sentence, so it reads well and resumes cleanly. */
export function bookmarkSpot(words: string[], index: number): number {
  return sentenceStart(words, index)
}

/** A plain bookmark (a sentence), not a highlight. */
const isSpot = (b: Bookmark) => b.end === undefined

const inOrder = (a: Bookmark, b: Bookmark) => a.index - b.index || (a.end ?? a.index) - (b.end ?? b.index)

export function isBookmarked(bookmarks: Bookmark[], words: string[], index: number): boolean {
  const spot = bookmarkSpot(words, index)
  return bookmarks.some((b) => isSpot(b) && b.index === spot)
}

/** Add a bookmark at the sentence holding `index`, or remove it if there is one. Kept in reading order. */
export function toggleBookmark(bookmarks: Bookmark[], words: string[], index: number, now = Date.now()): Bookmark[] {
  const spot = bookmarkSpot(words, index)
  if (bookmarks.some((b) => isSpot(b) && b.index === spot)) return bookmarks.filter((b) => !(isSpot(b) && b.index === spot))
  return [...bookmarks, { index: spot, createdAt: now }].sort(inOrder)
}

/** Save the words `start` to `end` as a highlight (once: the same words again change nothing). Kept in reading order. */
export function addHighlight(bookmarks: Bookmark[], start: number, end: number, now = Date.now()): Bookmark[] {
  if (end < start || bookmarks.some((b) => b.index === start && b.end === end)) return bookmarks
  return [...bookmarks, { index: start, end, createdAt: now }].sort(inOrder)
}

/** Whether word `i` is in a saved highlight. */
export function isHighlighted(bookmarks: Bookmark[], i: number): boolean {
  return bookmarks.some((b) => b.end !== undefined && b.index <= i && i <= b.end)
}
