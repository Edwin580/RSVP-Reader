import { createStore, del, get, set } from 'idb-keyval'
import type { Book, BookMeta, Progress } from './types'

/**
 * Local-first persistence in IndexedDB. Keeping all access behind these
 * functions means they can later be swapped for (or synced with) a backend.
 */
const store = createStore('rsvp-reader', 'kv')

const LIBRARY_KEY = 'library'
const bookKey = (id: string) => `book:${id}`
const progressKey = (id: string) => `progress:${id}`

export async function listBooks(): Promise<BookMeta[]> {
  return (await get<BookMeta[]>(LIBRARY_KEY, store)) ?? []
}

export async function saveBook(book: Book, fileName: string): Promise<BookMeta> {
  const library = await listBooks()
  const meta: BookMeta = {
    id: book.id,
    title: book.title,
    fileName,
    wordCount: book.words.length,
    addedAt: library.find((b) => b.id === book.id)?.addedAt ?? Date.now(),
  }
  await set(bookKey(book.id), book, store)
  await set(LIBRARY_KEY, [meta, ...library.filter((b) => b.id !== book.id)], store)
  return meta
}

export function loadBook(id: string): Promise<Book | undefined> {
  return get<Book>(bookKey(id), store)
}

export async function deleteBook(id: string): Promise<void> {
  const library = await listBooks()
  await set(LIBRARY_KEY, library.filter((b) => b.id !== id), store)
  await del(bookKey(id), store)
  await del(progressKey(id), store)
}

export function loadProgress(id: string): Promise<Progress | undefined> {
  return get<Progress>(progressKey(id), store)
}

export function saveProgress(id: string, index: number): Promise<void> {
  return set(progressKey(id), { index, updatedAt: Date.now() } satisfies Progress, store)
}

const SETTINGS_KEY = 'rsvp-settings'

export interface Settings {
  wpm: number
  fontSize: number
}

export const DEFAULT_SETTINGS: Settings = { wpm: 300, fontSize: 56 }

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable (private mode etc.) — settings just won't persist.
  }
}
