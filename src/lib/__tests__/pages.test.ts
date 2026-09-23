import { describe, expect, it } from 'vitest'
import { pageAnchor, paragraphStart, paragraphsBetween } from '../pages'

describe('paragraphStart', () => {
  const ends = [2, 5, 9]
  it('finds the first word of the paragraph containing an index', () => {
    expect(paragraphStart(ends, 0)).toBe(0)
    expect(paragraphStart(ends, 2)).toBe(0)
    expect(paragraphStart(ends, 3)).toBe(3)
    expect(paragraphStart(ends, 5)).toBe(3)
    expect(paragraphStart(ends, 7)).toBe(6)
    expect(paragraphStart(ends, 12)).toBe(10)
  })
})

describe('pageAnchor', () => {
  it('starts at the paragraph, or at the sentence in a long paragraph', () => {
    const words = 'One two. Three four.'.split(' ')
    expect(pageAnchor(words, [3], 3)).toBe(0)
    const long = Array.from({ length: 200 }, (_, i) => (i % 10 === 9 ? 'end.' : 'w'))
    expect(pageAnchor(long, [199], 150)).toBe(150)
    expect(pageAnchor(long, [199], 155)).toBe(150)
    expect(pageAnchor(long, [199], 60)).toBe(0)
  })
})

describe('paragraphsBetween', () => {
  it('groups a word range into paragraphs', () => {
    expect(paragraphsBetween(new Set([2, 5]), 1, 7)).toEqual([[1, 2], [3, 4, 5], [6, 7]])
  })
})
