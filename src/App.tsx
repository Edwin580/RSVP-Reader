import { useCallback, useEffect, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { parseFile } from './lib/parsers'
import { sentenceStart } from './lib/rsvp'
import * as storage from './lib/storage'
import type { Book, BookMeta, Progress } from './lib/types'

interface OpenBook {
  book: Book
  startIndex: number
}

export default function App() {
  const [books, setBooks] = useState<BookMeta[]>([])
  const [progress, setProgress] = useState<Record<string, Progress | undefined>>({})
  const [open, setOpen] = useState<OpenBook | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState(storage.loadSettings)

  const refreshLibrary = useCallback(async () => {
    const list = await storage.listBooks()
    const entries = await Promise.all(list.map(async (b) => [b.id, await storage.loadProgress(b.id)] as const))
    setBooks(list)
    setProgress(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    refreshLibrary().catch((e) => setError(`Could not load library: ${message(e)}`))
  }, [refreshLibrary])

  const openBook = useCallback(async (book: Book) => {
    const saved = await storage.loadProgress(book.id)
    // Resume from the start of the sentence so there's context to pick up from.
    setOpen({ book, startIndex: saved ? sentenceStart(book.words, saved.index) : 0 })
  }, [])

  const handleUpload = async (file: File) => {
    setError(null)
    setBusy(`Reading ${file.name}…`)
    try {
      const book = await parseFile(file, (f) => setBusy(`Reading ${file.name}… ${Math.round(f * 100)}%`))
      await storage.saveBook(book, file.name)
      await refreshLibrary()
      await openBook(book)
    } catch (e) {
      setError(`Couldn't open ${file.name}: ${message(e)}`)
    } finally {
      setBusy(null)
    }
  }

  const handleOpen = async (id: string) => {
    setError(null)
    const book = await storage.loadBook(id)
    if (book) await openBook(book)
    else setError('That book is no longer stored. Please upload it again.')
  }

  const handleDelete = async (id: string) => {
    await storage.deleteBook(id)
    await refreshLibrary()
  }

  const bookId = open?.book.id
  const handleProgress = useCallback(
    (index: number) => {
      if (bookId) storage.saveProgress(bookId, index).catch(() => {})
    },
    [bookId],
  )

  const handleSettings = (next: storage.Settings) => {
    setSettings(next)
    storage.saveSettings(next)
  }

  if (open) {
    return (
      <Reader
        key={open.book.id}
        book={open.book}
        initialIndex={open.startIndex}
        settings={settings}
        onSettings={handleSettings}
        onProgress={handleProgress}
        onClose={() => {
          setOpen(null)
          refreshLibrary().catch(() => {})
        }}
      />
    )
  }

  return (
    <Library
      books={books}
      progress={progress}
      wpm={settings.wpm}
      busy={busy}
      error={error}
      onUpload={handleUpload}
      onOpen={handleOpen}
      onDelete={handleDelete}
    />
  )
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
