import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ACCEPTED_EXTENSIONS } from '../lib/parsers'
import { IS_PREVIEW, PREVIEW_PR } from '../lib/preview'
import { formatMinutes } from '../lib/rsvp'
import { fractionRead, isRead } from '../lib/shelf'
import type { ReadingStats as Stats } from '../lib/stats'
import type { BookMeta, Progress } from '../lib/types'
import { Icon } from './Icon'
import { ReadingStats } from './ReadingStats'

interface Props {
  books: BookMeta[]
  progress: Record<string, Progress | undefined>
  stats: Stats
  wpm: number
  busy: string | null
  error: string | null
  /** When a backup was last saved from this browser, or null. */
  lastBackup: number | null
  /** Whether the browser has promised to keep our storage (null = unknown). */
  storageKept: boolean | null
  /** Offer the built-in sample (only while the library is empty). */
  showDemo: boolean
  onDemo: () => void
  onUpload: (file: File) => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  /** Move a book to the Read shelf, or back. */
  onMarkRead: (book: BookMeta, read: boolean) => void
  onBackup: () => void
  onRestore: (file: File) => void
}

const FORMATS = 'EPUB, PDF, TXT or Markdown'
const BACKUP_NUDGE_AFTER_MS = 14 * 24 * 60 * 60 * 1000

/** "today", "yesterday", or a short date like "Sep 12". */
function formatDate(at: number, now: number): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function Library({
  books,
  progress,
  stats,
  wpm,
  busy,
  error,
  lastBackup,
  storageKept,
  showDemo,
  onDemo,
  onUpload,
  onOpen,
  onDelete,
  onMarkRead,
  onBackup,
  onRestore,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const restoreInput = useRef<HTMLInputElement>(null)
  const dragging = useWindowFileDrag((file) => !busy && onUpload(file))

  // Most recently read (or added) first.
  const sorted = useMemo(
    () =>
      [...books].sort(
        (a, b) =>
          Math.max(progress[b.id]?.updatedAt ?? 0, b.addedAt) - Math.max(progress[a.id]?.updatedAt ?? 0, a.addedAt),
      ),
    [books, progress],
  )
  const reading = sorted.filter((b) => !isRead(b, progress[b.id]))
  // Most recently read first.
  const read = sorted
    .filter((b) => isRead(b, progress[b.id]))
    .sort((a, b) => (b.readAt ?? progress[b.id]?.updatedAt ?? 0) - (a.readAt ?? progress[a.id]?.updatedAt ?? 0))
  const [tab, setTab] = useState<Tab>(loadTab)
  const pickTab = (next: Tab) => {
    setTab(next)
    setSwiped(null)
    saveTab(next)
  }
  // The row swiped open to show its actions, if any.
  const [swiped, setSwiped] = useState<string | null>(null)
  useEffect(() => {
    if (!swiped) return
    // Touching anywhere else, or scrolling, puts it back.
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(`[data-book="${CSS.escape(swiped)}"]`)) setSwiped(null)
    }
    const scrolled = () => setSwiped(null)
    document.addEventListener('pointerdown', close, true)
    window.addEventListener('scroll', scrolled, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('scroll', scrolled)
    }
  }, [swiped])
  const shown = tab === 'read' ? read : reading

  const choose = () => input.current?.click()
  // The time the library was shown, for "backed up yesterday" and the nudge below.
  const [now] = useState(Date.now)
  // Nudge only when it matters: storage isn't guaranteed and there's no backup from the last two weeks.
  const needsBackup = storageKept === false && (lastBackup === null || now - lastBackup > BACKUP_NUDGE_AFTER_MS)

  return (
    <main className="library">
      <header className="library-header">
        {IS_PREVIEW && (
          <p className="preview-note">
            Preview of pull request #{PREVIEW_PR}. It keeps its own books and settings, separate from the real app.
          </p>
        )}
        <p className="brand">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#141414" /* ui-allow: the logo keeps its colours */ />
            <path
              d="M7 7.5h18M16 7.5v3M7 24.5h18M16 24.5v-3"
              stroke="#fbfaf7" /* ui-allow: the logo keeps its colours */
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="16" cy="16" r="3.6" fill="#e0483a" /* ui-allow: the logo keeps its colours */ />
          </svg>
          Chapter
        </p>
        <h1>Library</h1>
        <p className="muted">Read faster, one word at a time. Your books stay on this device.</p>
        <ReadingStats stats={stats} />
      </header>

      <button
        type="button"
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onClick={choose}
        disabled={!!busy}
      >
        <Icon name="plus" size={24} />
        <span className="dropzone-title">{busy ?? (dragging ? 'Drop to add it' : 'Add a book')}</span>
        <span className="muted">
          {FORMATS}
          <span className="on-mouse"> · or drop a file here</span>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={ACCEPTED_EXTENSIONS.join(',')}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
          e.target.value = ''
        }}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {showDemo && (
        <section className="demo">
          <div>
            <h2>No book handy?</h2>
            <p className="muted">
              Try a short sample from <em>Alice’s Adventures in Wonderland</em>. It takes a few minutes and shows both
              reading modes, chapters and search. Nothing is added to your library.
            </p>
          </div>
          <button type="button" className="demo-button" onClick={onDemo}>
            <Icon name="play" size={18} />
            Try the demo
          </button>
        </section>
      )}

      {sorted.length > 0 && (
        <section className="shelves">
          <div className="shelf-tabs" role="tablist" aria-label="Shelves">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls="shelf-panel"
                onClick={() => pickTab(id)}
              >
                {label}
                <span className="shelf-count">{(id === 'read' ? read : reading).length}</span>
              </button>
            ))}
          </div>
          <div id="shelf-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {shown.length === 0 ? (
              <p className="shelf-empty muted">
                {tab === 'read'
                  ? 'Books you finish, or mark as read, go here.'
                  : 'Nothing in progress. Add a book, or pick one from Read to start again.'}
              </p>
            ) : (
              <ul className="shelf">
                {shown.map((book) => (
                  <ShelfRow
                    key={book.id}
                    book={book}
                    progress={progress[book.id]}
                    wpm={wpm}
                    now={now}
                    read={tab === 'read'}
                    swiped={swiped === book.id}
                    onSwipe={(open) => setSwiped(open ? book.id : null)}
                    onOpen={() => onOpen(book.id)}
                    onMarkRead={() => {
                      setSwiped(null)
                      onMarkRead(book, tab !== 'read')
                    }}
                    onDelete={() => {
                      if (confirm(`Remove "${book.title}" from your library?`)) onDelete(book.id)
                      else setSwiped(null)
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* Backups stay out of the way: one quiet line, with a gentle nudge only
          when the browser might clear the library and there's no recent backup. */}
      <footer className="backup">
        {sorted.length > 0 ? (
          <>
            <p className={`backup-status${needsBackup ? ' is-nudge' : ''}`}>
              {lastBackup ? `Backed up ${formatDate(lastBackup, now)}` : 'Not backed up yet'}
              {needsBackup && (
                <span className="backup-why">
                  {' '}
                  · This browser may clear books it hasn’t seen in a while.
                </span>
              )}
            </p>
            <div className="backup-actions">
              <button type="button" className="text-button" onClick={onBackup} disabled={!!busy}>
                Back up
              </button>
              <button type="button" className="text-button" onClick={() => restoreInput.current?.click()} disabled={!!busy}>
                Restore
              </button>
            </div>
          </>
        ) : (
          <p className="backup-status">
            Moving from another device?{' '}
            <button type="button" className="text-button" onClick={() => restoreInput.current?.click()} disabled={!!busy}>
              Restore a backup
            </button>
          </p>
        )}
        <input
          ref={restoreInput}
          type="file"
          hidden
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onRestore(file)
            e.target.value = ''
          }}
        />
      </footer>
    </main>
  )
}

type Tab = 'reading' | 'read'
const TABS: [Tab, string][] = [
  ['reading', 'Reading'],
  ['read', 'Read'],
]
const TAB_KEY = 'library-tab'
// Kept for the session, so coming back from a book lands on the same shelf.
function loadTab(): Tab {
  try {
    return sessionStorage.getItem(TAB_KEY) === 'read' ? 'read' : 'reading'
  } catch {
    return 'reading'
  }
}
function saveTab(tab: Tab) {
  try {
    sessionStorage.setItem(TAB_KEY, tab)
  } catch {
    // Not kept; fine.
  }
}

/** Past this (px), a swipe stops being a tap. */
const SWIPE_START = 8
/** A flick at least this fast (px per ms) opens or closes the row whatever its distance. */
const FLICK_SPEED = 0.4
/** Swiped past this share of the row's width, letting go marks the book (like Mail's full swipe). */
const FULL_SWIPE = 0.6

interface RowProps {
  book: BookMeta
  progress: Progress | undefined
  wpm: number
  /** The time the library was shown, for "Read today". */
  now: number
  /** On the Read shelf (so its action is "Unread"). */
  read: boolean
  /** Swiped open, showing its actions. */
  swiped: boolean
  onSwipe: (open: boolean) => void
  onOpen: () => void
  onMarkRead: () => void
  onDelete: () => void
}

/**
 * A book on the shelf. With a mouse its actions sit at the end of the row;
 * on a touch screen they're behind it, and swiping the row left shows them,
 * like Mail (see the CSS). Swiping all the way marks the book.
 */
function ShelfRow({ book, progress, wpm, now, read, swiped, onSwipe, onOpen, onMarkRead, onDelete }: RowProps) {
  const item = useRef<HTMLLIElement>(null)
  const actions = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    x: number
    y: number
    from: number
    sliding: boolean
    offset: number
    trail: { x: number; t: number }[]
  } | null>(null)
  // In React state, not set on the element, so a re-render mid-swipe keeps them.
  const [dragging, setDragging] = useState(false)
  const [full, setFull] = useState(false)
  // Set by a swipe, so the tap that ends it doesn't open the book.
  const justSwiped = useRef(false)

  const fraction = fractionRead(book, progress)
  const percent = Math.round(fraction * 100)
  const format = book.fileName.split('.').pop()?.toUpperCase()
  const left = formatMinutes(((1 - fraction) * book.wordCount) / wpm)
  const status = read
    ? book.readAt
      ? `Read ${formatDate(book.readAt, now)}`
      : 'Finished'
    : percent === 0
      ? `${left} to read`
      : `${percent}% · ${left} left`

  /** How far the row slides to show its actions: two 5rem buttons (see the CSS). */
  const open = () => 10 * parseFloat(getComputedStyle(document.documentElement).fontSize)
  const behind = () => actions.current && getComputedStyle(actions.current).position === 'absolute'
  const show = (offset: number, full: boolean) => {
    const el = item.current!
    el.style.setProperty('--swipe', `${offset}px`)
    el.style.setProperty('--reveal', String(Math.min(1, -offset / open())))
    setFull(full)
  }
  const settle = () => {
    const el = item.current!
    // Transitions back on before the row moves, so it animates into place.
    flushSync(() => {
      setDragging(false)
      setFull(false)
    })
    el.style.removeProperty('--swipe')
    el.style.removeProperty('--reveal')
  }

  const down = (e: React.PointerEvent) => {
    justSwiped.current = false
    if (e.pointerType === 'mouse' || !behind()) return
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      from: swiped ? -open() : 0,
      sliding: false,
      offset: 0,
      trail: [{ x: e.clientX, t: e.timeStamp }],
    }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.sliding) {
      const dy = e.clientY - d.y
      if (Math.abs(dx) < SWIPE_START && Math.abs(dy) < SWIPE_START) return
      // Mostly up or down: the page scrolls instead.
      if (Math.abs(dy) > Math.abs(dx)) {
        drag.current = null
        return
      }
      d.sliding = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      flushSync(() => setDragging(true))
    }
    d.trail = [...d.trail.filter((p) => e.timeStamp - p.t < 100), { x: e.clientX, t: e.timeStamp }]
    const width = item.current!.offsetWidth
    let offset = d.from + dx
    // Past either end it follows the finger less and less, like a rubber band.
    if (offset > 0) offset = Math.sqrt(offset) * 2
    if (offset < -width) offset = -width - Math.sqrt(-width - offset) * 2
    d.offset = offset
    show(offset, -offset > width * FULL_SWIPE)
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d?.sliding) return
    justSwiped.current = true
    const width = item.current!.offsetWidth
    if (e.type === 'pointerup' && -d.offset > width * FULL_SWIPE) {
      // Slides the rest of the way, then the book moves shelves.
      flushSync(() => setDragging(false))
      show(-width, true)
      window.setTimeout(onMarkRead, 220)
      return
    }
    const first = d.trail[0]
    const last = d.trail[d.trail.length - 1]
    const speed = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0
    settle()
    if (speed < -FLICK_SPEED) onSwipe(true)
    else if (speed > FLICK_SPEED) onSwipe(false)
    else onSwipe(-d.offset > open() / 2)
  }

  return (
    <li
      ref={item}
      className={`shelf-item${swiped ? ' is-swiped' : ''}${dragging ? ' is-dragging' : ''}${full ? ' is-full' : ''}`}
      data-book={book.id}
    >
      <div className="shelf-actions" ref={actions}>
        <button
          type="button"
          className="icon-button shelf-action shelf-mark"
          aria-label={read ? `Mark ${book.title} as unread` : `Mark ${book.title} as read`}
          title={read ? 'Mark as unread' : 'Mark as read'}
          onClick={onMarkRead}
        >
          <span className="shelf-action-inner">
            <Icon name={read ? 'unread' : 'check'} size={19} />
            <span className="shelf-action-label">{read ? 'Unread' : 'Read'}</span>
          </span>
        </button>
        <button
          type="button"
          className="icon-button shelf-action shelf-remove"
          aria-label={`Remove ${book.title}`}
          title="Remove"
          onClick={onDelete}
        >
          <span className="shelf-action-inner">
            <Icon name="trash" size={19} />
            <span className="shelf-action-label">Remove</span>
          </span>
        </button>
      </div>
      <div
        className="shelf-row"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(e) => {
          if (!justSwiped.current && !swiped) return
          // A swipe's last touch, or a tap on a swiped-open row (which closes it).
          justSwiped.current = false
          e.preventDefault()
          e.stopPropagation()
          if (swiped) onSwipe(false)
        }}
      >
        <button type="button" className="shelf-open" onClick={onOpen}>
          <Cover book={book} />
          <span className="shelf-text">
            <span className="shelf-title">{book.title}</span>
            <span className="shelf-meta muted">
              {format} · {book.wordCount.toLocaleString()} words · {status}
            </span>
            <span className="bar" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </span>
          </span>
        </button>
      </div>
    </li>
  )
}

/** Muted cloth colours for books without a cover image, picked from the book id. */
// ui-allow: cloth colours are the books' own, the same in every theme.
const COVER_TONES = ['#8a5a44', '#4f6b5a', '#5a6480', '#7a6a4a', '#6b4f6b', '#4a6a73'] // ui-allow: as above

function Cover({ book }: { book: BookMeta }) {
  if (book.cover) return <img className="cover" src={book.cover} alt="" loading="lazy" />
  let hash = 0
  for (const ch of book.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span className="cover cover-plain" style={{ background: COVER_TONES[hash % COVER_TONES.length] }} aria-hidden="true">
      <span>{book.title}</span>
    </span>
  )
}

/** Accept a file dropped anywhere in the window; returns whether a drag is in progress. */
function useWindowFileDrag(onDrop: (file: File) => void) {
  const [dragging, setDragging] = useState(false)
  const handler = useRef(onDrop)
  useEffect(() => {
    handler.current = onDrop
  })
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = e.dataTransfer?.files[0]
      if (file) handler.current(file)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return dragging
}
