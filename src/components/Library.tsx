import { useRef, useState } from 'react'
import { ACCEPTED_EXTENSIONS } from '../lib/parsers'
import type { BookMeta, Progress } from '../lib/types'

interface Props {
  books: BookMeta[]
  progress: Record<string, Progress | undefined>
  busy: string | null
  error: string | null
  onUpload: (file: File) => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}

export function Library({ books, progress, busy, error, onUpload, onOpen, onDelete }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0]
    if (file) onUpload(file)
  }

  return (
    <main className="library">
      <header className="library-header">
        <h1>RSVP Reader</h1>
        <p className="muted">Upload a book and read it one word at a time.</p>
      </header>

      <button
        type="button"
        className={`dropzone${dragging ? ' dragging' : ''}`}
        disabled={!!busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
      >
        {busy ? (
          <span>{busy}</span>
        ) : (
          <>
            <strong>Drop a file here or click to upload</strong>
            <span className="muted">{ACCEPTED_EXTENSIONS.filter((e) => e !== '.markdown').join(' · ')}</span>
          </>
        )}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={ACCEPTED_EXTENSIONS.join(',')}
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      {error && <p className="error" role="alert">{error}</p>}

      {books.length > 0 && (
        <section>
          <h2>Your library</h2>
          <ul className="book-list">
            {books.map((book) => {
              const done = Math.round(((progress[book.id]?.index ?? 0) / Math.max(book.wordCount - 1, 1)) * 100)
              return (
                <li key={book.id} className="book">
                  <button type="button" className="book-open" onClick={() => onOpen(book.id)}>
                    <span className="book-title">{book.title}</span>
                    <span className="muted small">
                      {book.fileName} · {book.wordCount.toLocaleString()} words · {done}% read
                    </span>
                    <span className="bar"><span style={{ width: `${done}%` }} /></span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${book.title}`}
                    title="Remove"
                    onClick={() => {
                      if (confirm(`Remove "${book.title}" from your library?`)) onDelete(book.id)
                    }}
                  >
                    ✕
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
