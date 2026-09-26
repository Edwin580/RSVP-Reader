import { describe, expect, it } from 'vitest'
import { buildTimeline } from '../rsvp'
import { planSession } from '../session'

// 100 plain words per "paragraph", sentences of 10 words.
const sentence = (n: number) => Array.from({ length: 10 }, (_, i) => `w${n}x${i}${i === 9 ? '.' : ''}`)
const words = Array.from({ length: 60 }, (_, n) => sentence(n)).flat()
const paragraphEnds = Array.from({ length: 6 }, (_, p) => p * 100 + 99)
const timeline = buildTimeline(words, [], 'even')
const wpm = 100 // 1 minute = 100 words when every word weighs 1

describe('planSession', () => {
  it('ends at a chapter end when one is close to the time', () => {
    const plan = planSession(timeline, words, paragraphEnds, [0, 210], 0, 2, wpm)
    expect(plan).toEqual({ end: 209, landing: 'chapter' })
  })

  it('otherwise ends at the nearest paragraph end', () => {
    const plan = planSession(timeline, words, paragraphEnds, [0], 0, 2, wpm)
    expect(plan).toEqual({ end: 199, landing: 'paragraph' })
  })

  it('otherwise finishes the sentence', () => {
    const plan = planSession(timeline, words, [], [0], 0, 2.35, wpm)
    expect(plan.landing).toBe('sentence')
    expect(words[plan.end].endsWith('.')).toBe(true)
    expect(plan.end).toBeGreaterThanOrEqual(234)
  })

  it('stops at the end of the book', () => {
    expect(planSession(timeline, words, paragraphEnds, [0], 500, 30, wpm)).toEqual({ end: 599, landing: 'book' })
  })
})
