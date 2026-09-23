/**
 * Phrase search over a book's words, ignoring case, punctuation and accents,
 * so "cold day in april" finds "cold day in April,".
 */

export interface SearchIndex {
  /** Normalised words joined by single spaces. */
  text: string
  /** Character offset in `text` where each indexed word starts. */
  offsets: number[]
  /** Book word index for each entry in `offsets`. */
  wordIndices: number[]
}

export interface SearchMatch {
  /** Index of the first matched word. */
  start: number
  /** Index of the last matched word. */
  end: number
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
}

export function buildSearchIndex(words: string[]): SearchIndex {
  const parts: string[] = []
  const offsets: number[] = []
  const wordIndices: number[] = []
  let pos = 0
  words.forEach((word, i) => {
    const norm = normalize(word)
    if (!norm) return // punctuation-only tokens like "—"
    parts.push(norm)
    offsets.push(pos)
    wordIndices.push(i)
    pos += norm.length + 1
  })
  return { text: parts.join(' '), offsets, wordIndices }
}

/** Index into `offsets` of the word containing character `pos`. */
function entryAt(offsets: number[], pos: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function search(index: SearchIndex, query: string, limit = 200): SearchMatch[] {
  const q = normalize(query).trim().replace(/\s+/g, ' ')
  if (!q) return []
  const matches: SearchMatch[] = []
  let from = 0
  while (matches.length < limit) {
    const pos = index.text.indexOf(q, from)
    if (pos === -1) break
    matches.push({
      start: index.wordIndices[entryAt(index.offsets, pos)],
      end: index.wordIndices[entryAt(index.offsets, pos + q.length - 1)],
    })
    from = pos + q.length
  }
  return matches
}
