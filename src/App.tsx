import { useCallback, useEffect, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { parseFile } from './lib/parsers'
import { sentenceStart } from './lib/rsvp'
import { EMPTY_STATS } from './lib/stats'
import * as storage from './lib/storage'
import type { Book, BookMeta, Progress } from './lib/types'

interface OpenBook {
  book: Book
  startIndex: number
  /** The built-in sample: not in the library, and its progress isn't saved. */
  demo?: boolean
}

export default function App() {
  const [books, setBooks] = useState<BookMeta[]>([])
  // The demo is offered only once we know the library is empty, so it never
  // flashes up while a returning reader's books are still loading.
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [progress, setProgress] = useState<Record<string, Progress | undefined>>({})
  const [stats, setStats] = useState(EMPTY_STATS)
  const [open, setOpen] = useState<OpenBook | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState(storage.loadSettings)

  const refreshLibrary = useCallback(async () => {
    const list = await storage.listBooks()
    const entries = await Promise.all(list.map(async (b) => [b.id, await storage.loadProgress(b.id)] as const))
    setBooks(list)
    setProgress(Object.fromEntries(entries))
    setStats(await storage.loadStats())
    setLibraryLoaded(true)
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

  const handleDemo = async () => {
    setError(null)
    const { createDemoBook } = await import('./lib/demo')
    setOpen({ book: createDemoBook(), startIndex: 0, demo: true })
  }

  const handleDelete = async (id: string) => {
    await storage.deleteBook(id)
    await refreshLibrary()
  }

  const bookId = open?.demo ? undefined : open?.book.id
  const handleProgress = useCallback(
    (index: number) => {
      if (bookId) storage.saveProgress(bookId, index).catch(() => {})
    },
    [bookId],
  )

  const demo = !!open?.demo
  const handleReadingTime = useCallback(
    (ms: number, words: number) => {
      if (!demo) storage.recordReading(ms, words).catch(() => {})
    },
    [demo],
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
        onReadingTime={handleReadingTime}
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
      stats={stats}
      wpm={settings.wpm}
      busy={busy}
      error={error}
      showDemo={libraryLoaded && books.length === 0 && !busy}
      onDemo={handleDemo}
      onUpload={handleUpload}
      onOpen={handleOpen}
      onDelete={handleDelete}
    />
  )
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
