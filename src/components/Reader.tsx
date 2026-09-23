import { useEffect, useMemo, useRef, useState } from 'react'
import { useRsvp } from '../hooks/useRsvp'
import { buildTimeline, formatMinutes, minutesBetween, nextSentence, previousSentence } from '../lib/rsvp'
import { BookSearch } from '../lib/searchClient'
import type { Settings } from '../lib/storage'
import type { Book } from '../lib/types'
import { Icon } from './Icon'
import { SearchPanel } from './SearchPanel'
import { SettingsMenu } from './SettingsMenu'
import { WordDisplay } from './WordDisplay'

interface Props {
  book: Book
  initialIndex: number
  settings: Settings
  onSettings: (settings: Settings) => void
  onProgress: (index: number) => void
  onClose: () => void
}

const WPM_STEP = 25
const MIN_WPM = 100
const MAX_WPM = 1200
const CONTEXT_WORDS = 40
/** Controls fade out after this long without pointer or key activity while playing. */
const IDLE_MS = 2000

export function Reader({ book, initialIndex, settings, onSettings, onProgress, onClose }: Props) {
  const { words, chapters } = book
  const { wpm, textScale, wordTiming } = settings
  const timeline = useMemo(
    () => buildTimeline(words, book.paragraphEnds, wordTiming),
    [words, book.paragraphEnds, wordTiming],
  )
  const { index, playing, toggle, pause, seek } = useRsvp(timeline.weights, wpm, initialIndex)
  const [panel, setPanel] = useState<'search' | 'settings' | null>(null)
  const idle = useIdle(playing && !panel, IDLE_MS)

  const openPanel = (which: 'search' | 'settings') => {
    pause()
    setPanel((p) => (p === which ? null : which))
  }

  // Start indexing in the background as soon as the book opens.
  const [bookSearch, setBookSearch] = useState<BookSearch | null>(null)
  useEffect(() => {
    const s = new BookSearch(book.id, words)
    setBookSearch(s)
    return () => s.dispose()
  }, [book.id, words])

  // Persist progress: whenever paused, and periodically while playing.
  const lastSaved = useRef(index)
  useEffect(() => {
    if (!playing || Math.abs(index - lastSaved.current) >= 50) {
      lastSaved.current = index
      onProgress(index)
    }
  }, [index, playing, onProgress])
  const current = useRef(index)
  useEffect(() => {
    current.current = index
  }, [index])
  useEffect(() => () => onProgress(current.current), [onProgress])

  const setWpm = (next: number) => onSettings({ ...settings, wpm: Math.max(MIN_WPM, Math.min(MAX_WPM, next)) })

  // Keep the key handler reading the latest state without re-binding every word.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  const onKey = (e: KeyboardEvent) => {
    if (panel) return
    if ((e.key === 'f' && (e.ctrlKey || e.metaKey)) || e.key === '/') {
      e.preventDefault()
      openPanel('search')
      return
    }
    const t = e.target
    if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && e.key.startsWith('Arrow'))) return
    switch (e.key) {
      case ' ':
      case 'k':
        toggle()
        break
      case 'ArrowLeft':
        seek(e.shiftKey || e.ctrlKey || e.metaKey ? previousSentence(words, index) : index - 1)
        break
      case 'ArrowRight':
        seek(e.shiftKey || e.ctrlKey || e.metaKey ? nextSentence(words, index) : index + 1)
        break
      case 'ArrowUp':
        setWpm(wpm + WPM_STEP)
        break
      case 'ArrowDown':
        setWpm(wpm - WPM_STEP)
        break
      case 'Escape':
        pause()
        onClose()
        break
      default:
        return
    }
    e.preventDefault()
  }
  useEffect(() => {
    keys.current = onKey
  })
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const chapterIndex = useMemo(() => {
    let c = 0
    for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= index) c = i
    return c
  }, [chapters, index])
  const chapterEnd = chapters[chapterIndex + 1]?.start ?? words.length

  const percent = words.length > 1 ? Math.round((index / (words.length - 1)) * 100) : 100
  const bookLeft = formatMinutes(minutesBetween(timeline, index, words.length, wpm))
  const chapterLeft = formatMinutes(minutesBetween(timeline, index, chapterEnd, wpm))
  const hasChapters = chapters.length > 1

  const context = useMemo(() => {
    if (playing) return null
    const start = Math.max(0, index - CONTEXT_WORDS)
    return words.slice(start, index + CONTEXT_WORDS).map((w, i) => ({ w, i: start + i }))
  }, [playing, index, words])

  return (
    <main className={`reader${playing ? ' is-playing' : ''}${idle ? ' is-idle' : ''}`}>
      <header className="reader-top chrome">
        <button type="button" className="nav-button" onClick={onClose}>
          <Icon name="chevronLeft" size={22} />
          <span className="nav-label">Library</span>
        </button>

        <div className="running-head">
          <span className="running-title" title={book.title}>
            {book.title}
          </span>
          {hasChapters && (
            <select
              className="chapter-select"
              value={chapterIndex}
              onChange={(e) => seek(chapters[Number(e.target.value)].start)}
              aria-label="Jump to chapter"
            >
              {chapters.map((c, i) => (
                <option key={i} value={i}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="top-actions">
          <button type="button" className="icon-button" onClick={() => openPanel('search')} title="Search (/)" aria-label="Search">
            <Icon name="search" size={21} />
          </button>
          <button
            type="button"
            className="icon-button aa"
            onClick={() => openPanel('settings')}
            aria-label="Reading settings"
            aria-expanded={panel === 'settings'}
          >
            Aa
          </button>
          {panel === 'settings' && (
            <SettingsMenu settings={settings} onSettings={onSettings} onClose={() => setPanel(null)} />
          )}
        </div>
      </header>

      <section className="stage">
        <WordDisplay word={words[index] ?? ''} scale={textScale} onClick={toggle} />
        <div className="context" aria-hidden={playing}>
          {context && (
            <p>
              {context.map(({ w, i }) => (
                <span key={i} className={i === index ? 'current' : undefined} onClick={() => seek(i)}>
                  {w}{' '}
                </span>
              ))}
            </p>
          )}
        </div>
      </section>

      <footer className="reader-bottom chrome">
        <input
          type="range"
          className="scrubber"
          min={0}
          max={Math.max(words.length - 1, 0)}
          value={index}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Position in book"
          style={{ '--progress': `${percent}%` } as React.CSSProperties}
        />

        <div className="deck">
          <p className="deck-meta muted">
            {hasChapters && <span>{chapterLeft} left in chapter</span>}
            <span>
              {bookLeft} left{hasChapters && ' in book'} · {percent}%
            </span>
          </p>

          <div className="transport">
            <button type="button" className="icon-button" title="Previous sentence (Shift+←)" aria-label="Previous sentence" onClick={() => seek(previousSentence(words, index))}>
              <Icon name="sentenceBack" />
            </button>
            <button type="button" className="icon-button" title="Back one word (←)" aria-label="Back one word" onClick={() => seek(index - 1)}>
              <Icon name="back" />
            </button>
            <button type="button" className="play-button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
              <Icon name={playing ? 'pause' : 'play'} size={22} />
            </button>
            <button type="button" className="icon-button" title="Forward one word (→)" aria-label="Forward one word" onClick={() => seek(index + 1)}>
              <Icon name="forward" />
            </button>
            <button type="button" className="icon-button" title="Next sentence (Shift+→)" aria-label="Next sentence" onClick={() => seek(nextSentence(words, index))}>
              <Icon name="sentenceForward" />
            </button>
          </div>

          <div className="speed" role="group" aria-label="Reading speed">
            <button type="button" className="icon-button" onClick={() => setWpm(wpm - WPM_STEP)} aria-label="Slower" title="Slower (↓)">
              −
            </button>
            <span className="speed-value">
              {wpm}
              <span className="muted"> wpm</span>
            </span>
            <button type="button" className="icon-button" onClick={() => setWpm(wpm + WPM_STEP)} aria-label="Faster" title="Faster (↑)">
              +
            </button>
          </div>
        </div>
      </footer>

      {panel === 'search' && bookSearch && (
        <SearchPanel
          bookSearch={bookSearch}
          words={words}
          chapters={chapters}
          onSelect={(i) => {
            seek(i)
            setPanel(null)
          }}
          onClose={() => setPanel(null)}
        />
      )}
    </main>
  )
}

/** True after `ms` without pointer/keyboard activity, while `active`. */
function useIdle(active: boolean, ms: number): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (!active) return
    let timer = window.setTimeout(() => setIdle(true), ms)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), ms)
    }
    const events = ['pointermove', 'pointerdown', 'keydown'] as const
    events.forEach((e) => window.addEventListener(e, wake))
    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, wake))
      setIdle(false)
    }
  }, [active, ms])
  return idle
}
