import { sentenceStart } from './rsvp'
import type { Bookmark } from './types'

/** Where a bookmark for the word at `index` goes: the start of its sentence, so it reads well and resumes cleanly. */
export function bookmarkSpot(words: string[], index: number): number {
  return sentenceStart(words, index)
}

export function isBookmarked(bookmarks: Bookmark[], words: string[], index: number): boolean {
  const spot = bookmarkSpot(words, index)
  return bookmarks.some((b) => b.index === spot)
}

/** Add a bookmark at the sentence holding `index`, or remove it if there is one. Kept in reading order. */
export function toggleBookmark(bookmarks: Bookmark[], words: string[], index: number, now = Date.now()): Bookmark[] {
  const spot = bookmarkSpot(words, index)
  if (bookmarks.some((b) => b.index === spot)) return bookmarks.filter((b) => b.index !== spot)
  return [...bookmarks, { index: spot, createdAt: now }].sort((a, b) => a.index - b.index)
}
