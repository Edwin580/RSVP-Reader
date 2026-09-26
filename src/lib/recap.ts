import { sentenceStart } from './rsvp'

/** Coming back after at least this long gets a "Previously…" recap. */
export const RECAP_AFTER_MS = 4 * 60 * 60 * 1000
/** Not worth a recap this close to the start of a book. */
const RECAP_MIN_INDEX = 30
/** Longest recap, in words. */
const MAX_WORDS = 90

/**
 * The last few sentences before `index`, to remind a returning reader where
 * they were. Returns an empty range when there's nothing worth recapping.
 */
export function recapRange(words: string[], index: number, sentences = 3): { start: number; end: number } {
  if (index < RECAP_MIN_INDEX) return { start: index, end: index - 1 }
  let start = index
  for (let n = 0; n < sentences && start > 0; n++) start = sentenceStart(words, start - 1)
  return { start: Math.max(start, index - MAX_WORDS), end: index - 1 }
}

export function shouldRecap(lastReadAt: number | undefined, index: number, now: number): boolean {
  return lastReadAt !== undefined && index >= RECAP_MIN_INDEX && now - lastReadAt >= RECAP_AFTER_MS
}

/** "3 hours ago", "yesterday", "5 days ago", "3 weeks ago", "2 months ago". */
export function timeAgo(then: number, now: number): string {
  const hours = Math.max(0, (now - then) / 3_600_000)
  if (hours < 24) return `${Math.max(1, Math.round(hours))} ${Math.round(hours) === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}
