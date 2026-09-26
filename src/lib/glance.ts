import { isSentenceEnd, sentenceStart } from './rsvp'

/**
 * RSVP's big weakness is that you can't glance back: research on reading
 * (Rayner et al., 2016) finds most backward eye movements repair a
 * misunderstanding, and taking them away costs comprehension. A glance shows
 * the sentence before the current one and the current sentence, so a missed
 * word or name can be picked up without losing your place.
 */

/** Longest glance, in words, so a very long sentence still fits on screen. */
const MAX_BACK = 60
const MAX_AHEAD = 30

export function glanceRange(words: string[], index: number): { start: number; end: number } {
  if (words.length === 0) return { start: 0, end: -1 }
  const current = sentenceStart(words, index)
  const previous = current > 0 ? sentenceStart(words, current - 1) : current
  const start = Math.max(previous, index - MAX_BACK)
  let end = index
  while (end < words.length - 1 && end - index < MAX_AHEAD && !isSentenceEnd(words[end])) end++
  return { start, end }
}

export type Gesture = 'tap' | 'hold' | 'swipe-left' | 'swipe-right' | 'none'

/** Movement (px) that stops a press counting as a tap or hold. */
export const MOVE_TOLERANCE = 10
/** Horizontal distance (px) for a swipe. */
export const SWIPE_DISTANCE = 40
/** Press length (ms) that turns a tap into a hold. */
export const HOLD_MS = 280

/** What a finished press was, from how far it moved and how long it lasted. */
export function classifyGesture(dx: number, dy: number, ms: number): Gesture {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax >= SWIPE_DISTANCE && ax > ay * 1.5) return dx < 0 ? 'swipe-left' : 'swipe-right'
  if (ax > MOVE_TOLERANCE || ay > MOVE_TOLERANCE) return 'none'
  return ms >= HOLD_MS ? 'hold' : 'tap'
}
