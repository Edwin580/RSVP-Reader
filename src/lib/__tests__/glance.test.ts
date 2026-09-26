import { describe, expect, it } from 'vitest'
import { classifyGesture, glanceRange, pausedRange } from '../glance'

const words = 'It was late. The rabbit ran by. Alice followed it down the hole.'.split(' ')

describe('glanceRange', () => {
  it('covers the previous sentence and the current one', () => {
    // "followed" (index 8): previous sentence "The rabbit ran by." through "hole."
    expect(glanceRange(words, 8)).toEqual({ start: 3, end: 12 })
  })

  it('starts at the book start in the first sentence', () => {
    expect(glanceRange(words, 1)).toEqual({ start: 0, end: 2 })
  })

  it('handles an empty book', () => {
    expect(glanceRange([], 0)).toEqual({ start: 0, end: -1 })
  })
})

describe('classifyGesture', () => {
  it('tells taps, holds and swipes apart', () => {
    expect(classifyGesture(2, 3, 120)).toBe('tap')
    expect(classifyGesture(2, 3, 400)).toBe('hold')
    expect(classifyGesture(-80, 10, 200)).toBe('swipe-left')
    expect(classifyGesture(80, -10, 200)).toBe('swipe-right')
  })

  it('ignores mostly vertical drags and small wobbles past the tap tolerance', () => {
    expect(classifyGesture(45, 60, 200)).toBe('none')
    expect(classifyGesture(20, 0, 100)).toBe('none')
  })
})

describe('pausedRange', () => {
  const words = 'One two three. Four five six seven. Eight nine ten eleven. Twelve.'.split(' ')

  it('widens to whole sentences', () => {
    // "six" ± 2 is "Four … Eight": it ends at "seven." rather than mid-sentence.
    expect(pausedRange(words, 5, 2)).toEqual({ start: 3, end: 6 })
    // "nine" ± 2 is "seven. … eleven.": it starts at "Eight", not on the end of the last sentence.
    expect(pausedRange(words, 8, 2)).toEqual({ start: 7, end: 10 })
  })

  it('stops at the ends of the book', () => {
    expect(pausedRange(words, 0, 2)).toEqual({ start: 0, end: 2 })
    expect(pausedRange(words, 11, 5)).toEqual({ start: 3, end: 11 })
  })

  it('cuts a sentence that is too long to fit', () => {
    const long = Array.from({ length: 50 }, (_, i) => `w${i}`)
    expect(pausedRange(long, 25, 5)).toEqual({ start: 20, end: 30 })
  })
})
