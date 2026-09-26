import { describe, expect, it } from 'vitest'
import { classifyGesture, glanceRange } from '../glance'

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
