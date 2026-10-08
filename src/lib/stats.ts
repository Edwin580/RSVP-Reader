/**
 * Reading statistics: time spent playing and words read, per local day.
 * Only time with the words actually moving counts, so pauses don't inflate it.
 */
export interface DayStats {
  /** Milliseconds spent reading (playing). */
  ms: number
  words: number
}

export interface ReadingStats {
  days: Record<string, DayStats>
}

export const EMPTY_STATS: ReadingStats = { days: {} }

/** A day counts towards the streak after this much reading. */
const STREAK_MIN_MS = 60_000

/** Local calendar date as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addReading(stats: ReadingStats, date: Date, ms: number, words: number): ReadingStats {
  if (ms <= 0 && words <= 0) return stats
  const key = dayKey(date)
  const day = stats.days[key] ?? { ms: 0, words: 0 }
  return { days: { ...stats.days, [key]: { ms: day.ms + Math.max(0, ms), words: day.words + Math.max(0, words) } } }
}

export interface StatsSummary {
  todayMs: number
  weekMs: number
  weekWords: number
  /** Average words per minute over the last 7 days, or null with too little reading to tell. */
  weekWpm: number | null
  /** Consecutive days with at least a minute of reading, up to today (or yesterday, if today hasn't started yet). */
  streak: number
  /** All time. */
  totalMs: number
  totalWords: number
}

export function summarize(stats: ReadingStats, today: Date): StatsSummary {
  const day = (offset: number) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
    return stats.days[dayKey(d)]
  }
  let weekMs = 0
  let weekWords = 0
  for (let i = 0; i < 7; i++) {
    weekMs += day(i)?.ms ?? 0
    weekWords += day(i)?.words ?? 0
  }
  const counts = (offset: number) => (day(offset)?.ms ?? 0) >= STREAK_MIN_MS
  let streak = 0
  for (let i = counts(0) ? 0 : 1; counts(i); i++) streak++
  let totalMs = 0
  let totalWords = 0
  for (const d of Object.values(stats.days)) {
    totalMs += d.ms
    totalWords += d.words
  }
  return {
    todayMs: day(0)?.ms ?? 0,
    weekMs,
    weekWords,
    weekWpm: weekMs >= STREAK_MIN_MS ? Math.round(weekWords / (weekMs / 60000)) : null,
    streak,
    totalMs,
    totalWords,
  }
}

export interface DayPoint {
  date: Date
  ms: number
  words: number
}

/** The last `count` days up to and including `today`, oldest first, with no gaps. */
export function lastDays(stats: ReadingStats, today: Date, count = 7): DayPoint[] {
  const days: DayPoint[] = []
  for (let offset = count - 1; offset >= 0; offset--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
    const day = stats.days[dayKey(date)]
    days.push({ date, ms: day?.ms ?? 0, words: day?.words ?? 0 })
  }
  return days
}

/** Minutes a day needs for each shade in the calendar: some, 10, 20 and 40 minutes. */
const LEVELS_MS = [1, 10 * 60_000, 20 * 60_000, 40 * 60_000]

/** How dark a day's square is, 0 (no reading) to 4. Fixed steps, so a shade means the same every week. */
export function readingLevel(ms: number): 0 | 1 | 2 | 3 | 4 {
  let level = 0
  for (const min of LEVELS_MS) if (ms >= min) level++
  return level as 0 | 1 | 2 | 3 | 4
}

/**
 * The last `weeks` weeks as calendar columns, like a GitHub contribution
 * graph: each week runs Sunday to Saturday, oldest first, and ends with the
 * week containing `today`. Days after today are null.
 */
export function calendarWeeks(stats: ReadingStats, today: Date, weeks = 26): (DayPoint | null)[][] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const firstSunday = new Date(end.getFullYear(), end.getMonth(), end.getDate() - end.getDay() - (weeks - 1) * 7)
  const columns: (DayPoint | null)[][] = []
  for (let w = 0; w < weeks; w++) {
    const column: (DayPoint | null)[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(firstSunday.getFullYear(), firstSunday.getMonth(), firstSunday.getDate() + w * 7 + d)
      if (date > end) {
        column.push(null)
        continue
      }
      const day = stats.days[dayKey(date)]
      column.push({ date, ms: day?.ms ?? 0, words: day?.words ?? 0 })
    }
    columns.push(column)
  }
  return columns
}
