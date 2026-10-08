import { describe, expect, it } from 'vitest'
import { draggedLine, focusRange, groupLines, guideReading, lineAt, lineOf, lineSpacing, windowAround } from '../guide'

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

  it('measures the distance from line to line', () => {
    expect(lineSpacing(lines)).toBe(40)
    expect(lineSpacing(lines.slice(0, 1))).toBe(0)
  })

  it('moves the focus a line for every line’s height dragged, from wherever the drag began', () => {
    expect(draggedLine(5, 0, 40)).toBe(5)
    expect(draggedLine(5, 19, 40)).toBe(5)
    expect(draggedLine(5, 21, 40)).toBe(6)
    expect(draggedLine(5, 120, 40)).toBe(8)
    expect(draggedLine(5, -80, 40)).toBe(3)
    expect(draggedLine(5, 300, 0)).toBe(5)
  })

  it('counts moving on as reading, but not time away, going back or jumping', () => {
    expect(guideReading(100, 110, 3000)).toEqual({ words: 10, ms: 3000 })
    // Ten words read slowly take ten seconds at most: the rest was time away.
    expect(guideReading(100, 110, 600000)).toEqual({ words: 10, ms: 10000 })
    expect(guideReading(110, 100, 3000)).toBeNull()
    expect(guideReading(100, 5000, 3000)).toBeNull()
    // Flicking through: 300 words in two seconds is faster than anyone reads.
    expect(guideReading(0, 300, 2000, 2000)).toBeNull()
    // Turning a page yourself: a whole page counts, read at your own speed.
    expect(guideReading(0, 300, 60000, 2000)).toEqual({ words: 300, ms: 60000 })
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
