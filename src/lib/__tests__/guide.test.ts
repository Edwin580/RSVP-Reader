import { describe, expect, it } from 'vitest'
import { edgeSpeed, EDGE_SPEED, focusRange, groupLines, guideReading, lineAt, lineOf, windowAround } from '../guide'

// Three lines of three words, 30px tall, 10px apart.
const laid = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ i, top: Math.floor(i / 3) * 40, height: 30 }))
const lines = groupLines(laid)

describe('guide', () => {
  it('groups laid-out words into lines', () => {
    expect(lines).toEqual([
      { top: 0, bottom: 30, start: 0 },
      { top: 40, bottom: 70, start: 3 },
      { top: 80, bottom: 110, start: 6 },
    ])
  })

  it('finds the line under the finger, or the nearest one', () => {
    expect(lineAt(lines, 15)).toBe(0)
    expect(lineAt(lines, 50)).toBe(1)
    expect(lineAt(lines, 74)).toBe(1) // in the gap, nearer the line above
    expect(lineAt(lines, 78)).toBe(2)
    expect(lineAt(lines, -50)).toBe(0)
    expect(lineAt(lines, 500)).toBe(2)
    expect(lineAt([], 10)).toBe(-1)
  })

  it('finds the line holding a word', () => {
    expect(lineOf(lines, 0)).toBe(0)
    expect(lineOf(lines, 4)).toBe(1)
    expect(lineOf(lines, 8)).toBe(2)
  })

  it('keeps one or three lines clear around the focused one', () => {
    expect(focusRange(10, 4, 1)).toEqual([4, 4])
    expect(focusRange(10, 4, 3)).toEqual([3, 5])
    expect(focusRange(10, 0, 3)).toEqual([0, 1])
    expect(focusRange(10, 9, 3)).toEqual([8, 9])
  })

  it('scrolls the text along only near the top and bottom, faster deeper in', () => {
    expect(edgeSpeed(500, 1000)).toBe(0)
    expect(edgeSpeed(1000, 1000)).toBe(EDGE_SPEED)
    expect(edgeSpeed(925, 1000)).toBeCloseTo(EDGE_SPEED / 2)
    expect(edgeSpeed(0, 1000)).toBe(-EDGE_SPEED)
    expect(edgeSpeed(100, 0)).toBe(0)
  })

  it('counts moving on as reading, but not time away, going back or jumping', () => {
    expect(guideReading(100, 110, 3000)).toEqual({ words: 10, ms: 3000 })
    // Ten words read slowly take ten seconds at most: the rest was time away.
    expect(guideReading(100, 110, 600000)).toEqual({ words: 10, ms: 10000 })
    expect(guideReading(110, 100, 3000)).toBeNull()
    expect(guideReading(100, 5000, 3000)).toBeNull()
  })

  it('lays out whole paragraphs around the reading position', () => {
    // Paragraphs of ten words: 0–9, 10–19, … 90–99.
    const ends = [9, 19, 29, 39, 49, 59, 69, 79, 89, 99]
    expect(windowAround(ends, 50, 15, 100)).toEqual({ from: 30, to: 69 })
    expect(windowAround(ends, 3, 15, 100)).toEqual({ from: 0, to: 19 })
    expect(windowAround(ends, 98, 15, 100)).toEqual({ from: 80, to: 99 })
    expect(windowAround(ends, 50, 1000, 100)).toEqual({ from: 0, to: 99 })
    expect(windowAround([], 5, 3, 10)).toEqual({ from: 0, to: 9 })
  })
})
