import { useEffect, useState } from 'react'

export interface ChapterOption {
  title: string
  end: number
  /** Reading time to get there, already formatted ("14 min"). */
  time: string
  current: boolean
}

interface Props {
  /** Where a session of `minutes` would end, in words ("ends in Chapter six"). */
  landsFor: (minutes: number) => string
  /** Chapter ends to read to; empty for books without chapters. */
  chapters: ChapterOption[]
  closing?: boolean
  onStartTime: (minutes: number) => void
  onStartChapter: (option: ChapterOption) => void
  onClose: () => void
}

const PRESETS = [5, 10, 15, 20, 30]
const MIN_MINUTES = 5
const MAX_MINUTES = 120
const STEP = 5
const LAST_KEY = 'chapter-session-minutes'

function lastMinutes(): number {
  try {
    const saved = Number(localStorage.getItem(LAST_KEY))
    return saved >= MIN_MINUTES && saved <= MAX_MINUTES ? saved : 10
  } catch {
    return 10
  }
}

/**
 * "Read for…": a length of time (one big number, nudged with − and +, or set
 * with a quick pick) or up to a chapter end. Both show where you'll stop.
 */
export function SessionMenu({ landsFor, chapters, closing, onStartTime, onStartChapter, onClose }: Props) {
  const [tab, setTab] = useState<'time' | 'chapter'>('time')
  const [minutes, setMinutes] = useState(lastMinutes)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const set = (m: number) => setMinutes(Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, m)))
  const start = () => {
    try {
      localStorage.setItem(LAST_KEY, String(minutes))
    } catch {
      // Not remembered; fine.
    }
    onStartTime(minutes)
  }
  const lands = landsFor(minutes)

  return (
    <>
      <div className={`popover-backdrop${closing ? ' is-closing' : ''}`} aria-hidden="true" onClick={onClose} />
      <div className={`popover opens-up session-menu${closing ? ' is-closing' : ''}`} role="dialog" aria-label="Read for">
        <p className="session-title">Read for</p>
        {chapters.length > 0 && (
          <div className="segmented" role="radiogroup" aria-label="Read for a time or to a chapter end">
            <button type="button" role="radio" aria-checked={tab === 'time'} onClick={() => setTab('time')}>
              Time
            </button>
            <button type="button" role="radio" aria-checked={tab === 'chapter'} onClick={() => setTab('chapter')}>
              Chapter
            </button>
          </div>
        )}

        {tab === 'time' ? (
          <div className="session-body">
            <div className="session-dial">
              <button
                type="button"
                className="session-nudge"
                onClick={() => set(minutes - STEP)}
                aria-label="5 minutes less"
                disabled={minutes <= MIN_MINUTES}
              >
                −
              </button>
              <p className="session-amount" aria-live="polite">
                <span className="session-number">{minutes}</span>
                <span className="session-unit">minutes</span>
              </p>
              <button
                type="button"
                className="session-nudge"
                onClick={() => set(minutes + STEP)}
                aria-label="5 minutes more"
                disabled={minutes >= MAX_MINUTES}
              >
                +
              </button>
            </div>
            <div className="session-presets" role="radiogroup" aria-label="Quick picks">
              {PRESETS.map((m) => (
                <button key={m} type="button" role="radio" aria-checked={minutes === m} onClick={() => set(m)}>
                  {m}
                </button>
              ))}
            </div>
            <p className="session-lands">
              {lands[0].toUpperCase() + lands.slice(1)}
              {lands.startsWith('ends') && ', at the end of a sentence'}
            </p>
            <button type="button" className="demo-button session-start" onClick={start}>
              Start reading
            </button>
          </div>
        ) : (
          <ul className="session-body session-chapters">
            {chapters.map((c) => (
              <li key={c.end}>
                <button type="button" className="session-chapter" onClick={() => onStartChapter(c)}>
                  <span className="session-chapter-name">
                    {c.current && <span className="session-now">This chapter</span>}
                    {c.title}
                  </span>
                  <span className="session-chapter-time">{c.time}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
