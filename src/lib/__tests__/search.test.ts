import { describe, expect, it } from 'vitest'
import { buildSearchIndex, search } from '../search'

const words = '“It was a bright cold day in April, and the clocks — were striking thirteen.” Café cold day.'.split(' ')
const index = buildSearchIndex(words)

describe('search', () => {
  it('matches phrases ignoring case and punctuation', () => {
    expect(search(index, 'cold day in april').matches).toEqual([{ start: 4, end: 7 }])
    expect(search(index, '  It   WAS ').matches).toEqual([{ start: 0, end: 1 }])
  })

  it('skips punctuation-only tokens between words', () => {
    expect(search(index, 'clocks were').matches).toEqual([{ start: 10, end: 12 }])
  })

  it('ignores accents', () => {
    expect(search(index, 'cafe').matches).toEqual([{ start: 15, end: 15 }])
  })

  it('finds every occurrence, including partial words, up to the limit', () => {
    expect(search(index, 'cold day').matches.map((m) => m.start)).toEqual([4, 16])
    expect(search(index, 'thir').matches).toEqual([{ start: 14, end: 14 }])
    expect(search(index, 'cold', 1)).toEqual({ matches: [{ start: 4, end: 4 }], total: 2 })
  })

  it('returns nothing for empty or missing queries', () => {
    expect(search(index, '  ,, ').matches).toEqual([])
    expect(search(index, 'zebra').matches).toEqual([])
  })
})
