import { useEffect, useMemo, useRef, useState } from 'react'
import { useRsvp } from '../hooks/useRsvp'
import { nextSentence, previousSentence } from '../lib/rsvp'
import type { Settings } from '../lib/storage'
import type { Book } from '../lib/types'
import { SearchPanel } from './SearchPanel'
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

export function Reader({ book, initialIndex, settings, onSettings, onProgress, onClose }: Props) {
  const { words, chapters } = book
  const { wpm, fontSize } = settings
  const { index, playing, toggle, pause, seek } = useRsvp(words, book.paragraphEnds, wpm, initialIndex)
  const [searchOpen, setSearchOpen] = useState(false)

  const openSearch = () => {
    pause()
    setSearchOpen(true)
  }

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
  const setFontSize = (next: number) => onSettings({ ...settings, fontSize: Math.max(24, Math.min(120, next)) })

  // Keep the key handler reading the latest state without re-binding every word.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  const onKey = (e: KeyboardEvent) => {
    if (searchOpen) return
    if ((e.key === 'f' && (e.ctrlKey || e.metaKey)) || e.key === '/') {
      e.preventDefault()
      openSearch()
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

  const percent = words.length > 1 ? (index / (words.length - 1)) * 100 : 100
  const minutesLeft = Math.ceil((words.length - index) / wpm)

  const context = useMemo(() => {
    if (playing) return null
    const start = Math.max(0, index - CONTEXT_WORDS)
    return words.slice(start, index + CONTEXT_WORDS).map((w, i) => ({ w, i: start + i }))
  }, [playing, index, words])

  return (
    <main className="reader">
      <header className="reader-header">
        <button type="button" className="text-button" onClick={onClose}>
          ← Library
        </button>
        <div className="reader-title">
          <strong title={book.title}>{book.title}</strong>
          {chapters.length > 1 && (
            <select
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
        <div className="font-controls">
          <button type="button" className="icon-button" onClick={openSearch} title="Search (/ or Ctrl+F)">
            Search
          </button>
          <button type="button" className="icon-button" aria-label="Smaller text" onClick={() => setFontSize(fontSize - 4)}>
            A−
          </button>
          <button type="button" className="icon-button" aria-label="Larger text" onClick={() => setFontSize(fontSize + 4)}>
            A+
          </button>
        </div>
      </header>

      <section className="stage">
        <WordDisplay word={words[index] ?? ''} fontSize={fontSize} onClick={toggle} />
        <div className="context" aria-hidden={playing}>
          {context ? (
            <p>
              {context.map(({ w, i }) => (
                <span key={i} className={i === index ? 'current' : undefined} onClick={() => seek(i)}>
                  {w}{' '}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </section>

      <footer className="controls">
        <input
          type="range"
          className="scrubber"
          min={0}
          max={Math.max(words.length - 1, 0)}
          value={index}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Position in book"
        />
        <div className="stats muted small">
          <span>{percent.toFixed(1)}%</span>
          <span>
            {(index + 1).toLocaleString()} / {words.length.toLocaleString()}
          </span>
          <span>~{minutesLeft} min left</span>
        </div>

        <div className="buttons">
          <button type="button" className="icon-button" title="Previous sentence (Shift+←)" onClick={() => seek(previousSentence(words, index))}>
            ⏮
          </button>
          <button type="button" className="icon-button" title="Back one word (←)" onClick={() => seek(index - 1)}>
            ◀
          </button>
          <button type="button" className="play-button" onClick={toggle} title="Play / pause (Space)">
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="icon-button" title="Forward one word (→)" onClick={() => seek(index + 1)}>
            ▶
          </button>
          <button type="button" className="icon-button" title="Next sentence (Shift+→)" onClick={() => seek(nextSentence(words, index))}>
            ⏭
          </button>
        </div>

        <div className="wpm">
          <button type="button" className="icon-button" onClick={() => setWpm(wpm - WPM_STEP)} aria-label="Slower">
            −
          </button>
          <label>
            <input
              type="range"
              min={MIN_WPM}
              max={MAX_WPM}
              step={WPM_STEP}
              value={wpm}
              onChange={(e) => setWpm(Number(e.target.value))}
              aria-label="Words per minute"
            />
            <span>{wpm} wpm</span>
          </label>
          <button type="button" className="icon-button" onClick={() => setWpm(wpm + WPM_STEP)} aria-label="Faster">
            +
          </button>
        </div>
        <p className="hint muted small">Space play/pause · ←/→ word · Shift+←/→ sentence · ↑/↓ speed · / search · Esc library</p>
      </footer>

      {searchOpen && (
        <SearchPanel
          words={words}
          chapters={chapters}
          onSelect={(i) => {
            seek(i)
            setSearchOpen(false)
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </main>
  )
}
