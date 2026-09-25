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
  let totalWords = 0
  for (const d of Object.values(stats.days)) totalWords += d.words
  return {
    todayMs: day(0)?.ms ?? 0,
    weekMs,
    weekWords,
    weekWpm: weekMs >= STREAK_MIN_MS ? Math.round(weekWords / (weekMs / 60000)) : null,
    streak,
    totalWords,
  }
}
