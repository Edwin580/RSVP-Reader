import { describe, expect, it } from 'vitest'
import { delayMultiplier, nextSentence, orpIndex, previousSentence, sentenceStart, splitAtOrp } from '../rsvp'

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

describe('delayMultiplier', () => {
  it('pauses longer on punctuation and paragraph ends', () => {
    const plain = delayMultiplier('word', false)
    const comma = delayMultiplier('word,', false)
    const period = delayMultiplier('word.', false)
    const quotedPeriod = delayMultiplier('word."', false)
    const paragraph = delayMultiplier('word.', true)
    expect(plain).toBe(1)
    expect(comma).toBeGreaterThan(plain)
    expect(period).toBeGreaterThan(comma)
    expect(quotedPeriod).toBe(period)
    expect(paragraph).toBeGreaterThan(period)
  })

  it('gives long words more time, capped', () => {
    expect(delayMultiplier('extraordinarily', false)).toBeGreaterThan(1)
    expect(delayMultiplier('a'.repeat(60), false)).toBeCloseTo(1.6)
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
