import { useEffect, useMemo, useRef, useState } from 'react'
import { ACCEPTED_EXTENSIONS } from '../lib/parsers'
import { formatMinutes } from '../lib/rsvp'
import { summarize, type ReadingStats } from '../lib/stats'
import type { BookMeta, Progress } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  books: BookMeta[]
  progress: Record<string, Progress | undefined>
  stats: ReadingStats
  wpm: number
  busy: string | null
  error: string | null
  /** Offer the built-in sample (only while the library is empty). */
  showDemo: boolean
  onDemo: () => void
  onUpload: (file: File) => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}

const FORMATS = 'EPUB, PDF, TXT or Markdown'

export function Library({ books, progress, stats, wpm, busy, error, showDemo, onDemo, onUpload, onOpen, onDelete }: Props) {
  const input = useRef<HTMLInputElement>(null)
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
  const summary = useMemo(() => summarize(stats, new Date()), [stats])

  return (
    <main className="library">
      <header className="library-header">
        <h1>Library</h1>
        <p className="muted">Speed-read your books one word at a time. Files stay on this device.</p>
      </header>

      {summary.totalWords > 0 && (
        <section className="stats" aria-label="Your reading">
          <div>
            <span className="stat-value">{summary.todayMs ? formatMinutes(summary.todayMs / 60000) : '—'}</span>
            <span className="stat-label">Today</span>
          </div>
          <div>
            <span className="stat-value">{summary.weekMs ? formatMinutes(summary.weekMs / 60000) : '—'}</span>
            <span className="stat-label">Last 7 days</span>
          </div>
          <div>
            <span className="stat-value">{summary.weekWpm ?? '—'}</span>
            <span className="stat-label">Avg wpm</span>
          </div>
          <div>
            <span className="stat-value">
              {summary.streak} {summary.streak === 1 ? 'day' : 'days'}
            </span>
            <span className="stat-label">Streak</span>
          </div>
        </section>
      )}

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
                    <span className="shelf-title">{book.title}</span>
                    <span className="shelf-meta muted">
                      {format} · {book.wordCount.toLocaleString()} words · {status}
                    </span>
                    <span className="bar" aria-hidden="true">
                      <span style={{ width: `${percent}%` }} />
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
    </main>
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
