import { describe, expect, it } from 'vitest'
import { isBookmarked, toggleBookmark } from '../bookmarks'

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
})
