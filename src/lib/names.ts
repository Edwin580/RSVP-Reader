import { isSentenceEnd } from './rsvp'

/**
 * People and places in a book, found without any dictionary: a word that is
 * capitalised even in the middle of sentences, and almost never lowercase, is
 * a name ("Maxim", "Manderley", "Danvers"). Used to give a new name a moment
 * longer on screen, and for the book's list of people and places.
 */
export interface NameInfo {
  name: string
  /** Every occurrence, in reading order. */
  indices: number[]
}

export interface BookNames {
  /** Names in order of first appearance. */
  names: NameInfo[]
  /** For each word, the index into `names`, or -1. */
  nameOf: Int32Array
  /** For each word, its lowercase key (see nameKey), shared with smart pacing so it's computed once. */
  keys: string[]
}

/** Capitalised words that aren't names, or that aren't useful as names. */
const NOT_NAMES = new Set(
  (
    'i im ive id ill mr mrs ms miss dr sir madam lady lord st mt ' +
    'monday tuesday wednesday thursday friday saturday sunday ' +
    'january february march april may june july august september october november december ' +
    'chapter part book volume god oh ah yes no ok okay ' +
    'colonel captain major general sergeant inspector constable professor doctor coroner judge ' +
    'father mother uncle aunt grandfather grandmother king queen prince princess duke duchess'
  ).split(' '),
)

const LETTER = /\p{L}/u
const UPPER = /\p{Lu}/u

const isAsciiLetter = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90)

/** The word without surrounding punctuation or a possessive ('s). */
export function nameKey(word: string): string {
  // Most words are plain letters: skip the regexes for them (this runs for every word).
  if (isAsciiLetter(word.charCodeAt(0)) && isAsciiLetter(word.charCodeAt(word.length - 1)) && !word.includes("'")) {
    return word
  }
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/u, '')
}

export function findNames(words: string[]): BookNames {
  const keys: string[] = new Array(words.length)
  const stats = new Map<string, { shown: string; midCaps: number; lower: number; total: number; caps: number[] }>()
  for (let i = 0; i < words.length; i++) {
    const key = nameKey(words[i])
    const lower = key.toLowerCase()
    keys[i] = lower
    if (key.length < 2) continue
    const first = key.charCodeAt(0)
    const upper = first >= 65 && first <= 90 ? true : first >= 97 && first <= 122 ? false : UPPER.test(key[0])
    if (!upper && !(first >= 97 && first <= 122) && !LETTER.test(key[0])) continue
    let s = stats.get(lower)
    if (!s) stats.set(lower, (s = { shown: key, midCaps: 0, lower: 0, total: 0, caps: [] }))
    s.total++
    if (!upper) s.lower++
    else s.caps.push(i)
    if (upper && i > 0 && !isSentenceEnd(words[i - 1]) && key !== key.toUpperCase()) {
      s.midCaps++
      s.shown = key
    }
  }
  const names: NameInfo[] = []
  for (const [lower, s] of stats) {
    const isName = s.midCaps >= 2 && s.lower <= s.total * 0.1 && !NOT_NAMES.has(lower.replace(/['’]/g, ''))
    if (isName) names.push({ name: s.shown, indices: s.caps })
  }
  names.sort((a, b) => a.indices[0] - b.indices[0])
  const nameOf = new Int32Array(words.length).fill(-1)
  names.forEach((n, k) => {
    for (const i of n.indices) nameOf[i] = k
  })
  return { names, nameOf, keys }
}
