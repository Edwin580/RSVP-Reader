import type { Chapter } from './types'

/**
 * Listening along with an audiobook someone else recorded (a YouTube video,
 * a LibriVox MP3, a file on the device), with no speech recognition: the
 * book and the recording are lined up from timestamps. A video's chapter
 * list ("12:34 Chapter 3") pins chapter starts, and "Sync here" pins the
 * word being read to the moment being heard. Between pinned points the
 * narration is assumed to go at a steady pace.
 */

export type AudioSource =
  | { kind: 'youtube'; videoId: string; url: string }
  | { kind: 'url'; url: string }
  /** A file on this device; the file itself is stored separately (storage.ts). */
  | { kind: 'file'; name: string }

/** The word at `index` is heard `seconds` into the recording. */
export interface SyncPoint {
  index: number
  seconds: number
}

export interface AudioLink {
  source: AudioSource
  /** Timestamps as pasted, usually a video's chapter list. */
  timestamps: string
  /** Points pinned by hand with "Sync here". */
  points: SyncPoint[]
}

/** A typical audiobook narration pace (about 155 wpm), used until there's a better guess. */
export const NARRATION_WORDS_PER_SECOND = 2.6
/** Paces outside this range come from points set too close together; never extrapolate from them. */
const MIN_RATE = 1
const MAX_RATE = 6

/** The video id in a YouTube link (watch, youtu.be, shorts, embed, live, music), or null. */
export function youTubeId(link: string): string | null {
  let url: URL
  try {
    url = new URL(link.trim().match(/^https?:\/\//i) ? link.trim() : `https://${link.trim()}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  const valid = (id: string | null | undefined) => (id && /^[\w-]{11}$/.test(id) ? id : null)
  if (host === 'youtu.be') return valid(url.pathname.split('/')[1])
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null
  if (url.pathname === '/watch') return valid(url.searchParams.get('v'))
  const [, kind, id] = url.pathname.split('/')
  return ['shorts', 'embed', 'live', 'v'].includes(kind) ? valid(id) : null
}

/** What a pasted link points at: a YouTube video, or an audio file on the web. */
export function sourceFromLink(link: string): AudioSource | null {
  const videoId = youTubeId(link)
  if (videoId) return { kind: 'youtube', videoId, url: link.trim() }
  try {
    const url = new URL(link.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? { kind: 'url', url: url.href } : null
  } catch {
    return null
  }
}

/** Seconds as "4:05" or "1:02:03". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export interface Timestamp {
  seconds: number
  label: string
}

const TIME = /(?:^|[^\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/

/**
 * Lines with a time in them, as in a YouTube description's chapter list:
 * "0:00 Intro", "1:02:03 - Chapter 12: The Trial", "Chapter 1 (12:40)".
 */
export function parseTimestamps(text: string): Timestamp[] {
  const found: Timestamp[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(TIME)
    if (!match) continue
    const parts = match[1].split(':').map(Number)
    const seconds = parts.reduce((total, part) => total * 60 + part, 0)
    const label = line
      .replace(match[1], ' ')
      .replace(/[()[\]]/g, ' ')
      .replace(/^[\s\-–—:|.•*]+|[\s\-–—:|.•*]+$/g, '')
      .trim()
    found.push({ seconds, label })
  }
  return found
}

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
]

function romanValue(s: string): number | null {
  if (!/^[ivxlc]+$/.test(s)) return null
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }
  let total = 0
  for (let k = 0; k < s.length; k++) {
    const v = values[s[k]]
    total += v < (values[s[k + 1]] ?? 0) ? -v : v
  }
  return total
}

/** Lower case, no punctuation or accents, with numbers in any spelling as digits. */
function normalize(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => {
      const spelled = NUMBER_WORDS.indexOf(word)
      if (spelled >= 0) return String(spelled)
      // "I" alone is a word as often as a numeral; take it only after "chapter"/"part"/"book".
      const roman = word === 'i' ? null : romanValue(word)
      return roman !== null ? String(roman) : word
    })
    .join(' ')
}

/** "Chapter 12", "Ch. XII", "12. The Trial" → "12"; "Part 2" → "part 2"; otherwise null. */
function numberKey(title: string): string | null {
  const t = normalize(title.replace(/\b(chapter|ch|part|book)\s+i\b/gi, '$1 1'))
  const m = t.match(/^(?:(part|book)\s+)?(?:chapter\s+|ch\s+)?(\d+)\b/)
  if (!m) return null
  return m[1] ? `${m[1]} ${m[2]}` : m[2]
}

/**
 * Pins each timestamp to the chapter it names. Titles are compared loosely
 * ("Chapter One" = "CHAPTER I." = "Chapter 1: Down the Rabbit-Hole"), in
 * order, so a repeated title matches the next one along. When nothing
 * matches by name but there's one timestamp per chapter, they're paired in
 * order. Timestamps naming no chapter (an intro, credits) are left out.
 */
export function matchChapters(stamps: Timestamp[], chapters: Chapter[]): SyncPoint[] {
  if (chapters.length === 0) return []
  const titles = chapters.map((c) => ({ text: normalize(c.title), key: numberKey(c.title) }))
  const points: SyncPoint[] = []
  let from = 0
  for (const stamp of stamps) {
    const text = normalize(stamp.label)
    const key = numberKey(stamp.label)
    if (!text) continue
    for (let c = from; c < chapters.length; c++) {
      const title = titles[c]
      const same =
        title.text === text ||
        (title.text.length >= 4 && text.includes(title.text)) ||
        (text.length >= 4 && title.text.includes(text)) ||
        (key !== null && key === title.key)
      if (same) {
        points.push({ index: chapters[c].start, seconds: stamp.seconds })
        from = c + 1
        break
      }
    }
  }
  if (points.length === 0 && stamps.length === chapters.length) {
    return stamps.map((s, c) => ({ index: chapters[c].start, seconds: s.seconds }))
  }
  return points
}

/**
 * The points to line up by: hand-set points first, then chapter timestamps
 * wherever they agree with them (later in the book means later in the
 * recording). Sorted by position.
 */
export function syncPoints(link: AudioLink, chapters: Chapter[]): SyncPoint[] {
  const kept: SyncPoint[] = []
  const add = (p: SyncPoint) => {
    const at = kept.findIndex((k) => k.index >= p.index)
    const next = at < 0 ? undefined : kept[at]
    const prev = at < 0 ? kept[kept.length - 1] : kept[at - 1]
    if (next?.index === p.index) return
    if ((prev && prev.seconds >= p.seconds) || (next && next.seconds <= p.seconds)) return
    kept.splice(at < 0 ? kept.length : at, 0, p)
  }
  // The most recent hand-set point wins over older ones it disagrees with.
  for (const p of [...link.points].reverse()) add(p)
  for (const p of matchChapters(parseTimestamps(link.timestamps), chapters)) add(p)
  return kept
}

function rate(a: SyncPoint, b: SyncPoint): number {
  const r = (b.index - a.index) / (b.seconds - a.seconds)
  return Number.isFinite(r) && r >= MIN_RATE && r <= MAX_RATE ? r : NARRATION_WORDS_PER_SECOND
}

/** Where in the recording the word at `index` is read, in seconds (never negative). */
export function timeAt(points: SyncPoint[], index: number): number {
  if (points.length === 0) return index / NARRATION_WORDS_PER_SECOND
  const first = points[0]
  const last = points[points.length - 1]
  if (index <= first.index) {
    const r = points.length > 1 ? rate(first, points[1]) : NARRATION_WORDS_PER_SECOND
    return Math.max(0, first.seconds - (first.index - index) / r)
  }
  if (index >= last.index) {
    const r = points.length > 1 ? rate(points[points.length - 2], last) : NARRATION_WORDS_PER_SECOND
    return last.seconds + (index - last.index) / r
  }
  const k = points.findIndex((p) => p.index > index)
  const a = points[k - 1]
  const b = points[k]
  return a.seconds + ((index - a.index) / (b.index - a.index)) * (b.seconds - a.seconds)
}

/** The word being read `seconds` into the recording, within a book of `count` words. */
export function wordAt(points: SyncPoint[], seconds: number, count: number): number {
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, Math.floor(i)))
  if (points.length === 0) return clamp(seconds * NARRATION_WORDS_PER_SECOND)
  const first = points[0]
  const last = points[points.length - 1]
  if (seconds <= first.seconds) {
    const r = points.length > 1 ? rate(first, points[1]) : NARRATION_WORDS_PER_SECOND
    return clamp(first.index - (first.seconds - seconds) * r)
  }
  if (seconds >= last.seconds) {
    const r = points.length > 1 ? rate(points[points.length - 2], last) : NARRATION_WORDS_PER_SECOND
    return clamp(last.index + (seconds - last.seconds) * r)
  }
  const k = points.findIndex((p) => p.seconds > seconds)
  const a = points[k - 1]
  const b = points[k]
  return clamp(a.index + ((seconds - a.seconds) / (b.seconds - a.seconds)) * (b.index - a.index))
}

/** Pin the word at `index` to `seconds`, replacing any hand-set point within a few words of it. */
export function addPoint(points: SyncPoint[], index: number, seconds: number): SyncPoint[] {
  const near = 20
  return [...points.filter((p) => Math.abs(p.index - index) > near), { index, seconds }]
}

/** Searches to find a recording of a book; opened in a new tab, nothing is fetched here. */
export function findLinks(title: string): { label: string; url: string }[] {
  const q = encodeURIComponent(title)
  return [
    { label: 'YouTube', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} audiobook`)}` },
    { label: 'LibriVox', url: `https://librivox.org/search?q=${q}&search_form=advanced` },
    { label: 'Internet Archive', url: `https://archive.org/search?query=${q}&and%5B%5D=mediatype%3A%22audio%22` },
  ]
}
