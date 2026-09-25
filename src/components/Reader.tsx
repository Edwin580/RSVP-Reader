import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRsvp } from '../hooks/useRsvp'
import { isBookmarked, toggleBookmark } from '../lib/bookmarks'
import { buildTimeline, formatMinutes, minutesBetween, nextSentence, previousSentence } from '../lib/rsvp'
import { BookSearch } from '../lib/searchClient'
import type { Settings } from '../lib/storage'
import type { Book, Bookmark } from '../lib/types'
import { BookmarksPanel } from './BookmarksPanel'
import { Icon } from './Icon'
import { PageView, type PageNav } from './PageView'
import { Scrubber } from './Scrubber'
import { SearchPanel } from './SearchPanel'
import { SettingsMenu } from './SettingsMenu'
import { reducedMotion } from './transition'
import { WordDisplay } from './WordDisplay'

interface Props {
  book: Book
  initialIndex: number
  settings: Settings
  onSettings: (settings: Settings) => void
  onProgress: (index: number) => void
  bookmarks: Bookmark[]
  onBookmarks: (bookmarks: Bookmark[]) => void
  onClose: () => void
}

const WPM_STEP = 25
const MIN_WPM = 100
const MAX_WPM = 1200
const CONTEXT_WORDS = 40
/** Controls fade out after this long without pointer or key activity while playing. */
const IDLE_MS = 2000
/** Extra time on the first word of a new page in page mode, covering the turn animation. */
const PAGE_TURN_MS = 450
/** Extra time on the first word of each line in page mode, as a fraction of a word. */
const LINE_RETURN = 0.3
/** Length of the panels' closing animation; keep in sync with index.css. */
const PANEL_CLOSE_MS = 200
/** Jumps further than this offer a "back" button, shown for JUMP_BACK_MS. */
const JUMP_BACK_MIN_WORDS = 50
const JUMP_BACK_MS = 8000

export function Reader({
  book,
  initialIndex,
  settings,
  onSettings,
  onProgress,
  bookmarks,
  onBookmarks,
  onClose,
}: Props) {
  const { words, chapters } = book
  const { wpm, textScale, wordTiming, mode, font } = settings
  const headings = useMemo(() => book.headings ?? [], [book.headings])
  const timeline = useMemo(
    () => buildTimeline(words, book.paragraphEnds, wordTiming, headings),
    [words, book.paragraphEnds, wordTiming, headings],
  )
  const headingWords = useMemo(() => {
    const set = new Set<number>()
    for (const h of headings) for (let i = h.start; i <= h.end; i++) set.add(i)
    return set
  }, [headings])
  const chapterStarts = useMemo(() => chapters.map((c) => c.start), [chapters])
  // Page mode gives the eye time to travel: the first word of a new page (the
  // word after the visible page's end) waits for the turn, and the first word
  // of each line gets a beat for the sweep back to the left margin.
  const pageEnd = useRef(-1)
  const lineStarts = useRef<Set<number>>(new Set())
  const pageDelay = useCallback(
    (i: number) => {
      if (mode !== 'page') return 0
      if (i === pageEnd.current + 1) return PAGE_TURN_MS
      return lineStarts.current.has(i) ? LINE_RETURN * (60000 / wpm) : 0
    },
    [mode, wpm],
  )
  const onPage = useCallback((_start: number, end: number, lines: Set<number>) => {
    pageEnd.current = end
    lineStarts.current = lines
  }, [])
  const pageNav = useRef<PageNav | null>(null)

  const { index, playing, toggle, pause, seek } = useRsvp(timeline.weights, wpm, initialIndex, pageDelay)

  // Big jumps (progress bar, chapter menu, search) offer a way back for a few
  // seconds, so an accidental jump never costs your place.
  const [jumpedFrom, setJumpedFrom] = useState<number | null>(null)
  const jumpTo = (i: number) => {
    if (Math.abs(i - index) > JUMP_BACK_MIN_WORDS) setJumpedFrom(index)
    seek(i)
  }
  useEffect(() => {
    if (jumpedFrom === null) return
    const timer = window.setTimeout(() => setJumpedFrom(null), JUMP_BACK_MS)
    return () => window.clearTimeout(timer)
  }, [jumpedFrom])
  const [panel, setPanel] = useState<'search' | 'settings' | 'bookmarks' | null>(null)
  // A closing panel stays mounted briefly so it can animate out.
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)
  const idle = useIdle(playing && !panel, IDLE_MS)
  const marked = isBookmarked(bookmarks, words, index)
  const toggleMark = () => onBookmarks(toggleBookmark(bookmarks, words, index))

  const closePanel = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    if (reducedMotion()) {
      setPanel(null)
      return
    }
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      setPanel(null)
      setClosing(false)
    }, PANEL_CLOSE_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const openPanel = (which: 'search' | 'settings' | 'bookmarks') => {
    pause()
    if (panel === which && !closing) {
      closePanel()
      return
    }
    window.clearTimeout(closeTimer.current)
    setClosing(false)
    setPanel(which)
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
      case 'b':
      case 'B':
        toggleMark()
        break
      case 'm':
      case 'M':
        onSettings({ ...settings, mode: mode === 'page' ? 'word' : 'page' })
        break
      case 'PageDown':
        pageNav.current?.next()
        break
      case 'PageUp':
        pageNav.current?.previous()
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
  const describePosition = (i: number) => {
    const pct = `${words.length > 1 ? Math.round((i / (words.length - 1)) * 100) : 100}%`
    if (!hasChapters) return pct
    let title = chapters[0].title
    for (const c of chapters) if (c.start <= i) title = c.title
    return `${pct} · ${title}`
  }

  const context = useMemo(() => {
    if (playing || mode === 'page') return null
    const start = Math.max(0, index - CONTEXT_WORDS)
    return words.slice(start, index + CONTEXT_WORDS).map((w, i) => ({ w, i: start + i }))
  }, [playing, index, words, mode])

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
              onChange={(e) => jumpTo(chapters[Number(e.target.value)].start)}
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
            className={`icon-button${marked ? ' is-marked' : ''}`}
            onClick={() => openPanel('bookmarks')}
            title="Bookmarks (B adds one here)"
            aria-label={marked ? 'Bookmarks (this spot is bookmarked)' : 'Bookmarks'}
          >
            <Icon name={marked ? 'bookmarkFilled' : 'bookmark'} size={21} />
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
            <SettingsMenu settings={settings} onSettings={onSettings} closing={closing} onClose={closePanel} />
          )}
        </div>
      </header>

      {mode === 'page' ? (
        <section className="stage stage-page">
          <PageView
            words={words}
            paragraphEnds={book.paragraphEnds}
            chapterStarts={chapterStarts}
            headings={headings}
            index={index}
            playing={playing}
            scale={textScale}
            font={font}
            wordMs={(60000 / wpm) * (timeline.weights[index] ?? 1)}
            lineReturnMs={LINE_RETURN * (60000 / wpm)}
            turnMs={PAGE_TURN_MS}
            onSeek={seek}
            onToggle={toggle}
            onPage={onPage}
            navRef={pageNav}
          />
        </section>
      ) : (
        <section className="stage">
          <WordDisplay
            word={words[index] ?? ''}
            scale={textScale}
            heading={headingWords.has(index)}
            font={font}
            onClick={toggle}
          />
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
      )}

      <footer className="reader-bottom chrome">
        {jumpedFrom !== null && (
          <button
            type="button"
            className="jump-back"
            onClick={() => {
              seek(jumpedFrom)
              setJumpedFrom(null)
            }}
          >
            <Icon name="chevronLeft" size={16} />
            <span>Back to {describePosition(jumpedFrom)}</span>
          </button>
        )}
        <Scrubber value={index} max={Math.max(words.length - 1, 0)} onSeek={jumpTo} describe={describePosition} />

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

      {panel === 'bookmarks' && (
        <BookmarksPanel
          bookmarks={bookmarks}
          words={words}
          chapters={chapters}
          here={marked}
          onToggleHere={toggleMark}
          closing={closing}
          onSelect={(i) => {
            jumpTo(i)
            closePanel()
          }}
          onRemove={(i) => onBookmarks(bookmarks.filter((b) => b.index !== i))}
          onClose={closePanel}
        />
      )}

      {panel === 'search' && bookSearch && (
        <SearchPanel
          bookSearch={bookSearch}
          words={words}
          chapters={chapters}
          closing={closing}
          onSelect={(i) => {
            jumpTo(i)
            closePanel()
          }}
          onClose={closePanel}
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
