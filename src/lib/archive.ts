import type { AudioSource, Track } from './audio'

/**
 * Finding a recording of a book on the Internet Archive, home of every
 * LibriVox audiobook (free, public-domain books read by volunteers). Its
 * search and file lists can be read straight from the browser, and a
 * LibriVox book comes as one file per chapter, titled, with its length:
 * exactly what's needed to start at the chapter being read.
 */

export interface Recording {
  identifier: string
  title: string
  creator: string
  librivox: boolean
}

const API = 'https://archive.org'
/** Smallest first: an audiobook is long, and phones are often on data. */
const FORMATS = ['64Kbps MP3', 'VBR MP3', '128Kbps MP3', 'MP3']

/** The words of a title worth searching for: no file extension, "by …", or punctuation. */
export function searchTerms(title: string): string {
  return title
    .replace(/\.(epub|pdf|txt|md)$/i, '')
    .replace(/\s+by\s+.*$/i, '')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The "Author: Lewis Carroll" line at the top of a Project Gutenberg text. */
export function gutenbergAuthor(opening: string): string | undefined {
  return opening.match(/^\s*Author:\s*(.+?)\s*$/im)?.[1] || undefined
}

/**
 * The surname to search for: "Lewis Carroll" and "Carroll, Lewis" → "Carroll".
 * Catalogues write names differently, but rarely the surname.
 */
export function authorTerm(author: string | undefined): string {
  if (!author) return ''
  const name = author.split(/\s*(?:;|&|\band\b)\s*/)[0].replace(/,?\s+(jr|sr|ii|iii)\.?$/i, '')
  const surname = name.includes(',') ? name.split(',')[0] : name.split(/\s+/).pop()
  return (surname ?? '').replace(/[^\p{L}'-]+/gu, '').replace(/'/g, '')
}

/** "Pride and Prejudice by Jane Austen" → "Jane Austen", for books whose file only has a title. */
export function authorFromTitle(title: string): string | undefined {
  return title.match(/\s+by\s+(.+)$/i)?.[1]?.trim() || undefined
}

export function searchUrl(title: string, librivoxOnly: boolean, author?: string): string {
  const terms = searchTerms(title).replace(/'/g, '')
  const surname = authorTerm(author)
  const q = `title:(${terms})${surname ? ` AND creator:(${surname})` : ''} AND mediatype:(audio)${librivoxOnly ? ' AND collection:(librivoxaudio)' : ''}`
  const params = new URLSearchParams({ q, rows: '8', output: 'json' })
  for (const f of ['identifier', 'title', 'creator']) params.append('fl[]', f)
  params.append('sort[]', 'downloads desc')
  return `${API}/advancedsearch.php?${params}`
}

const first = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '')

export function parseSearch(json: unknown, librivox: boolean): Recording[] {
  const docs = (json as { response?: { docs?: unknown[] } })?.response?.docs
  if (!Array.isArray(docs)) return []
  return docs
    .map((d) => d as Record<string, unknown>)
    .filter((d) => typeof d.identifier === 'string')
    .map((d) => ({ identifier: d.identifier as string, title: first(d.title), creator: first(d.creator), librivox }))
}

/**
 * Recordings of the book: by its author first (a title alone finds every
 * book of that name), LibriVox before other audio, then by title alone if
 * that finds too few.
 */
export async function searchRecordings(title: string, author?: string, fetcher: typeof fetch = fetch): Promise<Recording[]> {
  if (!searchTerms(title)) return []
  const found: Recording[] = []
  const get = async (librivox: boolean, by?: string) => {
    const response = await fetcher(searchUrl(title, librivox, by))
    if (!response.ok) throw new Error(`The Internet Archive answered ${response.status}.`)
    const seen = new Set(found.map((r) => r.identifier))
    found.push(...parseSearch(await response.json(), librivox).filter((r) => !seen.has(r.identifier)))
  }
  const stages: [boolean, string | undefined][] = authorTerm(author)
    ? [[true, author], [false, author], [true, undefined], [false, undefined]]
    : [[true, undefined], [false, undefined]]
  for (const [librivox, by] of stages) {
    await get(librivox, by)
    if (found.length >= 3) break
  }
  return found.slice(0, 8)
}

/** "13:16", "1:02:03" or "796.5" as seconds. */
export function parseLength(length: unknown): number {
  if (typeof length === 'number') return length
  if (typeof length !== 'string') return 0
  if (length.includes(':')) return length.split(':').map(Number).reduce((total, part) => total * 60 + part, 0)
  return Number(length) || 0
}

interface ArchiveFile {
  name?: string
  format?: string
  title?: string
  length?: string
  track?: string
}

/** A recording's audio files in order, in the one format that has them all (each format is a full copy). */
export function tracksFromMetadata(identifier: string, json: unknown): Track[] {
  const files = ((json as { files?: ArchiveFile[] })?.files ?? []).filter((f) => f.name)
  const format = FORMATS.find((fmt) => files.some((f) => f.format === fmt))
  if (!format) return []
  // Track numbers live on the original files only ("3/12"); file names sort the same way.
  return files
    .filter((f) => f.format === format)
    .sort((a, b) => a.name!.localeCompare(b.name!, undefined, { numeric: true }))
    .map((f) => ({
      url: `${API}/download/${encodeURIComponent(identifier)}/${f.name!.split('/').map(encodeURIComponent).join('/')}`,
      title: f.title || f.name!.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
      seconds: parseLength(f.length),
    }))
    .filter((t) => t.seconds > 0)
}

export async function loadRecording(recording: Recording, fetcher: typeof fetch = fetch): Promise<AudioSource> {
  const response = await fetcher(`${API}/metadata/${encodeURIComponent(recording.identifier)}`)
  if (!response.ok) throw new Error(`The Internet Archive answered ${response.status}.`)
  const tracks = tracksFromMetadata(recording.identifier, await response.json())
  if (!tracks.length) throw new Error('This recording has no MP3 files to play.')
  return { kind: 'archive', identifier: recording.identifier, title: recording.title, librivox: recording.librivox, tracks }
}
