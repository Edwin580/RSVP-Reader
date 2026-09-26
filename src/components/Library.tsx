import { useEffect, useMemo, useRef, useState } from 'react'
import { ACCEPTED_EXTENSIONS } from '../lib/parsers'
import { IS_PREVIEW, PREVIEW_PR } from '../lib/preview'
import { formatMinutes } from '../lib/rsvp'
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
            <rect width="32" height="32" rx="7" fill="#1c1a17" />
            <path
              d="M7 7.5h18M16 7.5v3M7 24.5h18M16 24.5v-3"
              stroke="#f3efe6"
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="16" cy="16" r="3.6" fill="#e8674f" />
          </svg>
          Chapter
        </p>
        <h1>Library</h1>
        <p className="muted">Speed-read your books one word at a time. Files stay on this device.</p>
        <ReadingStats stats={stats} />
      </header>

      <button
        type="button"
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onClick={choose}
        disabled={!!busy}
      >
        <Icon name="upload" size={26} />
        {busy ? (
          <span className="dropzone-title">{busy}</span>
        ) : (
          <>
            <span className="dropzone-title">{dragging ? (
                'Drop to add it'
              ) : (
                <>
                  Drop a book here or <span className="on-touch">tap</span>
                  <span className="on-mouse">click</span> to choose
                </>
              )}</span>
            <span className="muted">{FORMATS}</span>
          </>
        )}
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

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {sorted.length > 0 && (
        <section>
          <h2>Your books</h2>
          <ul className="shelf">
            {sorted.map((book) => {
              const at = progress[book.id]?.index ?? 0
              const fraction = book.wordCount > 1 ? at / (book.wordCount - 1) : 0
              const percent = Math.round(fraction * 100)
              const format = book.fileName.split('.').pop()?.toUpperCase()
              const left = formatMinutes(((1 - fraction) * book.wordCount) / wpm)
              const status = percent === 0 ? `${left} to read` : percent === 100 ? 'Finished' : `${percent}% · ${left} left`
              return (
                <li key={book.id} className="shelf-item">
                  <button type="button" className="shelf-open" onClick={() => onOpen(book.id)}>
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
                  <button
                    type="button"
                    className="icon-button shelf-remove"
                    aria-label={`Remove ${book.title}`}
                    title="Remove"
                    onClick={() => {
                      if (confirm(`Remove "${book.title}" from your library?`)) onDelete(book.id)
                    }}
                  >
                    <Icon name="trash" size={19} />
                  </button>
                </li>
              )
            })}
          </ul>
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

/** Muted cloth colours for books without a cover image, picked from the book id. */
const COVER_TONES = ['#23386b', '#7a2f2a', '#245945', '#4d3f7a', '#8a6326', '#2b5a68']

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
