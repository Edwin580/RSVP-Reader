import { sentenceStart } from './rsvp'

/** Index of the first word of the paragraph containing `index`. `paragraphEnds` must be sorted. */
export function paragraphStart(paragraphEnds: number[], index: number): number {
  let lo = 0
  let hi = paragraphEnds.length - 1
  let prevEnd = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (paragraphEnds[mid] < index) {
      prevEnd = paragraphEnds[mid]
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return prevEnd + 1
}

/** A paragraph longer than this starts a page at the sentence instead, so the target word is on it. */
const MAX_LEAD_IN = 120

/**
 * Where to start a page that must show `index` when there's no page flow to
 * follow (opening the book, jumping via search or the slider): the start of
 * its paragraph, or of its sentence if the paragraph is long.
 */
export function pageAnchor(words: string[], paragraphEnds: number[], index: number): number {
  const p = paragraphStart(paragraphEnds, index)
  return index - p > MAX_LEAD_IN ? sentenceStart(words, index) : p
}

/** Split words [from, to] into paragraphs of word indices. */
export function paragraphsBetween(paragraphEnds: Set<number>, from: number, to: number): number[][] {
  const paragraphs: number[][] = []
  let current: number[] = []
  for (let i = from; i <= to; i++) {
    current.push(i)
    if (paragraphEnds.has(i)) {
      paragraphs.push(current)
      current = []
    }
  }
  if (current.length) paragraphs.push(current)
  return paragraphs
}
