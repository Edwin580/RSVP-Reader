import type { BookNames } from './names'

/**
 * Smart pacing: a little extra time where readers naturally slow down, on
 * top of the usual word-length and punctuation timing. The reader keeps the
 * same overall speed; these words borrow time from easy ones.
 *
 * - A name the first time it appears (and a bit on the next two), so new
 *   people and places register.
 * - Rare words: long words that appear only once or twice in the whole book.
 * - Numbers, which can't be guessed from context.
 * - The start of dialogue, where the speaker usually changes.
 */
export const FIRST_MENTION = 0.6
export const EARLY_MENTION = 0.25
export const RARE_WORD = 0.25
export const NUMBER = 0.35
export const DIALOGUE = 0.15

const RARE_MIN_LETTERS = 7
const DIGIT = /[0-9]/
/** “ " ‘ at the start of a word. */
const isOpeningQuote = (c: number) => c === 0x201c || c === 0x22 || c === 0x2018

export function smartExtras(words: string[], { nameOf, names, keys }: BookNames): Float32Array {
  const extras = new Float32Array(words.length)
  const frequency = new Map<string, number>()
  for (const key of keys) if (key.length >= RARE_MIN_LETTERS) frequency.set(key, (frequency.get(key) ?? 0) + 1)
  const mentionsSoFar = new Int32Array(names.length)
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const name = nameOf[i]
    if (name >= 0) {
      const seen = mentionsSoFar[name]++
      extras[i] += seen === 0 ? FIRST_MENTION : seen < 3 ? EARLY_MENTION : 0
    } else if (keys[i].length >= RARE_MIN_LETTERS && (frequency.get(keys[i]) ?? 0) <= 2) {
      extras[i] += RARE_WORD
    }
    if (DIGIT.test(w)) extras[i] += NUMBER
    if (w.length > 1 && isOpeningQuote(w.charCodeAt(0))) extras[i] += DIALOGUE
  }
  return extras
}
