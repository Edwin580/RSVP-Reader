import { useMemo, useState } from 'react'
import { formatMinutes } from '../lib/rsvp'
import { lastDays, summarize, type ReadingStats as Stats } from '../lib/stats'
import { Icon } from './Icon'

/**
 * Reading stats kept out of the way: one quiet line under the library title
 * ("12 min today · 4-day streak") that opens a small card with the week and
 * the numbers. Nothing shows until there's reading in the last week, and a
 * missed day never shows a zero or a broken streak, so it never nags.
 */
export function ReadingStats({ stats }: { stats: Stats }) {
  const [open, setOpen] = useState(false)
  const [today] = useState(() => new Date())
  const summary = useMemo(() => summarize(stats, today), [stats, today])
  const week = useMemo(() => lastDays(stats, today), [stats, today])

  if (summary.weekMs === 0) return null

  const parts = [summary.todayMs > 0 ? `${minutes(summary.todayMs)} today` : `${minutes(summary.weekMs)} this week`]
  if (summary.streak >= 2) parts.push(`${summary.streak}-day streak`)
  const most = Math.max(...week.map((d) => d.ms))

  return (
    <div className={`reading-stats${open ? ' is-open' : ''}`}>
      <button type="button" className="stats-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {parts.join(' · ')}
        <Icon name="forward" size={14} />
      </button>

      {open && (
        <div className="stats-card">
          <ol className="stats-week" aria-label="Minutes read each day this week">
            {week.map((d, i) => (
              <li key={i} className={i === week.length - 1 ? 'is-today' : undefined}>
                <span className="stats-bar-track" title={`${weekday(d.date, 'long')}: ${d.ms ? minutes(d.ms) : 'no reading'}`}>
                  <span
                    className={`stats-bar${d.ms ? '' : ' is-empty'}`}
                    style={{ height: d.ms ? `${Math.max(8, (d.ms / most) * 100)}%` : undefined }}
                  />
                </span>
                <span className="stats-day" aria-hidden="true">
                  {weekday(d.date, 'narrow')}
                </span>
                <span className="visually-hidden">
                  {weekday(d.date, 'long')}: {d.ms ? minutes(d.ms) : 'no reading'}
                </span>
              </li>
            ))}
          </ol>
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
const weekday = (date: Date, style: 'narrow' | 'long') => date.toLocaleDateString(undefined, { weekday: style })
