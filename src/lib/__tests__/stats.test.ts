import { describe, expect, it } from 'vitest'
import { addReading, dayKey, EMPTY_STATS, lastDays, summarize } from '../stats'

const day = (d: number) => new Date(2026, 8, d, 12) // September 2026, local noon
const MIN = 60_000

describe('reading stats', () => {
  it('adds reading to the local day', () => {
    let s = addReading(EMPTY_STATS, day(3), 2 * MIN, 600)
    s = addReading(s, day(3), MIN, 300)
    expect(s.days[dayKey(day(3))]).toEqual({ ms: 3 * MIN, words: 900 })
  })

  it('summarizes today, the last 7 days and average speed', () => {
    let s = addReading(EMPTY_STATS, day(10), 10 * MIN, 3000)
    s = addReading(s, day(8), 20 * MIN, 5000)
    s = addReading(s, day(1), 60 * MIN, 99999) // more than a week ago
    const sum = summarize(s, day(10))
    expect(sum.todayMs).toBe(10 * MIN)
    expect(sum.weekMs).toBe(30 * MIN)
    expect(sum.weekWords).toBe(8000)
    expect(sum.weekWpm).toBe(267)
    expect(sum.totalWords).toBe(8000 + 99999)
  })

  it('counts a streak of days with at least a minute of reading', () => {
    let s = EMPTY_STATS
    for (const d of [5, 6, 7, 8]) s = addReading(s, day(d), 5 * MIN, 1000)
    s = addReading(s, day(3), 5 * MIN, 1000) // gap on the 4th
    expect(summarize(s, day(8)).streak).toBe(4)
    // Nothing yet today: the streak up to yesterday still stands.
    expect(summarize(s, day(9)).streak).toBe(4)
    // A missed day breaks it.
    expect(summarize(s, day(10)).streak).toBe(0)
    // A few seconds doesn't count.
    expect(summarize(addReading(s, day(9), 10_000, 50), day(9)).streak).toBe(4)
  })

  it('has no average speed with too little reading', () => {
    expect(summarize(addReading(EMPTY_STATS, day(2), 20_000, 100), day(2)).weekWpm).toBeNull()
  })
})

describe('lastDays', () => {
  it('lists the last 7 days oldest first, filling days without reading', () => {
    const s = addReading(addReading(EMPTY_STATS, day(10), 5 * MIN, 900), day(8), MIN, 200)
    const days = lastDays(s, day(10))
    expect(days).toHaveLength(7)
    expect(days.map((d) => d.date.getDate())).toEqual([4, 5, 6, 7, 8, 9, 10])
    expect(days.map((d) => d.words)).toEqual([0, 0, 0, 0, 200, 0, 900])
  })
})
