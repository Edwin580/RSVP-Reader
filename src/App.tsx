import { useCallback, useEffect, useRef, useState } from 'react'
import { Browse } from './components/Browse'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { Toast, type ToastMessage } from './components/Toast'
import { navigate } from './components/transition'
import { applyAppearance } from './lib/appearance'
import { saveFile } from './lib/saveFile'
import { backupFileName, createBackup, mergeBackup, parseBackup, restoreSummary } from './lib/backup'
import { textStart } from './lib/catalog'
import { parseFile } from './lib/parsers'
import { sentenceStart } from './lib/rsvp'
import { atEnd, readToEnd } from './lib/shelf'
import { EMPTY_STATS } from './lib/stats'
import * as storage from './lib/storage'
import type { Book, BookMeta, Bookmark, Progress } from './lib/types'

interface OpenBook {
  book: Book
  startIndex: number
  /** When this book was last read, for the "Previously…" recap. */
  lastReadAt?: number
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
  // Browsing free books to add.
  const [browsing, setBrowsing] = useState(false)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [lastBackup, setLastBackup] = useState(storage.loadLastBackup)
  // Whether the browser has promised not to clear our storage (null = unknown).
  const [storageKept, setStorageKept] = useState<boolean | null>(null)
  const [settings, setSettings] = useState(storage.loadSettings)
  // Where the open book is, to tell on closing whether it was finished.
  const lastIndex = useRef(0)

  const refreshLibrary = useCallback(async () => {
    const list = await storage.listBooks()
    const entries = await Promise.all(list.map(async (b) => [b.id, await storage.loadProgress(b.id)] as const))
    setBooks(list)
    setProgress(Object.fromEntries(entries))
    setStats(await storage.loadStats())
    setLibraryLoaded(true)
  }, [])

  useEffect(() => {
    refreshLibrary().catch((e) => setError(`Couldn’t load your library. ${message(e)}`))
  }, [refreshLibrary])

  useEffect(() => {
    navigator.storage?.persisted?.().then(setStorageKept, () => {})
  }, [])

  const openBook = useCallback(async (book: Book, also?: () => void) => {
    const saved = await storage.loadProgress(book.id)
    setBookmarks(await storage.loadBookmarks(book.id))
    // Resume from the start of the sentence so there's context to pick up from,
    // except in a finished book, which would then no longer be finished.
    const finished = readToEnd({ wordCount: book.words.length }, saved)
    const startIndex = !saved ? 0 : finished ? saved.index : sentenceStart(book.words, saved.index)
    lastIndex.current = startIndex
    navigate('forward', () => {
      also?.()
      setOpen({ book, startIndex, lastReadAt: saved?.updatedAt })
    })
  }, [])

  /**
   * Read a book file, add it to the library and open it. A book from the
   * catalog opens at its first chapter, past the title page and imprint.
   */
  const addBook = async (file: File, fromCatalog = false) => {
    setError(null)
    setBusy(`Reading ${file.name}…`)
    try {
      const book = await parseFile(file, (f) => setBusy(`Reading ${file.name}… ${Math.round(f * 100)}%`))
      await storage.saveBook(book, file.name)
      if (fromCatalog && !(await storage.loadProgress(book.id))) {
        const start = textStart(book)
        if (start > 0) await storage.saveProgress(book.id, start)
      }
      // Now there's something worth keeping, ask the browser not to clear it.
      storage.requestPersistence().then(setStorageKept, () => {})
      await refreshLibrary()
      await openBook(book, () => setBrowsing(false))
    } finally {
      setBusy(null)
    }
  }

  const handleUpload = async (file: File) => {
    try {
      await addBook(file)
    } catch (e) {
      setError(`Couldn’t open “${file.name}”. ${message(e)}`)
    }
  }

  const handleOpen = async (id: string) => {
    setError(null)
    const book = await storage.loadBook(id)
    if (book) await openBook(book, () => setBrowsing(false))
    else setError('That book is no longer stored. Please upload it again.')
  }

  const handleDemo = async () => {
    setError(null)
    const { createDemoBook } = await import('./lib/demo')
    const book = createDemoBook()
    setBookmarks([])
    navigate('forward', () => setOpen({ book, startIndex: 0, demo: true }))
  }

  const clearToast = useCallback(() => setToast(null), [])
  const showToast = (text: string, tone: ToastMessage['tone'] = 'ok') => setToast({ text, tone, id: Date.now() })

  const handleBackup = async () => {
    try {
      const backup = createBackup(await storage.allEntries())
      const name = backupFileName(new Date())
      const file = new File([JSON.stringify(backup)], name, { type: 'application/json' })
      // Phones: the share sheet saves to Files or iCloud, or AirDrops to another device.
      if (!(await saveFile(file, 'Library backup'))) return
      const now = Date.now()
      storage.saveLastBackup(now)
      setLastBackup(now)
      showToast(`Backup saved: ${books.length} ${books.length === 1 ? 'book' : 'books'} with reading positions.`)
    } catch (e) {
      showToast(`Couldn’t save a backup. ${message(e)}`, 'error')
    }
  }

  const handleRestore = async (file: File) => {
    try {
      const backup = parseBackup(await file.text())
      const current = new Map(await storage.allEntries())
      const { writes, added, updated } = mergeBackup(current, backup)
      await storage.writeEntries(writes)
      storage.requestPersistence().then(setStorageKept, () => {})
      await refreshLibrary()
      showToast(restoreSummary(added, updated))
    } catch (e) {
      showToast(message(e), 'error')
    }
  }

  const handleDelete = async (id: string) => {
    await storage.deleteBook(id)
    await refreshLibrary()
  }

  const handleMarkRead = async (book: BookMeta, read: boolean) => {
    await storage.setRead(book.id, read)
    // A book read to the end goes back to the start, or it would stay on the Read shelf.
    if (!read && readToEnd(book, progress[book.id])) await storage.saveProgress(book.id, 0)
    await refreshLibrary()
  }

  const bookId = open?.demo ? undefined : open?.book.id
  const handleProgress = useCallback(
    (index: number) => {
      lastIndex.current = index
      if (bookId) storage.saveProgress(bookId, index).catch(() => {})
    },
    [bookId],
  )

  // A book on the Read shelf stays there while it's only looked through
  // (opened, rewound, searched) and goes back to Reading once it's read
  // again. Closing a book at its end puts it on the Read shelf.
  const readAt = books.find((b) => b.id === bookId)?.readAt
  const handlePlay = useCallback(() => {
    if (!bookId || readAt === undefined) return
    setBooks((list) => list.map((b) => (b.id === bookId ? { ...b, readAt: undefined } : b)))
    storage.setRead(bookId, false).catch(() => {})
  }, [bookId, readAt])
  const handleClose = async () => {
    if (bookId && readAt === undefined && atEnd(open!.book.words.length, lastIndex.current)) {
      await storage.setRead(bookId, true)
    }
    await refreshLibrary()
  }

  const handleBookmarks = (next: Bookmark[]) => {
    setBookmarks(next)
    if (bookId) storage.saveBookmarks(bookId, next).catch(() => {})
  }

  const demo = !!open?.demo
  const handleReadingTime = useCallback(
    (ms: number, words: number) => {
      if (!demo) storage.recordReading(ms, words).catch(() => {})
    },
    [demo],
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
        lastReadAt={open.lastReadAt}
        settings={settings}
        onSettings={handleSettings}
        onProgress={handleProgress}
        bookmarks={bookmarks}
        onBookmarks={handleBookmarks}
        onReadingTime={handleReadingTime}
        onPlay={handlePlay}
        onClose={() => {
          navigate('back', () => setOpen(null))
          handleClose().catch(() => {})
        }}
      />
    )
  }

  if (browsing) {
    return (
      <Browse
        books={books}
        wpm={settings.wpm}
        onBack={() => navigate('back', () => setBrowsing(false))}
        onAdd={(file) => addBook(file, true)}
        onOpen={handleOpen}
      />
    )
  }

  return (
    <>
      <Library
        books={books}
        progress={progress}
        stats={stats}
        wpm={settings.wpm}
        busy={busy}
        error={error}
        lastBackup={lastBackup}
        storageKept={storageKept}
        showDemo={libraryLoaded && books.length === 0 && !busy}
        onDemo={handleDemo}
        onBrowse={() => navigate('forward', () => setBrowsing(true))}
        onUpload={handleUpload}
        onOpen={handleOpen}
        onDelete={handleDelete}
        onMarkRead={handleMarkRead}
        onBackup={handleBackup}
        onRestore={handleRestore}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
