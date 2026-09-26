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

/**
 * The text shown around the current word while paused: about `around` words
 * either side, widened to whole sentences so it never starts or stops
 * mid-sentence (unless a sentence is too long to fit). Inclusive range.
 */
export function pausedRange(words: string[], index: number, around = 40): { start: number; end: number } {
  if (words.length === 0) return { start: 0, end: -1 }
  const last = words.length - 1
  // Start: back to the start of that sentence if it's close, otherwise
  // forward to the next sentence that starts before the current word.
  const from = Math.max(0, index - around)
  let start = sentenceStart(words, from)
  if (from - start > around) {
    start = from
    for (let i = from + 1; i <= index; i++) {
      if (isSentenceEnd(words[i - 1])) {
        start = i
        break
      }
    }
  }
  // End: on to the end of that sentence if it's close, otherwise back to the
  // last sentence end after the current word.
  let end = Math.min(last, index + around)
  let stop = end
  while (stop < last && !isSentenceEnd(words[stop]) && stop - end < around) stop++
  if (isSentenceEnd(words[stop]) || stop === last) end = stop
  else {
    for (let i = end; i >= index; i--) {
      if (isSentenceEnd(words[i])) {
        end = i
        break
      }
    }
  }
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
