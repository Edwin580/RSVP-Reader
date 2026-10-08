import { describe, expect, it } from 'vitest'
import { addHighlight, isBookmarked, isHighlighted, toggleBookmark } from '../bookmarks'

const words = 'It was late. The rabbit ran by. Alice followed it.'.split(' ')

describe('bookmarks', () => {
  it('bookmarks the start of the current sentence', () => {
    const marks = toggleBookmark([], words, 5, 1) // "ran"
    expect(marks).toEqual([{ index: 3, createdAt: 1 }]) // "The"
    expect(isBookmarked(marks, words, 4)).toBe(true)
    expect(isBookmarked(marks, words, 8)).toBe(false)
  })

  it('removes the bookmark when toggled again anywhere in that sentence', () => {
    const marks = toggleBookmark([], words, 3, 1)
    expect(toggleBookmark(marks, words, 6)).toEqual([])
  })

  it('keeps bookmarks in reading order', () => {
    let marks = toggleBookmark([], words, 8, 1)
    marks = toggleBookmark(marks, words, 0, 2)
    marks = toggleBookmark(marks, words, 4, 3)
    expect(marks.map((b) => b.index)).toEqual([0, 3, 7])
  })

  it('saves highlights in reading order, once each', () => {
    let marks = toggleBookmark([], words, 0, 1) // "It was late."
    marks = addHighlight(marks, 4, 6, 2) // "rabbit ran by."
    marks = addHighlight(marks, 0, 1, 3) // "It was"
    expect(marks).toEqual([
      { index: 0, createdAt: 1 },
      { index: 0, end: 1, createdAt: 3 },
      { index: 4, end: 6, createdAt: 2 },
    ])
    expect(addHighlight(marks, 4, 6, 9)).toBe(marks)
    expect(isHighlighted(marks, 5)).toBe(true)
    expect(isHighlighted(marks, 2)).toBe(false)
  })

  it('keeps highlights apart from the sentence bookmark', () => {
    // A highlight from the start of a sentence isn't a bookmark there, and
    // toggling the bookmark leaves it alone.
    const marks = addHighlight([], 3, 5, 1) // "The rabbit ran"
    expect(isBookmarked(marks, words, 4)).toBe(false)
    const both = toggleBookmark(marks, words, 4, 2)
    expect(both).toHaveLength(2)
    expect(toggleBookmark(both, words, 4)).toEqual(marks)
  })
})
