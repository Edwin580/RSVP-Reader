import { describe, expect, it } from 'vitest'
import { recapRange, shouldRecap, timeAgo } from '../recap'

const words = ('Filler words here. '.repeat(12) + 'One two. Three four five. Six seven. Eight nine').split(' ')
const at = words.indexOf('Eight')

describe('recapRange', () => {
  it('covers the last three sentences before the reading position', () => {
    const { start, end } = recapRange(words, at)
    expect(words.slice(start, end + 1).join(' ')).toBe('One two. Three four five. Six seven.')
  })

  it('has nothing to recap near the start of a book', () => {
    const { start, end } = recapRange(words, 5)
    expect(end).toBeLessThan(start)
  })
})

describe('shouldRecap', () => {
  const now = Date.UTC(2026, 8, 26, 12)
  it('recaps after a few hours away, not after a short break', () => {
    expect(shouldRecap(now - 5 * 3_600_000, 100, now)).toBe(true)
    expect(shouldRecap(now - 20 * 60_000, 100, now)).toBe(false)
    expect(shouldRecap(undefined, 100, now)).toBe(false)
    expect(shouldRecap(now - 5 * 3_600_000, 3, now)).toBe(false)
  })
})

describe('timeAgo', () => {
  const now = Date.UTC(2026, 8, 26, 12)
  it('reads naturally', () => {
    expect(timeAgo(now - 5 * 3_600_000, now)).toBe('5 hours ago')
    expect(timeAgo(now - 30 * 3_600_000, now)).toBe('yesterday')
    expect(timeAgo(now - 4 * 86_400_000, now)).toBe('4 days ago')
    expect(timeAgo(now - 21 * 86_400_000, now)).toBe('3 weeks ago')
    expect(timeAgo(now - 90 * 86_400_000, now)).toBe('3 months ago')
  })
})
