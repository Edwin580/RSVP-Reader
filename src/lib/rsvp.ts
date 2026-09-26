/**
 * Optimal Recognition Point: the letter the eye should fixate on, a little
 * left of centre. Leading punctuation (quotes, brackets) is skipped so the
 * pivot lands on a letter.
 */
export function orpIndex(word: string): number {
  const lead = word.match(/^[^\p{L}\p{N}]*/u)?.[0].length ?? 0
  const core = word.slice(lead).replace(/[^\p{L}\p{N}]+$/u, '')
  const len = core.length
  let offset: number
  if (len <= 1) offset = 0
  else if (len <= 5) offset = 1
  else if (len <= 9) offset = 2
  else if (len <= 13) offset = 3
  else offset = 4
  return Math.min(lead + offset, Math.max(word.length - 1, 0))
}

export function splitAtOrp(word: string): [string, string, string] {
  const i = orpIndex(word)
  return [word.slice(0, i), word.charAt(i), word.slice(i + 1)]
}

const SENTENCE_END = /[.!?…]["'”’)\]]*$/
/** Words ending in a full stop that usually don't end a sentence: titles, initials, "e.g.", "U.S.". */
const ABBREVIATION = /^["'“‘(]*(?:mr|mrs|ms|mx|dr|st|jr|sr|prof|rev|hon|capt|col|gen|lt|sgt|mt|vs|e\.g|i\.e|cf|[a-hj-z]|(?:[a-z]\.){1,}[a-z])\.$/i
const CLAUSE_END = /[,;:—–]["'”’)\]]*$/

/** 'smart' is natural timing plus extra time for new names, rare words and numbers (see pacing.ts). */
export type WordTiming = 'smart' | 'natural' | 'even'
export const WORD_TIMINGS: WordTiming[] = ['smart', 'natural', 'even']

/**
 * Relative display time for a word with `letters` letters/digits: 1 at five
 * letters, rising with diminishing returns, like fixation times in natural
 * reading (1 → 0.75, 3 → 0.9, 8 → 1.12, 12 → 1.25, capped at 1.6).
 */
export function lengthFactor(letters: number): number {
  return Math.min(0.55 + 0.45 * Math.sqrt(Math.max(letters, 1) / 5), 1.6)
}

/** Extra time after punctuation, so sentence boundaries have room to land. */
export function pauseFactor(word: string, paragraphEnd: boolean): number {
  if (paragraphEnd) return 1.5
  // Most words end in a letter or digit and can't end a sentence or clause.
  if (isAsciiAlnum(word.charCodeAt(word.length - 1))) return 0
  if (isSentenceEnd(word)) return 1.2
  if (CLAUSE_END.test(word)) return 0.5
  return 0
}

/** Un-normalised display weight of one word. */
export function wordWeight(word: string, paragraphEnd: boolean, timing: WordTiming = 'natural'): number {
  return (timing === 'even' ? 1 : lengthFactor(countLetters(word))) + pauseFactor(word, paragraphEnd)
}

const isAsciiAlnum = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57)
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u

/**
 * Letters and digits in a word, counted in UTF-16 units like
 * `word.replace(/[^\p{L}\p{N}]/gu, '').length`, but without a regex for
 * plain ASCII. This runs for every word of the book when it opens.
 */
export function countLetters(word: string): number {
  let n = 0
  for (let i = 0; i < word.length; i++) {
    const c = word.charCodeAt(i)
    if (isAsciiAlnum(c)) n++
    else if (c > 127) {
      const astral = c >= 0xd800 && c <= 0xdbff && i + 1 < word.length
      const ch = astral ? word.slice(i, i + 2) : word[i]
      if (LETTER_OR_DIGIT.test(ch)) n += ch.length
      if (astral) i++
    }
  }
  return n
}

/**
 * Per-word display weights for a whole book, scaled so they average exactly
 * 1. A word is shown for `weight × 60000 / wpm` ms, so the chosen wpm is the
 * real average speed: long words and pauses borrow time from short words
 * rather than slowing the whole read down.
 */
export interface Timeline {
  weights: Float32Array
  /** cumulative[i] = sum of weights before word i (length = words + 1). */
  cumulative: Float64Array
}

/** Extra weight on heading words, so a chapter title registers before the text starts. */
const HEADING_EXTRA = 0.3

export function buildTimeline(
  words: string[],
  paragraphEnds: number[],
  timing: WordTiming = 'natural',
  headings: { start: number; end: number }[] = [],
  /** Extra weight per word, e.g. from smart pacing; added before balancing. */
  extras?: ArrayLike<number>,
): Timeline {
  // A flag per word is much faster to check than a Set, and this runs for every word.
  const ends = new Uint8Array(words.length)
  for (const i of paragraphEnds) if (i >= 0 && i < words.length) ends[i] = 1
  const raw = new Float64Array(words.length)
  for (let i = 0; i < words.length; i++) raw[i] = wordWeight(words[i], ends[i] === 1, timing)
  for (const h of headings) for (let i = h.start; i <= h.end && i < words.length; i++) raw[i] += HEADING_EXTRA
  if (extras) for (let i = 0; i < words.length; i++) raw[i] += extras[i] ?? 0
  let total = 0
  for (let i = 0; i < words.length; i++) total += raw[i]
  const scale = total > 0 ? words.length / total : 1
  const weights = new Float32Array(words.length)
  const cumulative = new Float64Array(words.length + 1)
  for (let i = 0; i < words.length; i++) {
    weights[i] = raw[i] * scale
    cumulative[i + 1] = cumulative[i] + weights[i]
  }
  return { weights, cumulative }
}

/** Minutes needed to read words [from, to) at `wpm`. */
export function minutesBetween(timeline: Timeline, from: number, to: number, wpm: number): number {
  const end = Math.min(to, timeline.cumulative.length - 1)
  return Math.max(0, timeline.cumulative[end] - timeline.cumulative[Math.max(from, 0)]) / wpm
}

/** "12 min", "4h 37m"; anything under a minute (but not nothing) is "1 min", never "<1 min". */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0 min'
  const m = Math.max(1, Math.round(minutes))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function isSentenceEnd(word: string): boolean {
  return SENTENCE_END.test(word) && !ABBREVIATION.test(word)
}

/** Index of the first word of the sentence containing `index`. */
export function sentenceStart(words: string[], index: number): number {
  let i = Math.min(index, words.length - 1)
  while (i > 0 && !isSentenceEnd(words[i - 1])) i--
  return Math.max(i, 0)
}

/** Start of the previous sentence (or the current one if we're mid-sentence). */
export function previousSentence(words: string[], index: number): number {
  const start = sentenceStart(words, index)
  return start < index ? start : sentenceStart(words, Math.max(start - 1, 0))
}

export function nextSentence(words: string[], index: number): number {
  for (let i = index; i < words.length - 1; i++) {
    if (isSentenceEnd(words[i])) return i + 1
  }
  return words.length - 1
}
