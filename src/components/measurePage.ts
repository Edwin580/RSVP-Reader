import { pageBreak, paragraphsBetween } from '../lib/pages'
import { isSentenceEnd } from '../lib/rsvp'

/** Words laid out when there's no better guess; comfortably more than fits on any screen. */
const CHUNK = 700

/**
 * Lay out words from `start` in `box` (a hidden copy of the page's text
 * area, styled like it) and return the last one that fits, never past
 * `limit`. Rather than cut mid-sentence, the page ends at a sentence or
 * paragraph end on its last two lines when there is one. Like an e-reader,
 * a page that opens a chapter is set lower (CSS: .opens-chapter).
 */
export function measurePage(
  box: HTMLElement,
  words: string[],
  ends: Set<number>,
  headingStarts: Set<number>,
  start: number,
  limit: number,
  /** How many words to lay out: a little more than the last page held is plenty, and much quicker. */
  chunk = CHUNK,
): number {
  const last = Math.min(start + chunk, limit)
  const text = document.createElement('div')
  text.className = headingStarts.has(start) ? 'page-text opens-chapter' : 'page-text'
  const spans: HTMLElement[] = []
  for (const para of paragraphsBetween(ends, start, last)) {
    const heading = headingStarts.has(para[0])
    const el = document.createElement(heading ? 'h2' : 'p')
    if (heading) el.className = 'page-heading'
    for (const i of para) {
      const span = document.createElement('span')
      span.textContent = words[i]
      el.append(span, ' ')
      spans.push(span)
    }
    text.append(el)
  }
  box.replaceChildren(text)

  // The last word whose line fits (spans[k] is word start + k).
  const height = box.clientHeight
  let lo = 0
  let hi = spans.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    const s = spans[mid]
    if (s.offsetTop + s.offsetHeight <= height) lo = mid
    else hi = mid - 1
  }
  // Everything laid out fits and there's more: the guess was short, so try again with more.
  if (lo === spans.length - 1 && last < limit && chunk < CHUNK * 4) {
    box.replaceChildren()
    return measurePage(box, words, ends, headingStarts, start, limit, chunk * 2)
  }
  let end = start + lo
  if (end < limit) {
    const fits = spans.slice(0, lo + 1).map((s, k) => ({ index: start + k, top: s.offsetTop }))
    const cut = pageBreak(fits, (i) => ends.has(i) || isSentenceEnd(words[i]))
    if (cut >= start) end = cut
  }
  // Nothing left behind for anything looking for words on the page.
  box.replaceChildren()
  return end
}
