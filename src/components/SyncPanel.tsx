import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatTime } from '../lib/audio'
import type { SearchHit } from '../lib/search'
import type { BookSearch } from '../lib/searchClient'
import { useSheetDrag } from '../hooks/useSheetDrag'
import { Icon } from './Icon'

interface Props {
  words: string[]
  paragraphEnds: number[]
  bookSearch: BookSearch | null
  /** Where the recording is, in seconds. */
  time: number
  /** How long the recording is, in seconds (0 while unknown). */
  duration: number
  /** The word the book has at a moment in the recording: where the narrator probably is. */
  wordAt: (seconds: number) => number
  /** Where in the recording the book has word `index`. */
  timeAt: (index: number) => number
  /** The chapter word `index` is in, to say where a moment of a long recording is. */
  chapterAt: (index: number) => string
  playing: boolean
  /** Animating out; the reader unmounts it shortly after. */
  closing?: boolean
  /** Move the recording to `seconds`. */
  onSeek: (seconds: number) => void
  onTogglePlay: () => void
  /** The narrator is saying word `index` at `time`. */
  onPick: (index: number) => void
  onClose: () => void
}

/** Words shown either side of the guess: a few minutes of narration. */
const AROUND = 300
const SKIPS = [-15, -5, 5, 15]
const RESULTS = 8
const CONTEXT_WORDS = 7

/**
 * Lining the book and the recording up by hand, either way round: tap the
 * word being heard in the passage around where the book thinks the narrator
 * is (or search for words just heard), or move the recording (skips, or a
 * slider across all of it) until the marked word is heard and tap that.
 */
export function SyncPanel(props: Props) {
  const { words, paragraphEnds, bookSearch, time, duration, wordAt, timeAt, chapterAt, playing, closing, onSeek, onTogglePlay, onPick, onClose } = props
  // Escape closes it wherever the focus is, and never reaches the reader, where it would close the book.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', esc, { capture: true })
    return () => window.removeEventListener('keydown', esc, { capture: true })
  }, [onClose])
  const sheet = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useSheetDrag(sheet, onClose, body)

  // While the slider is dragged, the time and passage follow it; the
  // recording moves when it's let go.
  const [scrub, setScrub] = useState<number | null>(null)
  const shownTime = scrub ?? time
  const guess = wordAt(shownTime)

  // The passage stays put while the guess moves within it (so the word being
  // looked for doesn't run away), and moves when the guess leaves it.
  const [center, setCenter] = useState(guess)
  const from = Math.max(0, center - AROUND)
  const to = Math.min(words.length, center + AROUND)
  if (Math.abs(guess - center) > (AROUND * 3) / 4) setCenter(guess)
  const paragraphs = useMemo(() => {
    const ends = paragraphEnds.filter((e) => e >= from && e < to)
    const out: [number, number][] = []
    let start = from
    for (const end of ends) {
      out.push([start, end + 1])
      start = end + 1
    }
    if (start < to) out.push([start, to])
    return out
  }, [paragraphEnds, from, to])

  // On opening and after a skip, the guess is scrolled into view; not while
  // playing, when it would pull the passage away from someone reading it.
  const reveal = useRef(true)
  const passage = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!reveal.current) return
    reveal.current = false
    passage.current?.querySelector('.sync-guess')?.scrollIntoView({ block: 'center' })
  }, [guess, center, scrub])
  const seek = (seconds: number) => {
    reveal.current = true
    onSeek(Math.max(0, duration ? Math.min(duration, seconds) : seconds))
  }
  const letGo = () => {
    if (scrub === null) return
    seek(scrub)
    setScrub(null)
  }

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<{ query: string; hits: SearchHit[] } | null>(null)
  useEffect(() => {
    if (!bookSearch || query.trim().length < 2) return
    let live = true
    bookSearch.query(query, 200).then((result) => {
      if (!live) return
      // Nearest the guess first: words just heard are close to where the book is.
      const near = [...result.matches, ...result.related].sort((a, b) => Math.abs(a.start - guess) - Math.abs(b.start - guess))
      setHits({ query, hits: near.slice(0, RESULTS) })
    })
    return () => {
      live = false
    }
    // Ordered by the guess when asked; it shouldn't reshuffle while playing.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [bookSearch, query])
  const shown = query.trim().length >= 2 && hits?.query === query ? hits.hits : null

  return (
    <div className={`search-backdrop is-sheet${closing ? ' is-closing' : ''}`} onClick={onClose}>
      <aside ref={sheet} className="search-panel sync-panel" role="dialog" aria-label="Sync" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <div className="panel-bar">
          <h2 className="panel-title">Sync</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close sync">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="sync-audio">
          {SKIPS.slice(0, 2).map((s) => (
            <button key={s} type="button" className="text-button sync-skip" onClick={() => seek(time + s)} aria-label={`Back ${-s} seconds`}>
              −{-s} s
            </button>
          ))}
          <button type="button" className="sync-play" onClick={onTogglePlay} aria-label={playing ? 'Pause recording' : 'Play recording'}>
            <Icon name={playing ? 'pause' : 'play'} size={18} />
            <span className="sync-time">{formatTime(shownTime)}</span>
          </button>
          {SKIPS.slice(2).map((s) => (
            <button key={s} type="button" className="text-button sync-skip" onClick={() => seek(time + s)} aria-label={`Forward ${s} seconds`}>
              +{s} s
            </button>
          ))}
        </div>
        {duration > 0 && (
          <div className="sync-scrub">
            <input
              type="range"
              min={0}
              max={Math.floor(duration)}
              step={1}
              value={Math.min(Math.floor(shownTime), Math.floor(duration))}
              aria-label="Position in the recording"
              aria-valuetext={`${formatTime(shownTime)} of ${formatTime(duration)}`}
              onChange={(e) => {
                reveal.current = true
                setScrub(Number(e.target.value))
              }}
              onPointerUp={letGo}
              onKeyUp={letGo}
              onBlur={letGo}
            />
            <span className="muted small sync-where">
              {[chapterAt(guess), `${formatTime(shownTime)} of ${formatTime(duration)}`].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}
        <p className="search-hint sync-hint">
          Play, then tap the word you hear. Or move the recording until you hear the <mark>marked</mark> word, and tap that.
        </p>
        <div className="sync-search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Or search for words you heard"
            aria-label="Search for words you heard"
            enterKeyHint="search"
          />
        </div>

        <div className="search-body" ref={body}>
          {shown && shown.length === 0 && <p className="search-hint">No matches for “{query.trim()}”.</p>}
          {shown && shown.length > 0 && (
            <ol className="search-results sync-results">
              {shown.map((hit) => {
                const a = Math.max(0, hit.start - CONTEXT_WORDS)
                const b = Math.min(words.length - 1, hit.end + CONTEXT_WORDS)
                const marked = new Set(hit.highlights)
                const at = hit.highlights[0] ?? hit.start
                return (
                  <li key={`${hit.start}-${hit.end}`} className="sync-result">
                    <button type="button" onClick={() => onPick(at)} aria-label={`Heard now: ${words.slice(hit.start, hit.end + 1).join(' ')}`}>
                      <span className="search-snippet">
                        {a > 0 && '… '}
                        {words.slice(a, b + 1).map((w, k) => (
                          <Fragment key={k}>{marked.has(a + k) ? <mark>{w}</mark> : w} </Fragment>
                        ))}
                        {b < words.length - 1 && '…'}
                      </span>
                      <span className="muted small">
                        {[chapterAt(at), Math.abs(at - guess) < 40 ? 'near the marked word' : `${formatTime(timeAt(at))} in the recording`].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                    {/* Exploring instead: take the recording to this passage, to hear where it really is. */}
                    <button
                      type="button"
                      className="text-button sync-goto"
                      onClick={() => {
                        setQuery('')
                        // A hair past its start, so the word marked there is this one, not the one before.
                        seek(timeAt(at) + 0.01)
                      }}
                    >
                      Go there
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
          {!shown && (
            <div
              className="sync-passage"
              ref={passage}
              onClick={(e) => {
                const i = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i
                if (i !== undefined) onPick(Number(i))
              }}
            >
              {paragraphs.map(([a, b]) => (
                <p key={a}>
                  {words.slice(a, b).map((w, k) => (
                    <Fragment key={k}>
                      <span data-i={a + k} className={a + k === guess ? 'sync-guess' : undefined}>
                        {w}
                      </span>{' '}
                    </Fragment>
                  ))}
                </p>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
