import { useCallback, useEffect, useState } from 'react'
import { Library } from './components/Library'
import { Reader } from './components/Reader'
import { Toast, type ToastMessage } from './components/Toast'
import { navigate } from './components/transition'
import { applyAppearance } from './lib/appearance'
import { backupFileName, createBackup, mergeBackup, parseBackup, restoreSummary } from './lib/backup'
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
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [lastBackup, setLastBackup] = useState(storage.loadLastBackup)
  // Whether the browser has promised not to clear our storage (null = unknown).
  const [storageKept, setStorageKept] = useState<boolean | null>(null)
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

  const clearToast = useCallback(() => setToast(null), [])
  const showToast = (text: string, tone: ToastMessage['tone'] = 'ok') => setToast({ text, tone, id: Date.now() })

  const handleBackup = async () => {
    try {
      const backup = createBackup(await storage.allEntries())
      const name = backupFileName(new Date())
      const file = new File([JSON.stringify(backup)], name, { type: 'application/json' })
      // Phones: the share sheet saves to Files or iCloud, or AirDrops to another device.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Library backup' })
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return // closed the share sheet
          throw e
        }
      } else {
        const url = URL.createObjectURL(file)
        const link = document.createElement('a')
        link.href = url
        link.download = name
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
      const now = Date.now()
      storage.saveLastBackup(now)
      setLastBackup(now)
      showToast(`Backup saved: ${books.length} ${books.length === 1 ? 'book' : 'books'} with reading positions.`)
    } catch (e) {
      showToast(`Couldn't save a backup: ${message(e)}`, 'error')
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
        onReadingTime={handleReadingTime}
        onClose={() => {
          navigate('back', () => setOpen(null))
          refreshLibrary().catch(() => {})
        }}
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
        onUpload={handleUpload}
        onOpen={handleOpen}
        onDelete={handleDelete}
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
