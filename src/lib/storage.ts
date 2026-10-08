import { createStore, del, entries, get, set, setMany, update } from 'idb-keyval'
import { storageName } from './preview'
import { WORD_TIMINGS, type WordTiming } from './rsvp'
import { addReading, EMPTY_STATS, type ReadingStats } from './stats'
import type { Book, BookMeta, Bookmark, Progress } from './types'

/**
 * Local-first persistence in IndexedDB. Keeping all access behind these
 * functions means they can later be swapped for (or synced with) a backend.
 */
// Named from the app's old name (RSVP Reader); renaming it would lose everyone's saved books.
const store = createStore(storageName('rsvp-reader'), 'kv')

const LIBRARY_KEY = 'library'
const bookKey = (id: string) => `book:${id}`
const progressKey = (id: string) => `progress:${id}`
const bookmarksKey = (id: string) => `bookmarks:${id}`

export async function listBooks(): Promise<BookMeta[]> {
  return (await get<BookMeta[]>(LIBRARY_KEY, store)) ?? []
}

export async function saveBook({ cover, ...book }: Book, fileName: string): Promise<BookMeta> {
  const library = await listBooks()
  const existing = library.find((b) => b.id === book.id)
  const meta: BookMeta = {
    id: book.id,
    title: book.title,
    fileName,
    wordCount: book.words.length,
    addedAt: existing?.addedAt ?? Date.now(),
    ...(cover && { cover }),
    ...(existing?.readAt && { readAt: existing.readAt }),
  }
  await set(bookKey(book.id), book, store)
  await set(LIBRARY_KEY, [meta, ...library.filter((b) => b.id !== book.id)], store)
  return meta
}

/** Mark a book as read (or not), keeping the reading position. */
export async function setRead(id: string, read: boolean): Promise<void> {
  const library = await listBooks()
  const marked = library.map((book) => {
    if (book.id !== id) return book
    const { readAt: _, ...rest } = book
    return read ? { ...rest, readAt: Date.now() } : rest
  })
  await set(LIBRARY_KEY, marked, store)
}

export function loadBook(id: string): Promise<Book | undefined> {
  return get<Book>(bookKey(id), store)
}

export async function deleteBook(id: string): Promise<void> {
  const library = await listBooks()
  await set(LIBRARY_KEY, library.filter((b) => b.id !== id), store)
  await del(bookKey(id), store)
  await del(progressKey(id), store)
  await del(bookmarksKey(id), store)
}

export function loadProgress(id: string): Promise<Progress | undefined> {
  return get<Progress>(progressKey(id), store)
}

export function saveProgress(id: string, index: number): Promise<void> {
  return set(progressKey(id), { index, updatedAt: Date.now() } satisfies Progress, store)
}

export async function loadBookmarks(id: string): Promise<Bookmark[]> {
  return (await get<Bookmark[]>(bookmarksKey(id), store)) ?? []
}

export function saveBookmarks(id: string, bookmarks: Bookmark[]): Promise<void> {
  return set(bookmarksKey(id), bookmarks, store)
}

/** Every stored entry, for backups. */
export async function allEntries(): Promise<[string, unknown][]> {
  const all = await entries<IDBValidKey, unknown>(store)
  return all.filter((e): e is [string, unknown] => typeof e[0] === 'string')
}

export function writeEntries(writes: [string, unknown][]): Promise<void> {
  return setMany(writes, store)
}

/**
 * Ask the browser not to clear our data when space runs low or the site
 * goes unused for a while (Safari clears it after about a week otherwise).
 * Browsers decide for themselves; returns whether storage is now kept.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch {
    return false
  }
}

const LAST_BACKUP_KEY = storageName('rsvp-last-backup')

/** When a backup was last saved from this browser (ms), or null if never. */
export function loadLastBackup(): number | null {
  try {
    const value = Number(localStorage.getItem(LAST_BACKUP_KEY))
    return value > 0 ? value : null
  } catch {
    return null
  }
}

export function saveLastBackup(at: number): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(at))
  } catch {
    // Storage unavailable: the "last backed up" note just won't show.
  }
}

const STATS_KEY = 'stats'

export async function loadStats(): Promise<ReadingStats> {
  return (await get<ReadingStats>(STATS_KEY, store)) ?? EMPTY_STATS
}

/** Add a stretch of reading to today's totals. */
export function recordReading(ms: number, words: number): Promise<void> {
  return update<ReadingStats>(STATS_KEY, (stats) => addReading(stats ?? EMPTY_STATS, new Date(), ms, words), store)
}

// Old name kept, like the database, so settings carry over.
const SETTINGS_KEY = storageName('rsvp-settings')
/** Bumped when a saved setting needs moving to a new default; see loadSettings. */
const SETTINGS_VERSION = 2

export interface Settings {
  wpm: number
  /** Multiplier on the device-based word size (1 = default for this screen). */
  textScale: number
  /** 'natural' gives longer words slightly more time; 'even' shows every word equally long. */
  wordTiming: WordTiming
  /** 'word' flashes one word at a time; 'page' shows pages with a marker that follows along. */
  mode: ReadingMode
  /** 'system' follows the device's light/dark setting. */
  theme: Theme
  /** Typeface for the book's text; the controls always use the system font. */
  font: ReadingFont
  /** Colour of the focus letter, page marker and pacer. */
  accent: Accent
  /** The colour picked for accent 'custom', as '#rrggbb'. */
  customColor: string
  /**
   * Page mode: how the current word is marked. 'highlight' is a soft box on
   * the word, 'pacer' a thin line sweeping along under the line, 'both' both,
   * 'none' neither, for reading the page as it is.
   */
  pageGuide: PageGuide
  /**
   * Page mode: black out all but the line being read ('one'), or it and the
   * lines either side ('three').
   */
  lineFocus: LineFocus
  /**
   * 'tap' starts and stops reading with a tap; 'hold' reads only while you
   * hold the text. 'guide' (page mode) has no timer: hold anywhere and drag
   * to move the line focus line by line, or tap a line. 'free' (page mode)
   * has no timer and no marker: you read the page as it is and turn pages
   * yourself, like an e-reader.
   */
  playControl: PlayControl
  /** Guide: the text as pages you turn, or one continuous column that scrolls along. */
  guideLayout: GuideLayout
  /** Guide: how the line you're on is shown: the rest blacked out ('focus'), a line under it ('line'), or both. */
  guideMark: GuideMark
}

export type ReadingMode = 'word' | 'page'
export type Theme = 'system' | 'light' | 'sepia' | 'dark'
export type ReadingFont = 'sans' | 'serif'
export type Accent = 'red' | 'blue' | 'green' | 'purple' | 'custom'
export type PlayControl = 'tap' | 'hold' | 'guide' | 'free'
export type GuideLayout = 'pages' | 'scroll'
export type GuideMark = 'focus' | 'line' | 'both'
export type PageGuide = 'highlight' | 'pacer' | 'both' | 'none'
export type LineFocus = 'off' | 'one' | 'three'

export const THEMES: Theme[] = ['system', 'light', 'sepia', 'dark']
export const FONTS: ReadingFont[] = ['serif', 'sans']
export const ACCENTS: Accent[] = ['red', 'blue', 'green', 'purple', 'custom']
export const PLAY_CONTROLS: PlayControl[] = ['tap', 'hold', 'guide', 'free']
export const GUIDE_LAYOUTS: GuideLayout[] = ['pages', 'scroll']
export const GUIDE_MARKS: GuideMark[] = ['focus', 'line', 'both']
export const PAGE_GUIDES: PageGuide[] = ['highlight', 'pacer', 'both', 'none']
export const LINE_FOCUSES: LineFocus[] = ['off', 'one', 'three']

export const DEFAULT_SETTINGS: Settings = {
  wpm: 300,
  textScale: 1,
  wordTiming: 'smart',
  mode: 'word',
  theme: 'system',
  font: 'serif',
  accent: 'red',
  customColor: '#c2410c',
  pageGuide: 'both',
  lineFocus: 'off',
  playControl: 'tap',
  guideLayout: 'pages',
  guideMark: 'focus',
}

/** A plain '#rrggbb' colour, the only kind the colour picker gives and the page accepts. */
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

const oneOf = <T,>(options: readonly T[], value: unknown, fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return {
      wpm: typeof saved.wpm === 'number' ? saved.wpm : DEFAULT_SETTINGS.wpm,
      textScale: typeof saved.textScale === 'number' ? saved.textScale : DEFAULT_SETTINGS.textScale,
      wordTiming: oneOf(WORD_TIMINGS, saved.wordTiming, DEFAULT_SETTINGS.wordTiming),
      mode: saved.mode === 'page' ? 'page' : DEFAULT_SETTINGS.mode,
      theme: oneOf(THEMES, saved.theme, DEFAULT_SETTINGS.theme),
      // Sans was the default before the book design (settings version 2), so a
      // sans saved from then moves to the new serif; a later pick sticks.
      font: oneOf(FONTS, saved.v >= 2 || saved.font !== 'sans' ? saved.font : undefined, DEFAULT_SETTINGS.font),
      accent: oneOf(ACCENTS, saved.accent, DEFAULT_SETTINGS.accent),
      customColor: isHexColor(saved.customColor) ? saved.customColor.toLowerCase() : DEFAULT_SETTINGS.customColor,
      pageGuide: oneOf(PAGE_GUIDES, saved.pageGuide, guideFromSwitches(saved.pageHighlight, saved.pacer)),
      lineFocus: oneOf(LINE_FOCUSES, saved.lineFocus, DEFAULT_SETTINGS.lineFocus),
      playControl: oneOf(PLAY_CONTROLS, saved.playControl, DEFAULT_SETTINGS.playControl),
      guideLayout: oneOf(GUIDE_LAYOUTS, saved.guideLayout, DEFAULT_SETTINGS.guideLayout),
      guideMark: oneOf(GUIDE_MARKS, saved.guideMark, DEFAULT_SETTINGS.guideMark),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** The guide from the two old switches; both off (no guide at all) becomes both on. */
function guideFromSwitches(highlight: unknown, pacer: unknown): PageGuide {
  if (highlight === false && pacer !== false) return 'pacer'
  if (pacer === false && highlight !== false) return 'highlight'
  return 'both'
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, v: SETTINGS_VERSION }))
  } catch {
    // Storage unavailable (private mode etc.) — settings just won't persist.
  }
}
