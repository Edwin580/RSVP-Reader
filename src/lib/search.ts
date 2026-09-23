/**
 * Full-text search over a book, built for "find that passage" rather than
 * raw substring matching.
 *
 * The book is tokenised into whole words (hyphenated words split into their
 * parts, apostrophes dropped, case and accents ignored) and indexed as an
 * inverted index: each distinct term maps to the positions where it occurs.
 * A query is matched term by term:
 *
 * - each query word matches the same word and its inflections (rabbit /
 *   rabbits, run / running), never fragments of other words (cat ≠ education);
 * - the last word also matches as a prefix while you type (rabb → rabbit);
 * - a word that isn't in the book falls back to the closest spelling
 *   (rabit → rabbit) and the result says so.
 *
 * Results come in two groups: **matches**, where the query words appear in
 * order as a phrase, and **related** passages, where all the important words
 * appear close together. Put the query in quotes to ask for the exact phrase
 * only.
 */

export interface SearchIndex {
  /** Distinct terms; a term's id is its index here. */
  terms: string[]
  termId: Map<string, number>
  /** Term ids sorted alphabetically by term, for prefix lookups. */
  sortedIds: Int32Array
  /** Term ids sharing a stem: "rabbit" → [rabbit, rabbits]. */
  byStem: Map<string, number[]>
  /** Token positions (ascending) where each term occurs. */
  postings: Int32Array[]
  /** Term id of each token, in reading order. */
  tokenTerm: Int32Array
  /** Book word index each token came from. */
  tokenWord: Int32Array
}

export interface SearchHit {
  /** First and last book word of the passage. */
  start: number
  end: number
  /** Book words to highlight. */
  highlights: number[]
}

export interface SearchResult {
  /** Query words found in order (inflections included), in book order. */
  matches: SearchHit[]
  /** All important query words close together, but not as that phrase. */
  related: SearchHit[]
  totalMatches: number
  totalRelated: number
  /** Set when a query word wasn't in the book and a close spelling was used instead. */
  correctedQuery?: string
}

const EMPTY: SearchResult = { matches: [], related: [], totalMatches: 0, totalRelated: 0 }

/** Lowercase, strip accents and apostrophes, split into alphanumeric runs. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/**
 * A light English stemmer: enough to join plurals and common verb forms
 * (rabbits, running, tired, happily) with their base word, without the
 * over-eager conflation of a full Porter stemmer.
 */
export function stem(term: string): string {
  let t = term
  if (t.length <= 3) return t
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y'
  if (t.endsWith('sses')) return t.slice(0, -2)
  if ((t.endsWith('ing') && t.length > 5) || (t.endsWith('ed') && t.length > 4)) {
    t = t.slice(0, t.endsWith('ing') ? -3 : -2)
    // running → runn → run; hoping → hop → hope; tired → tir → tire.
    if (/([^aeiouls])\1$/.test(t)) return t.slice(0, -1)
    return t.length <= 3 ? t + 'e' : t
  }
  if (t.endsWith('ly') && t.length > 4) return t.slice(0, -2)
  if (/(?:ch|sh|x|z|ss)es$/.test(t)) return t.slice(0, -2)
  if (t.endsWith('s') && !/(?:ss|us|is)$/.test(t)) t = t.slice(0, -1)
  // create / creates / created all become "creat"; short words keep their e (here ≠ her).
  return t.length >= 5 && t.endsWith('e') ? t.slice(0, -1) : t
}

/** Words too common to require when looking for a passage (they still count inside a phrase). */
const STOP_WORDS = new Set(
  'a an and are as at be but by for from had has have he her his i if in into is it its me my no not of on or our she so that the their them then there they this to was we were what when which who will with you your'.split(
    ' ',
  ),
)

export function buildSearchIndex(words: string[]): SearchIndex {
  const termId = new Map<string, number>()
  const terms: string[] = []
  const cache = new Map<string, number[]>()
  const tokenTermList: number[] = []
  const tokenWordList: number[] = []

  for (let w = 0; w < words.length; w++) {
    let ids = cache.get(words[w])
    if (!ids) {
      ids = tokenize(words[w]).map((t) => {
        let id = termId.get(t)
        if (id === undefined) {
          id = terms.length
          terms.push(t)
          termId.set(t, id)
        }
        return id
      })
      cache.set(words[w], ids)
    }
    for (const id of ids) {
      tokenTermList.push(id)
      tokenWordList.push(w)
    }
  }

  const tokenTerm = Int32Array.from(tokenTermList)
  const tokenWord = Int32Array.from(tokenWordList)

  // Postings: count, allocate, fill (positions come out ascending).
  const counts = new Int32Array(terms.length)
  for (let t = 0; t < tokenTerm.length; t++) counts[tokenTerm[t]]++
  const postings = Array.from(counts, (c) => new Int32Array(c))
  const fill = new Int32Array(terms.length)
  for (let t = 0; t < tokenTerm.length; t++) {
    const id = tokenTerm[t]
    postings[id][fill[id]++] = t
  }

  const sortedIds = Int32Array.from(terms.keys()).sort((a, b) => (terms[a] < terms[b] ? -1 : terms[a] > terms[b] ? 1 : 0))
  const byStem = new Map<string, number[]>()
  terms.forEach((t, id) => {
    const s = stem(t)
    const list = byStem.get(s)
    if (list) list.push(id)
    else byStem.set(s, [id])
  })

  return { terms, termId, sortedIds, byStem, postings, tokenTerm, tokenWord }
}

/** Term ids starting with `prefix` (at most `cap`). */
function prefixTerms(index: SearchIndex, prefix: string, cap = 60): number[] {
  const { sortedIds, terms } = index
  let lo = 0
  let hi = sortedIds.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (terms[sortedIds[mid]] < prefix) lo = mid + 1
    else hi = mid
  }
  const out: number[] = []
  for (let k = lo; k < sortedIds.length && out.length < cap && terms[sortedIds[k]].startsWith(prefix); k++) {
    out.push(sortedIds[k])
  }
  return out
}

/**
 * Typo distance between a typed word and a book word, weighted towards how
 * people actually mistype: a missing letter (wite → white) or two swapped
 * letters (teh → the) cost 0.75, a wrong or extra letter costs 1. Gives up,
 * returning `max + 1`, once the distance must exceed `max`.
 */
export function editDistance(typed: string, word: string, max: number): number {
  const MISSING = 0.75
  const SWAPPED = 0.75
  if (Math.abs(typed.length - word.length) > max / MISSING) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: word.length + 1 }, (_, j) => j * MISSING)
  for (let i = 1; i <= typed.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= word.length; j++) {
      let v = Math.min(
        prev[j] + 1, // extra letter typed
        cur[j - 1] + MISSING, // letter missing from what was typed
        prev[j - 1] + (typed[i - 1] === word[j - 1] ? 0 : 1),
      )
      if (i > 1 && j > 1 && typed[i - 1] === word[j - 2] && typed[i - 2] === word[j - 1]) {
        v = Math.min(v, prev2[j - 2] + SWAPPED)
      }
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[word.length] > max ? max + 1 : prev[word.length]
}

/**
 * Closest spelling of `word` in the book, preferring common words on ties.
 * While typing, `word` may be the start of a longer word, so it's also
 * compared against the beginning of each term ("rabi" → "rabbit").
 */
function closestTerm(index: SearchIndex, word: string, unfinished: boolean): number | undefined {
  // Short words have too many near neighbours to guess safely (cat → late).
  if (word.length < 4) return undefined
  const max = word.length <= 4 ? 1 : 2
  let best: number | undefined
  let bestDist = max + 1
  for (let id = 0; id < index.terms.length; id++) {
    const t = index.terms[id]
    // People rarely get the first letter wrong; allow it only as a swap (hwite → white).
    if (t[0] !== word[0] && !(t[0] === word[1] && t[1] === word[0])) continue
    const lengthOk = Math.abs(t.length - word.length) <= max
    if (!lengthOk && !(unfinished && t.length > word.length)) continue
    let d = lengthOk ? editDistance(word, t, max) : max + 1
    // An unfinished word may be the start of a longer one, but only allow one slip there.
    if (unfinished && t.length > word.length) {
      const partial = editDistance(word, t.slice(0, word.length), 1)
      if (partial <= 1) d = Math.min(d, partial)
    }
    if (d < bestDist || (d === bestDist && best !== undefined && index.postings[id].length > index.postings[best].length)) {
      best = id
      bestDist = d
    }
  }
  return best
}

interface QueryTerm {
  word: string
  /** Terms that count as this query word. */
  ids: Set<number>
  stop: boolean
}

/**
 * Resolve each query word to the book terms it should match. Returns null
 * when some word matches nothing, even approximately.
 */
function resolve(index: SearchIndex, input: string[], typing: boolean): { terms: QueryTerm[]; corrected: boolean } | null {
  const lastIndex = input.length - 1
  // A finished word the book doesn't have may be a compound it hyphenates
  // or spaces: "boathouse" → "boat house" (the book says "boat-house").
  const words = input.flatMap((w, k) => {
    const unfinished = typing && k === lastIndex
    if (unfinished || index.termId.has(w) || index.byStem.has(stem(w))) return [w]
    return splitCompound(index, w) ?? [w]
  })

  let corrected = false
  const terms: QueryTerm[] = []
  for (let k = 0; k < words.length; k++) {
    const word = words[k]
    const unfinished = typing && k === words.length - 1
    const exact = index.termId.get(word)
    let ids = new Set<number>(index.byStem.get(stem(word)) ?? [])
    if (exact !== undefined) ids.add(exact)
    // While typing, the last word may be unfinished: also match words it starts,
    // unless it's a short word that already exists ("the" shouldn't pull in "there").
    if (unfinished && word.length >= 2 && (ids.size === 0 || word.length >= 4)) {
      for (const id of prefixTerms(index, word)) ids.add(id)
    }
    // A word the book doesn't contain is probably misspelled. Its "forms" may
    // only be a lookalike (manderly → Manders), so switch to the closest
    // spelling when that is far better supported (→ Manderley).
    if (exact === undefined) {
      const near = closestTerm(index, word, unfinished)
      if (near !== undefined) {
        const nearIds = index.byStem.get(stem(index.terms[near])) ?? [near]
        if (ids.size === 0 || occurrences(index, nearIds) > 4 * occurrences(index, ids)) {
          ids = new Set(nearIds)
          words[k] = index.terms[near]
          corrected = true
        }
      }
      if (ids.size === 0) return null
    }
    terms.push({ word: words[k], ids, stop: STOP_WORDS.has(word) })
  }
  return { terms, corrected }
}

function occurrences(index: SearchIndex, ids: Iterable<number>): number {
  let n = 0
  for (const id of ids) n += index.postings[id].length
  return n
}

/** Split `word` into two words the book uses, preferring the best-attested split. */
function splitCompound(index: SearchIndex, word: string): [string, string] | null {
  let best: [string, string] | null = null
  let bestCount = 0
  for (let i = 2; i <= word.length - 2; i++) {
    const a = index.termId.get(word.slice(0, i))
    const b = index.termId.get(word.slice(i))
    if (a === undefined || b === undefined) continue
    const count = Math.min(index.postings[a].length, index.postings[b].length)
    if (count > bestCount) {
      best = [word.slice(0, i), word.slice(i)]
      bestCount = count
    }
  }
  return best
}

/** Ascending token positions where any of `ids` occurs. */
function positionsOf(index: SearchIndex, ids: Set<number>): Int32Array {
  const lists = [...ids].map((id) => index.postings[id])
  if (lists.length === 1) return lists[0]
  const total = lists.reduce((n, l) => n + l.length, 0)
  const out = new Int32Array(total)
  let o = 0
  for (const l of lists) {
    out.set(l, o)
    o += l.length
  }
  return out.sort()
}

/** How close the words of a related passage must be, in words. */
const NEAR_WINDOW = 12

export function search(index: SearchIndex, query: string, limit = 50): SearchResult {
  const trimmed = query.trim()
  const quoted = /^["“].*["”]$/.test(trimmed) && trimmed.length > 2
  const words = tokenize(trimmed)
  if (words.length === 0) return EMPTY
  // A trailing space or closing quote means the last word is finished.
  const typing = !quoted && !/\s$/.test(query)

  const resolved = resolve(index, words, typing)
  if (!resolved) return EMPTY
  const { terms, corrected } = resolved

  // Anchor on the rarest word; check the others around each of its occurrences.
  const order = terms
    .map((t, k) => ({ k, positions: positionsOf(index, t.ids) }))
    .sort((a, b) => a.positions.length - b.positions.length)
  const anchor = order[0]

  // Phrase matches: every word in order, adjacent.
  const phraseStarts: number[] = []
  for (const p of anchor.positions) {
    const start = p - anchor.k
    if (start < 0 || start + terms.length > index.tokenTerm.length) continue
    let ok = true
    for (let k = 0; k < terms.length && ok; k++) ok = terms[k].ids.has(index.tokenTerm[start + k])
    if (ok) phraseStarts.push(start)
  }
  const toHit = (tokens: number[]): SearchHit => {
    const wordsHit = [...new Set(tokens.map((t) => index.tokenWord[t]))].sort((a, b) => a - b)
    return { start: wordsHit[0], end: wordsHit[wordsHit.length - 1], highlights: wordsHit }
  }
  // One hit per passage: a word can hold several matches ("well-well" for "well").
  const matches: SearchHit[] = []
  let totalMatches = 0
  let lastWords = ''
  for (const s of phraseStarts) {
    const key = `${index.tokenWord[s]}-${index.tokenWord[s + terms.length - 1]}`
    if (key === lastWords) continue
    lastWords = key
    totalMatches++
    if (matches.length < limit) matches.push(toHit(Array.from({ length: terms.length }, (_, k) => s + k)))
  }

  // Related passages: the important words (not stop words) all within a short window.
  const related: SearchHit[] = []
  let totalRelated = 0
  // Only meaningful words count ("the" near "the" isn't a passage anyone wants).
  const need = terms.filter((t) => !t.stop)
  if (!quoted && need.length >= 2) {
    const inPhrase = new Set<number>()
    for (const s of phraseStarts) for (let k = 0; k < terms.length; k++) inPhrase.add(s + k)
    const rarest = need
      .map((t) => ({ t, positions: positionsOf(index, t.ids) }))
      .sort((a, b) => a.positions.length - b.positions.length)
    let lastEnd = -1
    for (const p of rarest[0].positions) {
      if (p <= lastEnd || inPhrase.has(p)) continue
      // Nearest occurrence of each other word within the window.
      const tokens = [p]
      let ok = true
      for (let r = 1; r < rarest.length && ok; r++) {
        const ids = rarest[r].t.ids
        let found = -1
        for (let d = 1; d <= NEAR_WINDOW && found === -1; d++) {
          if (p - d >= 0 && ids.has(index.tokenTerm[p - d])) found = p - d
          else if (p + d < index.tokenTerm.length && ids.has(index.tokenTerm[p + d])) found = p + d
        }
        if (found === -1) ok = false
        else tokens.push(found)
      }
      if (!ok || tokens.some((t) => inPhrase.has(t))) continue
      const span = Math.max(...tokens) - Math.min(...tokens)
      if (span > NEAR_WINDOW) continue
      totalRelated++
      lastEnd = Math.max(...tokens)
      if (related.length < limit) related.push(toHit(tokens))
    }
  }

  return {
    matches,
    related,
    totalMatches,
    totalRelated,
    correctedQuery: corrected ? terms.map((t) => t.word).join(' ') : undefined,
  }
}
