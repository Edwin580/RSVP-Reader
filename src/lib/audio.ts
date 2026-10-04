import type { Chapter } from './types'
import type { TimedText } from './align'

/**
 * Listening along with an audiobook someone else recorded (a LibriVox
 * recording from the Internet Archive, a YouTube video, an MP3), with no
 * speech recognition: the book and the recording are lined up from
 * timestamps. A pasted transcript is matched to the text word for word
 * (align.ts); a recording's chapter tracks, or a video's chapter list
 * ("12:34 Chapter 3"), pin chapter starts; and tapping the word being heard
 * pins it to that moment. Between pinned points the narration is assumed to
 * go at a steady pace.
 */

/** One file of a recording made of several (a LibriVox book is one per chapter). */
export interface Track {
  url: string
  title: string
  seconds: number
}

export type AudioSource =
  | { kind: 'youtube'; videoId: string; url: string }
  /** A recording on the Internet Archive, played track after track as one. */
  | { kind: 'archive'; identifier: string; title: string; librivox: boolean; tracks: Track[] }
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
  /** Points pinned by hand, by tapping the word being heard. */
  points: SyncPoint[]
  /** Play the recording faster or slower to match the reading speed. Absent (older links) means on. */
  matchSpeed?: boolean
  /**
   * Points found from each file's sound (pauses.ts), by track number (0 for
   * a single file), in seconds into the whole recording. An empty list means
   * it was tried and nothing could be placed.
   */
  detected?: Record<string, SyncPoint[]>
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

export interface Timestamp extends TimedText {
  /** The words on the time's own line: a chapter's name in a chapter list. */
  label: string
}

const TIME = /((?:\d{1,2}:)?\d{1,2}:\d{2})(?:[.,]\d{1,3})?(?![\d:])/
const TIMES = new RegExp(TIME.source, 'g')
const AT_START = new RegExp(`^[\\s\\-–—•*([]*${TIME.source}`)

function seconds(time: string): number {
  return time.split(':').map(Number).reduce((total, part) => total * 60 + part, 0)
}

/**
 * Timed lines: a chapter list from a video's description ("0:00 Intro",
 * "1:02:03 - Chapter 12: The Trial", "Chapter 1 (12:40)"), or a transcript
 * copied from YouTube's "Show transcript" (a time, then the words spoken
 * until the next one) or a subtitle file (SRT, VTT).
 */
export function parseTimestamps(text: string): Timestamp[] {
  const found: Timestamp[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/<[^>]*>/g, '').trim()
    if (!line || /^\d+$/.test(line) || line === 'WEBVTT') continue
    const match = line.match(TIME)
    // A time starts a new entry when it opens the line, or anywhere in a short
    // line ("Chapter 2 (12:40)"); in a sentence it's just part of what was said.
    if (match && (AT_START.test(line) || line.split(/\s+/).length <= 12)) {
      const label = line
        .replace(TIMES, ' ')
        .replace(/-->/g, ' ')
        .replace(/[()[\]]/g, ' ')
        .replace(/^[\s\-–—:|.•*]+|[\s\-–—:|.•*]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      found.push({ seconds: seconds(match[1]), label, text: label })
    } else if (found.length) {
      const last = found[found.length - 1]
      last.text = last.text ? `${last.text} ${line}` : line
    }
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
    // "chap1", "AliceInWonderland_chap01" → "chap 1"
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
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

/** "Chapter 12", "Ch. XII", "chap12", "Chapters 12-14", "12. The Trial" → "12"; "Part 2" → "part 2"; otherwise null. */
function numberKey(title: string): string | null {
  const t = normalize(title.replace(/\b(chapter|ch|part|book)\s+i\b/gi, '$1 1'))
  const chapter = t.match(/\b(?:chapters?|chap|ch)\s+0*(\d+)\b/)
  if (chapter) return chapter[1]
  const m = t.match(/^(?:(part|book)\s+)?0*(\d+)\b/)
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

/** A LibriVox chapter opens with its announcement ("This is a LibriVox recording…") before the text. */
const LIBRIVOX_INTRO_SECONDS = 14

/** Where each track of a recording starts, as one timeline. */
export function trackStarts(tracks: Track[]): number[] {
  let total = 0
  return tracks.map((t) => {
    const start = total
    total += t.seconds
    return start
  })
}

/** The chapter each track of a recording starts, as the word it starts at, or null when its title names none. */
export function trackChapters(tracks: Track[], chapters: Chapter[]): (number | null)[] {
  // The track's number stands in for its time, to tell which matched.
  const found = matchChapters(
    tracks.map((t, k) => ({ seconds: k, label: t.title, text: t.title })),
    chapters,
  )
  return tracks.map((_, k) => found.find((p) => p.seconds === k)?.index ?? null)
}

/** Narrators read about 130–220 words a minute; a chapter that would take a pace outside this isn't the one recorded. */
const MIN_BELIEVABLE_PACE = 1.8
const MAX_BELIEVABLE_PACE = 4.6
const TYPICAL_PACE = 2.7

/** How far either side of a guessed start to look, in words, when a track doesn't say which chapter it is. */
const GUESS_WINDOW = 2500

/**
 * The part of the book to look for track `k` in, once its length is known.
 * A track named after a chapter covers that chapter, up to the next track's;
 * otherwise its start is guessed from what's already lined up, and looked
 * for either side of the guess.
 */
export function trackRange(
  tracks: Track[],
  k: number,
  chapters: Chapter[],
  points: SyncPoint[],
  wordCount: number,
  duration: number,
): { start: number; end: number; options: { lead?: number; openEnd?: boolean; audioRunsOn?: boolean } } {
  const starts = trackChapters(tracks, chapters)
  const start = starts[k]
  const next = starts[k + 1]
  /** Words a second it would take the narrator to read the text from `start` to `end` in this file. */
  const paceTo = (end: number) => (end - (start ?? 0)) / Math.max(duration * 0.92, 1)
  // Named after a chapter, and so is the next track: it covers the chapters between,
  // unless that's too little text for the recording (an excerpt, or an abridged
  // edition), when the recording runs on after the text, or too much.
  if (start !== null && start !== undefined && next !== null && next !== undefined && next > start) {
    const pace = paceTo(next)
    if (pace < MIN_BELIEVABLE_PACE) return { start, end: next, options: { audioRunsOn: true } }
    if (pace > MAX_BELIEVABLE_PACE) return { start, end: next, options: { lead: 0, openEnd: true } }
    return { start, end: next, options: {} }
  }
  // The last track (or one before a track named after nothing): it ends at
  // whichever chapter break later on makes for a believable narration pace
  // (chapters are long, so there's rarely more than one); if none does
  // (the book runs on with an afterword or a licence), where it ends is
  // found from its sound.
  if (start !== null && start !== undefined) {
    const believable = [...chapters.map((c) => c.start).filter((c) => c > start), wordCount]
      .map((end) => ({ end, pace: (end - start) / Math.max(duration * 0.92, 1) }))
      .filter((c) => c.pace >= MIN_BELIEVABLE_PACE && c.pace <= MAX_BELIEVABLE_PACE)
      .sort((a, b) => Math.abs(a.pace - TYPICAL_PACE) - Math.abs(b.pace - TYPICAL_PACE))
    if (believable.length > 0) return { start, end: believable[0].end, options: {} }
    // Even the rest of the book is too little for the recording: an excerpt of what it reads.
    if (paceTo(wordCount) < MIN_BELIEVABLE_PACE) return { start, end: wordCount, options: { audioRunsOn: true } }
  }
  const guess = start ?? wordAt(points, trackStarts(tracks)[k] ?? 0, wordCount)
  const from = Math.max(0, guess - (start === null || start === undefined ? GUESS_WINDOW : 0))
  const lead = guess - from + (start === null || start === undefined ? GUESS_WINDOW : 0)
  const end = Math.min(wordCount, Math.ceil(from + lead + duration * NARRATION_WORDS_PER_SECOND * 2 + 500))
  return { start: from, end, options: { lead, openEnd: true } }
}

/** Which track plays `seconds` into the whole recording. */
export function trackAt(tracks: Track[], seconds: number): number {
  const starts = trackStarts(tracks)
  let k = 0
  while (k + 1 < starts.length && starts[k + 1] <= seconds) k++
  return k
}

/** Chapter starts pinned by the recording's tracks and the pasted chapter list. */
function chapterPoints(link: AudioLink, chapters: Chapter[]): SyncPoint[] {
  const { source } = link
  const fromTracks =
    source.kind === 'archive'
      ? matchChapters(
          trackStarts(source.tracks).map((start, k) => {
            const title = source.tracks[k].title
            return { seconds: start + (source.librivox ? LIBRIVOX_INTRO_SECONDS : 0), label: title, text: title }
          }),
          chapters,
        )
      : []
  return [...fromTracks, ...matchChapters(parseTimestamps(link.timestamps), chapters)]
}

/**
 * The points to line up by: hand-set points first, then a matched
 * transcript's, then chapter starts, each kept only where it agrees with
 * those already there (later in the book means later in the recording).
 * Sorted by position.
 */
export function syncPoints(link: AudioLink, chapters: Chapter[], transcript: SyncPoint[] = []): SyncPoint[] {
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
  for (const p of transcript) add(p)
  for (const p of Object.values(link.detected ?? {}).flat()) add(p)
  for (const p of chapterPoints(link, chapters)) add(p)
  return kept
}

function rate(a: SyncPoint, b: SyncPoint): number {
  const r = (b.index - a.index) / (b.seconds - a.seconds)
  return Number.isFinite(r) && r >= MIN_RATE && r <= MAX_RATE ? r : NARRATION_WORDS_PER_SECOND
}

/** The first point after `value` by `key`, by binary search (points are in order). */
function after(points: SyncPoint[], value: number, key: 'index' | 'seconds'): number {
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid][key] > value) hi = mid
    else lo = mid + 1
  }
  return lo
}

/**
 * Letters said before each word (one more entry than words): between two
 * points, time goes with letters said rather than words, since long words
 * take longer to say.
 */
export function spokenLetters(words: string[]): Float64Array {
  const out = new Float64Array(words.length + 1)
  for (let i = 0; i < words.length; i++) out[i + 1] = out[i] + words[i].replace(/[^\p{L}\p{N}]/gu, '').length
  return out
}

/** Where in the recording the word at `index` is read, in seconds (never negative). */
export function timeAt(points: SyncPoint[], index: number, letters?: ArrayLike<number>): number {
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
  const k = after(points, index, 'index')
  const a = points[k - 1]
  const b = points[k]
  const pos = (i: number) => (letters ? letters[i] : i)
  const span = pos(b.index) - pos(a.index)
  const share = span > 0 ? (pos(index) - pos(a.index)) / span : (index - a.index) / (b.index - a.index)
  return a.seconds + share * (b.seconds - a.seconds)
}

/** The word being read `seconds` into the recording, within a book of `count` words. */
export function wordAt(points: SyncPoint[], seconds: number, count: number, letters?: ArrayLike<number>): number {
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
  const k = after(points, seconds, 'seconds')
  const a = points[k - 1]
  const b = points[k]
  const share = (seconds - a.seconds) / (b.seconds - a.seconds)
  if (!letters || letters[b.index] <= letters[a.index]) return clamp(a.index + share * (b.index - a.index))
  // The word whose letters are being said at that share of the stretch.
  const target = letters[a.index] + share * (letters[b.index] - letters[a.index])
  let lo = a.index
  let hi = b.index
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (letters[mid] <= target) lo = mid
    else hi = mid
  }
  return clamp(lo)
}

/** Pin the word at `index` to `seconds`, replacing any hand-set point within a few words of it. */
export function addPoint(points: SyncPoint[], index: number, seconds: number): SyncPoint[] {
  const near = 20
  return [...points.filter((p) => Math.abs(p.index - index) > near), { index, seconds }]
}

/** Words either side of a spot to measure the narrator's pace over, so a pause or a quick line doesn't swing it. */
const PACE_WINDOW = 200

/** How fast the narrator reads around the word at `index`, in words a second. */
export function paceAt(points: SyncPoint[], index: number): number {
  if (points.length < 2) return NARRATION_WORDS_PER_SECOND
  let a = 0
  while (a + 1 < points.length - 1 && points[a + 1].index <= index - PACE_WINDOW) a++
  let b = points.length - 1
  while (b - 1 > a && points[b - 1].index >= index + PACE_WINDOW) b--
  return rate(points[a], points[b])
}

/** Playback speeds a player allows; outside them speech turns to chipmunks or mud. */
export const MIN_SPEED = 0.5
export const MAX_SPEED = 2

/** How fast to play the recording so the narrator reads at `wpm`, rounded to a twentieth. */
export function speedFor(wpm: number, wordsPerSecond: number): number {
  const speed = wpm / 60 / wordsPerSecond
  return Math.round(Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed)) * 20) / 20
}

/** Searching YouTube needs a key this app doesn't have, so this opens YouTube's own search. */
export function youTubeSearch(title: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} audiobook`)}`
}
