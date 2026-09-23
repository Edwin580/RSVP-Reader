import { useEffect, useMemo, useRef, useState } from 'react'
import { ACCEPTED_EXTENSIONS } from '../lib/parsers'
import { formatMinutes } from '../lib/rsvp'
import type { BookMeta, Progress } from '../lib/types'

interface Props {
  books: BookMeta[]
  progress: Record<string, Progress | undefined>
  wpm: number
  busy: string | null
  error: string | null
  onUpload: (file: File) => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}

const FORMATS = ACCEPTED_EXTENSIONS.filter((e) => e !== '.markdown')
  .map((e) => e.slice(1).toUpperCase())
  .join(', ')

export function Library({ books, progress, wpm, busy, error, onUpload, onOpen, onDelete }: Props) {
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

  return (
    <main className="library">
      <header className="masthead">
        <h1 className="wordmark">RSVP Reader</h1>
        {books.length > 0 && (
          <button type="button" className="button" onClick={choose} disabled={!!busy}>
            Add a book
          </button>
        )}
      </header>

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

      {busy && <p className="notice label">{busy}</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {books.length === 0 ? (
        <section className="empty">
          <p className="empty-lead">Read a book one word at a time, without moving your eyes.</p>
          <p className="muted">
            Add an EPUB, PDF or text file. It stays on this device. Nothing is uploaded, and no account is needed.
          </p>
          <button type="button" className="button button-primary" onClick={choose} disabled={!!busy}>
            Choose a file
          </button>
          <p className="label muted">or drop it anywhere on this page · {FORMATS}</p>
        </section>
      ) : (
        <ol className="shelf">
          {sorted.map((book) => {
            const at = progress[book.id]?.index ?? 0
            const fraction = book.wordCount > 1 ? at / (book.wordCount - 1) : 0
            const percent = Math.round(fraction * 100)
            const format = book.fileName.split('.').pop()?.toUpperCase()
            const left = formatMinutes(((1 - fraction) * book.wordCount) / wpm)
            return (
              <li key={book.id} className="shelf-item">
                <button type="button" className="shelf-open" onClick={() => onOpen(book.id)}>
                  <span className="shelf-title">{book.title}</span>
                  <span className="label muted">
                    {format} · {book.wordCount.toLocaleString()} words ·{' '}
                    {percent === 0 ? `${left} to read` : percent === 100 ? 'finished' : `${left} left`}
                  </span>
                  <span className="shelf-percent label">{percent}%</span>
                  <span className="rule" aria-hidden="true">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                </button>
                <button
                  type="button"
                  className="shelf-remove label"
                  aria-label={`Remove ${book.title}`}
                  onClick={() => {
                    if (confirm(`Remove "${book.title}" from your library?`)) onDelete(book.id)
                  }}
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ol>
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <p>Drop to add to your library</p>
        </div>
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
