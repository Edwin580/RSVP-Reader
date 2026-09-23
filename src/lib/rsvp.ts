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
const CLAUSE_END = /[,;:—–]["'”’)\]]*$/

/**
 * How long to show a word, as a multiple of the base interval (60000 / wpm).
 * Longer words and punctuation get extra time so the pace feels natural and
 * comprehension doesn't collapse at sentence boundaries.
 */
export function delayMultiplier(word: string, paragraphEnd: boolean): number {
  let m = 1
  const letters = word.replace(/[^\p{L}\p{N}]/gu, '').length
  if (letters > 7) m += Math.min((letters - 7) * 0.08, 0.6)
  if (paragraphEnd) m += 1.5
  else if (SENTENCE_END.test(word)) m += 1.2
  else if (CLAUSE_END.test(word)) m += 0.5
  return m
}

export function isSentenceEnd(word: string): boolean {
  return SENTENCE_END.test(word)
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
