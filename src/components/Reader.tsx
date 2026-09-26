import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePressGestures } from '../hooks/usePressGestures'
import { useRsvp } from '../hooks/useRsvp'
import { glanceRange } from '../lib/glance'
import { recapRange, shouldRecap, timeAgo } from '../lib/recap'
import { chapterTargets, planSession, type Landing } from '../lib/session'
import type { BookAnalysis } from '../lib/analysis'
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
import { SessionMenu } from './SessionMenu'
import { SettingsMenu } from './SettingsMenu'
import { reducedMotion } from './transition'
import { WordDisplay } from './WordDisplay'

interface Props {
  book: Book
  initialIndex: number
  /** When the book was last read; a long gap shows a "Previously…" recap. */
  lastReadAt?: number
  settings: Settings
  onSettings: (settings: Settings) => void
  onProgress: (index: number) => void
  bookmarks: Bookmark[]
  onBookmarks: (bookmarks: Bookmark[]) => void
  /** Reports reading time (while playing) and words read, for statistics. */
  onReadingTime: (ms: number, words: number) => void
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
  lastReadAt,
  settings,
  onSettings,
  onProgress,
  bookmarks,
  onBookmarks,
  onReadingTime,
  onClose,
}: Props) {
  const { words, chapters } = book
  const { wpm, textScale, wordTiming, mode, font } = settings
  const headings = useMemo(() => book.headings ?? [], [book.headings])
  // People, places and smart-pacing extras, worked out in the background by
  // the search worker. Until they arrive, smart pacing times words naturally.
  const [analysis, setAnalysis] = useState<BookAnalysis | null>(null)
  const extras = wordTiming === 'smart' ? analysis?.extras : undefined
  const timeline = useMemo(
    () => buildTimeline(words, book.paragraphEnds, wordTiming, headings, extras),
    [words, book.paragraphEnds, wordTiming, headings, extras],
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

  // A timed session ("read for 10 minutes"), planned to end at a natural break.
  const [session, setSession] = useState<{ from: number; end: number; minutes: number; landing: Landing } | null>(null)
  const [sessionDone, setSessionDone] = useState<{ minutes: number; words: number; landing: Landing; where: string } | null>(
    null,
  )
  const chapterTitleAt = useCallback(
    (i: number) => {
      let title = ''
      for (const c of chapters) if (c.start <= i) title = c.title
      return chapters.length > 1 ? title : ''
    },
    [chapters],
  )
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  })
  const finishSession = useCallback(() => {
    const s = sessionRef.current
    if (!s) return
    setSession(null)
    setSessionDone({ minutes: s.minutes, words: s.end - s.from + 1, landing: s.landing, where: chapterTitleAt(s.end) })
  }, [chapterTitleAt])

  const { index, playing, toggle, play, pause, seek } = useRsvp(
    timeline.weights,
    wpm,
    initialIndex,
    pageDelay,
    session?.end,
    finishSession,
  )

  // Coming back after a while: a short "Previously…" of the last few
  // sentences, until reading carries on or it's dismissed.
  const [recapAgo] = useState(() =>
    shouldRecap(lastReadAt, initialIndex, Date.now()) ? timeAgo(lastReadAt!, Date.now()) : null,
  )
  const [recapDismissed, setRecapDismissed] = useState(false)
  const showRecap = recapAgo !== null && !recapDismissed && !playing && index === initialIndex

  // Glance back: hold the word to see the last couple of sentences (reading
  // pauses while you look), let go to carry on. Swipe to move by sentence.
  const [glancing, setGlancing] = useState(false)
  const resumeAfterGlance = useRef(false)
  const wordGestures = usePressGestures({
    onTap: () => toggle(),
    onHoldStart: () => {
      resumeAfterGlance.current = playing
      setGlancing(true)
      pause()
    },
    onHoldEnd: () => {
      setGlancing(false)
      if (resumeAfterGlance.current) play()
    },
    onSwipe: (direction) => seek(direction === 'left' ? nextSentence(words, index) : previousSentence(words, index)),
  })
  // Page mode: swipe to turn pages, like an e-reader.
  const pageGestures = usePressGestures({
    onSwipe: (direction) => (direction === 'left' ? pageNav.current?.next() : pageNav.current?.previous()),
  })

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
  const [panel, setPanel] = useState<'search' | 'settings' | 'bookmarks' | 'session' | null>(null)
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

  const openPanel = (which: 'search' | 'settings' | 'bookmarks' | 'session') => {
    pause()
    if (panel === which && !closing) {
      closePanel()
      return
    }
    window.clearTimeout(closeTimer.current)
    setClosing(false)
    setPanel(which)
  }

  const startSession = (plan: { end: number; landing: Landing; minutes: number }) => {
    setSession({ ...plan, from: index })
    setSessionDone(null)
    closePanel()
    play()
  }

  // Start indexing in the background as soon as the book opens.
  const [bookSearch, setBookSearch] = useState<BookSearch | null>(null)
  useEffect(() => {
    const s = new BookSearch(book.id, words)
    setBookSearch(s)
    let live = true
    s.analysis.then((a) => live && setAnalysis(a))
    return () => {
      live = false
      s.dispose()
    }
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

  useReadingTime(playing, index, wpm, onReadingTime)
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

  const doneCard = sessionDone && !playing && (
    <aside className="recap" aria-label="Session done" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <p className="recap-head">Session done · {sessionDone.minutes} min</p>
      <p className="recap-text session-summary">
        You read {sessionDone.words.toLocaleString()} words
        {sessionDone.landing === 'chapter' && sessionDone.where ? ` and finished ${sessionDone.where}` : ''}
        {sessionDone.landing === 'book' ? ' and finished the book' : ''}.
      </p>
      <div className="recap-actions">
        <button
          type="button"
          className="demo-button"
          onClick={() => {
            setSessionDone(null)
            play()
          }}
        >
          <Icon name="play" size={16} />
          Keep going
        </button>
        <button type="button" className="text-button" onClick={() => setSessionDone(null)}>
          Done
        </button>
      </div>
    </aside>
  )

  const recapCard = recapAgo && (
    <Recap
      words={words}
      index={initialIndex}
      where={hasChapters ? chapters[chapterIndex].title : null}
      ago={recapAgo}
      onContinue={() => {
        setRecapDismissed(true)
        play()
      }}
      onDismiss={() => setRecapDismissed(true)}
    />
  )

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
            // The chapter name with its arrow right beside it; the real (invisible)
            // select sits on top, so tapping opens the system chapter picker.
            <span className="chapter-picker">
              <span className="chapter-name">{chapters[chapterIndex].title}</span>
              <Icon name="chevronDown" size={14} />
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
            </span>
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
        <section
          {...pageGestures.handlers}
          onClickCapture={(e) => {
            // The click a swipe ends with shouldn't also jump to the word under the finger.
            if (pageGestures.wasSwipe()) {
              e.stopPropagation()
              e.preventDefault()
            }
          }}
          className={`stage stage-page${settings.pageHighlight ? '' : ' no-highlight'}${settings.pacer ? '' : ' no-pacer'}`}
        >
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
          {showRecap && recapCard}
          {doneCard}
        </section>
      ) : (
        <section className="stage">
          <WordDisplay
            word={words[index] ?? ''}
            scale={textScale}
            heading={headingWords.has(index)}
            font={font}
            gestures={wordGestures.handlers}
          />
          {glancing && <Glance words={words} index={index} />}
          {showRecap && recapCard}
          {doneCard}
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
          <div className="deck-meta-wrap">
            {session ? (
              <div className="deck-meta session-active">
                <span className="session-left">
                  <Icon name="clock" size={13} />
                  {formatMinutes(minutesBetween(timeline, index, session.end + 1, wpm))} left in session
                  <button type="button" className="text-button session-end" onClick={() => setSession(null)}>
                    End
                  </button>
                </span>
                <span className="muted">{describeLanding(session.landing, chapterTitleAt(session.end))}</span>
              </div>
            ) : (
              <button
                type="button"
                className="deck-meta muted session-open"
                onClick={() => openPanel('session')}
                title="Read for a set time"
                aria-label={`${hasChapters ? `${chapterLeft} left in chapter, ` : ''}${bookLeft} left${hasChapters ? ' in book' : ''}, ${percent}%. Read for a set time`}
              >
                {hasChapters && <span>{chapterLeft} left in chapter</span>}
                <span>
                  {bookLeft} left{hasChapters && ' in book'} · {percent}%
                  <Icon name="clock" size={13} />
                </span>
              </button>
            )}
            {panel === 'session' && (
              <SessionMenu
                landsFor={(minutes) => {
                  const plan = planSession(timeline, words, book.paragraphEnds, chapterStarts, index, minutes, wpm)
                  return describeLanding(plan.landing, chapterTitleAt(plan.end))
                }}
                chapters={chapterTargets(chapters, index, words.length).map((c) => ({
                  ...c,
                  time: formatMinutes(minutesBetween(timeline, index, c.end + 1, wpm)),
                }))}
                closing={closing}
                onStartTime={(minutes) => {
                  const plan = planSession(timeline, words, book.paragraphEnds, chapterStarts, index, minutes, wpm)
                  startSession({ ...plan, minutes })
                }}
                onStartChapter={(c) => {
                  const minutes = Math.max(1, Math.round(minutesBetween(timeline, index, c.end + 1, wpm)))
                  startSession({ end: c.end, landing: 'chapter', minutes })
                }}
                onClose={closePanel}
              />
            )}
          </div>

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
          names={analysis?.names}
          position={index}
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

/** Where a timed session will stop, in words. */
function describeLanding(landing: Landing, chapter: string): string {
  if (landing === 'book') return 'to the end of the book'
  if (landing === 'chapter') return chapter ? `to the end of ${chapter}` : 'to the end of a chapter'
  return chapter ? `ends in ${chapter}` : landing === 'paragraph' ? 'ends at a paragraph break' : 'ends at a full stop'
}

/** "Previously…": the last few sentences before where you left off. */
function Recap({
  words,
  index,
  where,
  ago,
  onContinue,
  onDismiss,
}: {
  words: string[]
  index: number
  where: string | null
  ago: string
  onContinue: () => void
  onDismiss: () => void
}) {
  const { start, end } = recapRange(words, index)
  if (end < start) return null
  return (
    <aside className="recap" aria-label="Previously" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <p className="recap-head">
        Previously{where && <> · {where}</>} <span className="muted">· {ago}</span>
      </p>
      <p className="recap-text">
        {start > 0 && '… '}
        {words.slice(start, end + 1).join(' ')}
      </p>
      <div className="recap-actions">
        <button type="button" className="demo-button" onClick={onContinue}>
          <Icon name="play" size={16} />
          Continue reading
        </button>
        <button type="button" className="text-button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </aside>
  )
}

/** The previous and current sentence, shown while the word is held. */
function Glance({ words, index }: { words: string[]; index: number }) {
  const { start, end } = glanceRange(words, index)
  return (
    <div className="glance" role="status">
      <p>
        {words.slice(start, end + 1).map((w, k) => {
          const i = start + k
          return (
            <span key={i} className={i === index ? 'current' : i > index ? 'ahead' : undefined}>
              {w}{' '}
            </span>
          )
        })}
      </p>
      <span className="glance-hint">Let go to keep reading</span>
    </div>
  )
}

/** Report reading while playing: every 30s, on pause, and when the reader closes. */
const STATS_FLUSH_MS = 30_000

/**
 * Counts time spent playing and the words the clock moved through (not
 * jumps), and reports them periodically. Time is capped at twice what the
 * words should have taken, so a phone asleep or a background tab mid-play
 * doesn't count as hours of reading.
 */
function useReadingTime(playing: boolean, index: number, wpm: number, report: (ms: number, words: number) => void) {
  const session = useRef<{ at: number; words: number } | null>(null)
  const previous = useRef(index)
  const pace = useRef(wpm)
  useEffect(() => {
    pace.current = wpm
  }, [wpm])
  useEffect(() => {
    if (playing && session.current && index === previous.current + 1) session.current.words++
    previous.current = index
  }, [index, playing])
  useEffect(() => {
    if (!playing) return
    session.current = { at: performance.now(), words: 0 }
    const flush = () => {
      const s = session.current
      if (!s) return
      const now = performance.now()
      const ms = Math.min(now - s.at, ((s.words * 60000) / pace.current) * 2)
      if (s.words > 0) report(ms, s.words)
      session.current = { at: now, words: 0 }
    }
    const timer = window.setInterval(flush, STATS_FLUSH_MS)
    return () => {
      window.clearInterval(timer)
      flush()
      session.current = null
    }
  }, [playing, report])
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
