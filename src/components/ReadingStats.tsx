import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatMinutes } from '../lib/rsvp'
import { calendarWeeks, readingLevel, summarize, type DayPoint, type ReadingStats as Stats } from '../lib/stats'
import { Icon } from './Icon'

/** Weeks shown in the calendar: a year, like GitHub (phones scroll back through it). */
const WEEKS = 53

/**
 * Reading stats kept out of the way: one quiet line under the library title
 * ("12 min today · 4-day streak") that opens a small card with the last year
 * as a calendar of squares, like a GitHub contribution graph, and the
 * numbers. Nothing shows until there's reading in the last week, and a
 * missed day never shows a zero or a broken streak, so it never nags.
 */
export function ReadingStats({ stats }: { stats: Stats }) {
  const [open, setOpen] = useState(false)
  const [today] = useState(() => new Date())
  const summary = useMemo(() => summarize(stats, today), [stats, today])
  const weeks = useMemo(() => calendarWeeks(stats, today, WEEKS), [stats, today])
  // The day whose numbers show under the calendar: today, or a tapped square.
  const [picked, setPicked] = useState<DayPoint | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // On narrow screens the calendar scrolls; start at this week, like GitHub.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [open])

  if (summary.weekMs === 0) return null

  const parts = [summary.todayMs > 0 ? `${minutes(summary.todayMs)} today` : `${minutes(summary.weekMs)} this week`]
  if (summary.streak >= 2) parts.push(`${summary.streak}-day streak`)
  const shown = picked ?? weeks[weeks.length - 1].find((d) => d && sameDay(d.date, today)) ?? null
  // A month's name over the first week that starts in it, if there's room before the next.
  const months: { column: number; name: string }[] = []
  weeks.forEach((w, column) => {
    const first = w[0]?.date
    if (!first || (column > 0 && first.getMonth() === weeks[column - 1][0]?.date.getMonth())) return
    if (months.length && column - months[months.length - 1].column < 3) months.pop()
    months.push({ column, name: first.toLocaleDateString(undefined, { month: 'short' }) })
  })

  return (
    <div className={`reading-stats${open ? ' is-open' : ''}`}>
      <button type="button" className="stats-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {parts.join(' · ')}
        <Icon name="forward" size={14} />
      </button>

      {open && (
        <div className="stats-card">
          <div className="stats-calendar" style={{ '--weeks': WEEKS } as React.CSSProperties}>
            <div className="stats-weekdays" aria-hidden="true">
              <span />
              <span>Mon</span>
              <span />
              <span>Wed</span>
              <span />
              <span>Fri</span>
              <span />
            </div>
            <div className="stats-scroll" ref={scroller}>
              <div className="stats-months" aria-hidden="true">
                {months.map((m) => (
                  <span key={m.column} style={{ gridColumn: m.column + 1 }}>
                    {m.name}
                  </span>
                ))}
              </div>
              <ol className="stats-grid" aria-label="Reading each day, the last year">
                {weeks.flatMap((week, w) =>
                  week.map((d, i) =>
                    d ? (
                      <li key={`${w}-${i}`}>
                        <button
                          type="button"
                          className={`stats-cell level-${readingLevel(d.ms)}${sameDay(d.date, today) ? ' is-today' : ''}`}
                          aria-label={describe(d)}
                          aria-pressed={!!shown && sameDay(d.date, shown.date)}
                          title={describe(d)}
                          onClick={() => setPicked(d)}
                        />
                      </li>
                    ) : (
                      <li key={`${w}-${i}`} aria-hidden="true" />
                    ),
                  ),
                )}
              </ol>
            </div>
          </div>
          <div className="stats-key">
            <p className="stats-picked" aria-live="polite">
              {shown && describe(shown)}
            </p>
            <span className="stats-legend" aria-hidden="true">
              Less
              {[0, 1, 2, 3, 4].map((level) => (
                <span key={level} className={`stats-cell level-${level}`} />
              ))}
              More
            </span>
          </div>
          <dl className="stats-figures">
            <div>
              <dt>Last 7 days</dt>
              <dd>{minutes(summary.weekMs)}</dd>
            </div>
            <div>
              <dt>Average speed</dt>
              <dd>{summary.weekWpm ? `${summary.weekWpm} wpm` : '—'}</dd>
            </div>
            <div>
              <dt>Streak</dt>
              <dd>{summary.streak ? `${summary.streak} ${summary.streak === 1 ? 'day' : 'days'}` : '—'}</dd>
            </div>
            <div>
              <dt>Words read</dt>
              <dd>{summary.totalWords.toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  )
}

const minutes = (ms: number) => formatMinutes(ms / 60000)
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
/** "Tue 30 Sep: 12 min, 3,400 words", or "no reading". */
const describe = (d: DayPoint) =>
  `${d.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${
    d.ms ? `${minutes(d.ms)}, ${d.words.toLocaleString()} words` : 'no reading'
  }`
