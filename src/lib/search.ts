/**
 * Phrase search over a book's words, ignoring case, punctuation and accents,
 * so "cold day in april" finds "cold day in April,".
 *
 * The index is one normalised string plus typed arrays mapping character
 * offsets back to word indices. It is cheap to build (normalisation is
 * memoised per distinct word, and books reuse a small vocabulary) and
 * queries are a native substring scan, which also gives partial-word
 * matching for free.
 */

export interface SearchIndex {
  /** Normalised words joined by single spaces. */
  text: string
  /** Character offset in `text` where each indexed word starts (ascending). */
  offsets: Int32Array
  /** Book word index for each entry in `offsets`. */
  wordIndices: Int32Array
}

export interface SearchMatch {
  /** Index of the first matched word. */
  start: number
  /** Index of the last matched word. */
  end: number
}

export interface SearchResult {
  matches: SearchMatch[]
  /** Total number of matches in the book (may exceed `matches.length`). */
  total: number
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
}

export function buildSearchIndex(words: string[]): SearchIndex {
  const cache = new Map<string, string>()
  const parts: string[] = []
  const offsets = new Int32Array(words.length)
  const wordIndices = new Int32Array(words.length)
  let count = 0
  let pos = 0
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    let norm = cache.get(word)
    if (norm === undefined) {
      norm = normalize(word)
      cache.set(word, norm)
    }
    if (!norm) continue // punctuation-only tokens like "—"
    parts.push(norm)
    offsets[count] = pos
    wordIndices[count] = i
    count++
    pos += norm.length + 1
  }
  return {
    text: parts.join(' '),
    offsets: offsets.slice(0, count),
    wordIndices: wordIndices.slice(0, count),
  }
}

/** Index into `offsets` of the word containing character `pos`. */
function entryAt(offsets: Int32Array, pos: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function search(index: SearchIndex, query: string, limit = 200): SearchResult {
  const q = normalize(query).trim().replace(/\s+/g, ' ')
  const matches: SearchMatch[] = []
  if (!q) return { matches, total: 0 }
  let total = 0
  for (let pos = index.text.indexOf(q); pos !== -1; pos = index.text.indexOf(q, pos + q.length)) {
    if (total++ < limit) {
      matches.push({
        start: index.wordIndices[entryAt(index.offsets, pos)],
        end: index.wordIndices[entryAt(index.offsets, pos + q.length - 1)],
      })
    }
  }
  return { matches, total }
}
