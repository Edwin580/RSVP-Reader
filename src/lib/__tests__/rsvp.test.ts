import { describe, expect, it } from 'vitest'
import {
  buildTimeline,
  countLetters,
  formatMinutes,
  isSentenceEnd,
  lengthFactor,
  minutesBetween,
  nextSentence,
  orpIndex,
  pauseFactor,
  previousSentence,
  sentenceStart,
  splitAtOrp,
  wordWeight,
} from '../rsvp'

describe('orpIndex', () => {
  it('picks a letter left of centre based on length', () => {
    expect(orpIndex('a')).toBe(0)
    expect(orpIndex('read')).toBe(1)
    expect(orpIndex('reading')).toBe(2)
    expect(orpIndex('comprehension')).toBe(3)
    expect(orpIndex('incomprehensibility')).toBe(4)
  })

  it('skips leading punctuation', () => {
    expect(splitAtOrp('"Hello,')).toEqual(['"H', 'e', 'llo,'])
  })

  it('handles empty and punctuation-only tokens', () => {
    expect(orpIndex('')).toBe(0)
    expect(orpIndex('—')).toBe(0)
  })
})

describe('word timing', () => {
  it('gives longer words more time with diminishing returns', () => {
    expect(lengthFactor(5)).toBeCloseTo(1)
    expect(lengthFactor(1)).toBeLessThan(lengthFactor(3))
    expect(lengthFactor(3)).toBeLessThan(lengthFactor(8))
    expect(lengthFactor(8) - lengthFactor(5)).toBeGreaterThan(lengthFactor(11) - lengthFactor(8))
    expect(lengthFactor(80)).toBe(1.6)
  })

  it('pauses longer on punctuation and paragraph ends', () => {
    expect(pauseFactor('word', false)).toBe(0)
    expect(pauseFactor('word,', false)).toBeGreaterThan(0)
    expect(pauseFactor('word.', false)).toBeGreaterThan(pauseFactor('word,', false))
    expect(pauseFactor('word."', false)).toBe(pauseFactor('word.', false))
    expect(pauseFactor('word.', true)).toBeGreaterThan(pauseFactor('word.', false))
  })

  it('ignores punctuation when measuring length', () => {
    expect(wordWeight('"hello"', false)).toBe(wordWeight('hello', false))
    expect(wordWeight('extraordinary', false, 'even')).toBe(1)
  })
})

describe('buildTimeline', () => {
  const words = 'I read an extraordinarily long word, then stopped.'.split(' ')
  const timeline = buildTimeline(words, [words.length - 1])

  it('averages exactly 1 so the chosen wpm is the real speed', () => {
    const mean = timeline.weights.reduce((a, b) => a + b, 0) / words.length
    expect(mean).toBeCloseTo(1, 5)
    expect(minutesBetween(timeline, 0, words.length, 300)).toBeCloseTo(words.length / 300, 5)
  })

  it('orders words by length and punctuation', () => {
    const [i, read, an, extra] = timeline.weights
    expect(i).toBeLessThan(read)
    expect(an).toBeLessThan(read)
    expect(extra).toBeGreaterThan(read)
    expect(timeline.weights[7]).toBeGreaterThan(timeline.weights[6]) // "stopped." ends the paragraph
  })

  it('keeps pauses but drops length differences in even mode', () => {
    const even = buildTimeline(words, [], 'even')
    expect(even.weights[0]).toBeCloseTo(even.weights[3])
    expect(even.weights[5]).toBeGreaterThan(even.weights[4]) // "word,"
  })
})

describe('formatMinutes', () => {
  it('formats short and long durations', () => {
    expect(formatMinutes(0.4)).toBe('<1 min')
    expect(formatMinutes(12.2)).toBe('12 min')
    expect(formatMinutes(277)).toBe('4h 37m')
  })
})

describe('sentence navigation', () => {
  const words = 'One two. Three four five! Six seven'.split(' ')
  it('finds sentence boundaries', () => {
    expect(sentenceStart(words, 4)).toBe(2)
    expect(previousSentence(words, 4)).toBe(2)
    expect(previousSentence(words, 2)).toBe(0)
    expect(nextSentence(words, 0)).toBe(2)
    expect(nextSentence(words, 3)).toBe(5)
    expect(nextSentence(words, 6)).toBe(6)
  })
})

describe('isSentenceEnd', () => {
  it('recognises sentence endings, including inside quotes', () => {
    for (const w of ['end.', 'what?', 'no!', 'said.”', 'wait…', 'No.', 'etc.', 'I.']) expect(isSentenceEnd(w)).toBe(true)
  })

  it('does not treat titles, initials or abbreviations as endings', () => {
    for (const w of ['Mr.', 'Mrs.', '“Dr.', 'St.', 'e.g.', 'i.e.', 'U.S.', 'J.', 'vs.']) expect(isSentenceEnd(w)).toBe(false)
  })
})

describe('buildTimeline headings', () => {
  it('gives heading words a little extra time and still averages 1', () => {
    const words = 'Chapter One It was a dark night.'.split(' ')
    const plain = buildTimeline(words, [1, 6])
    const withHeading = buildTimeline(words, [1, 6], 'natural', [{ start: 0, end: 1 }])
    expect(withHeading.weights[0] / withHeading.weights[3]).toBeGreaterThan(plain.weights[0] / plain.weights[3])
    expect(withHeading.weights.reduce((a, b) => a + b, 0) / words.length).toBeCloseTo(1, 5)
  })
})

describe('countLetters', () => {
  it('matches the regex definition for all kinds of words', () => {
    const reference = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '').length
    const samples = ['hello', '“Hello,”', "don't", 'naïve', 'Ærø—', '42%', '…', '', 'déjà-vu!', '日本語', '𝔘𝔫𝔦', '(x)', 'Straße.']
    for (const w of samples) expect(countLetters(w), w).toBe(reference(w))
  })
})

describe('pauseFactor fast path', () => {
  it('gives the same pauses as the full checks', () => {
    for (const w of ['end.', 'Mr.', 'word', 'clause,', 'dash—', 'quote.”', 'why?', '42']) {
      const expected = isSentenceEnd(w) ? 1.2 : /[,;:—–]["'”’)\]]*$/.test(w) ? 0.5 : 0
      expect(pauseFactor(w, false), w).toBe(expected)
    }
  })
})

describe('buildTimeline extras', () => {
  it('gives extra time to marked words while keeping the average speed', () => {
    const words = 'one two three four five six seven eight'.split(' ')
    const extras = new Float32Array(words.length)
    extras[3] = 0.6
    const { weights } = buildTimeline(words, [], 'smart', [], extras)
    const mean = weights.reduce((a, b) => a + b, 0) / weights.length
    expect(mean).toBeCloseTo(1)
    expect(weights[3]).toBeGreaterThan(weights[2] + 0.4)
  })
})
