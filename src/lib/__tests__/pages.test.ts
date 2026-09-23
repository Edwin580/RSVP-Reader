import { describe, expect, it } from 'vitest'
import { nextChapterStart, pageAnchor, pageBreak, paragraphStart, paragraphsBetween } from '../pages'

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

describe('pageBreak', () => {
  // Three lines of four words each; boundaries marked by index.
  const fits = Array.from({ length: 12 }, (_, i) => ({ index: 100 + i, top: Math.floor(i / 4) * 30 }))

  it('ends at the last sentence boundary within the final two lines', () => {
    expect(pageBreak(fits, (i) => i === 105 || i === 109)).toBe(109)
    expect(pageBreak(fits, (i) => i === 105)).toBe(105)
  })

  it('ignores boundaries further up the page', () => {
    expect(pageBreak(fits, (i) => i === 102)).toBe(111)
  })

  it('uses every fitting word when there is no boundary or it is already at one', () => {
    expect(pageBreak(fits, () => false)).toBe(111)
    expect(pageBreak(fits, (i) => i === 111 || i === 109)).toBe(111)
    expect(pageBreak([], () => true)).toBe(-1)
  })
})

describe('nextChapterStart', () => {
  it('finds the next chapter boundary after an index', () => {
    const starts = [0, 50, 120]
    expect(nextChapterStart(starts, 0, 999)).toBe(50)
    expect(nextChapterStart(starts, 49, 999)).toBe(50)
    expect(nextChapterStart(starts, 50, 999)).toBe(120)
    expect(nextChapterStart(starts, 130, 999)).toBe(999)
    expect(nextChapterStart([], 5, 999)).toBe(999)
  })
})
