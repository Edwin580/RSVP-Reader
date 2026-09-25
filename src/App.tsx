import { useCallback, useEffect, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { navigate } from './components/transition'
import { applyAppearance } from './lib/appearance'
import { createBackup, mergeBackup, parseBackup } from './lib/backup'
import { parseFile } from './lib/parsers'
import { sentenceStart } from './lib/rsvp'
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
  const [open, setOpen] = useState<OpenBook | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Whether the browser has promised not to clear our storage (null = unknown).
  const [storageKept, setStorageKept] = useState<boolean | null>(null)
  const [settings, setSettings] = useState(storage.loadSettings)

  const refreshLibrary = useCallback(async () => {
    const list = await storage.listBooks()
    const entries = await Promise.all(list.map(async (b) => [b.id, await storage.loadProgress(b.id)] as const))
    setBooks(list)
    setProgress(Object.fromEntries(entries))
    setLibraryLoaded(true)
  }, [])

  useEffect(() => {
    refreshLibrary().catch((e) => setError(`Could not load library: ${message(e)}`))
  }, [refreshLibrary])

  useEffect(() => {
    navigator.storage?.persisted?.().then(setStorageKept, () => {})
  }, [])

  const openBook = useCallback(async (book: Book) => {
    const saved = await storage.loadProgress(book.id)
    // Resume from the start of the sentence so there's context to pick up from.
    const startIndex = saved ? sentenceStart(book.words, saved.index) : 0
    navigate('forward', () => setOpen({ book, startIndex }))
  }, [])

  const handleUpload = async (file: File) => {
    setError(null)
    setNotice(null)
    setBusy(`Reading ${file.name}…`)
    try {
      const book = await parseFile(file, (f) => setBusy(`Reading ${file.name}… ${Math.round(f * 100)}%`))
      await storage.saveBook(book, file.name)
      // Now there's something worth keeping, ask the browser not to clear it.
      storage.requestPersistence().then(setStorageKept, () => {})
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
    const book = createDemoBook()
    navigate('forward', () => setOpen({ book, startIndex: 0, demo: true }))
  }

  const handleBackup = async () => {
    setError(null)
    const backup = createBackup(await storage.allEntries())
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `rsvp-reader-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const handleRestore = async (file: File) => {
    setError(null)
    setNotice(null)
    try {
      const backup = parseBackup(await file.text())
      const current = new Map(await storage.allEntries())
      const { writes, added } = mergeBackup(current, backup)
      await storage.writeEntries(writes)
      storage.requestPersistence().then(setStorageKept, () => {})
      await refreshLibrary()
      setNotice(
        added > 0
          ? `Restored ${added} ${added === 1 ? 'book' : 'books'} from the backup.`
          : 'Everything in the backup was already here. Reading positions are up to date.',
      )
    } catch (e) {
      setError(`Couldn't restore ${file.name}: ${message(e)}`)
    }
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

  const handleSettings = (next: storage.Settings) => {
    applyAppearance(next)
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
          navigate('back', () => setOpen(null))
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
      notice={notice}
      storageKept={storageKept}
      showDemo={libraryLoaded && books.length === 0 && !busy}
      onDemo={handleDemo}
      onUpload={handleUpload}
      onOpen={handleOpen}
      onDelete={handleDelete}
      onBackup={handleBackup}
      onRestore={handleRestore}
    />
  )
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
