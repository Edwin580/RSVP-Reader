import { createStore, del, get, set } from 'idb-keyval'
import type { WordTiming } from './rsvp'
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

export async function saveBook({ cover, ...book }: Book, fileName: string): Promise<BookMeta> {
  const library = await listBooks()
  const meta: BookMeta = {
    id: book.id,
    title: book.title,
    fileName,
    wordCount: book.words.length,
    addedAt: library.find((b) => b.id === book.id)?.addedAt ?? Date.now(),
    ...(cover && { cover }),
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
  /** Multiplier on the device-based word size (1 = default for this screen). */
  textScale: number
  /** 'natural' gives longer words slightly more time; 'even' shows every word equally long. */
  wordTiming: WordTiming
  /** 'word' flashes one word at a time; 'page' shows pages with a marker that follows along. */
  mode: ReadingMode
}

export type ReadingMode = 'word' | 'page'

export const DEFAULT_SETTINGS: Settings = { wpm: 300, textScale: 1, wordTiming: 'natural', mode: 'word' }

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return {
      wpm: typeof saved.wpm === 'number' ? saved.wpm : DEFAULT_SETTINGS.wpm,
      textScale: typeof saved.textScale === 'number' ? saved.textScale : DEFAULT_SETTINGS.textScale,
      wordTiming: saved.wordTiming === 'even' ? 'even' : DEFAULT_SETTINGS.wordTiming,
      mode: saved.mode === 'page' ? 'page' : DEFAULT_SETTINGS.mode,
    }
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
