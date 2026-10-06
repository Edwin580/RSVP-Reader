import type { SyncPoint } from './audio'

/**
 * Lines a timed transcript (a video's captions, pasted) up with the book's
 * text, without speech recognition: runs of a few words that appear once in
 * the book and once in the transcript pin that spot in the book to that
 * moment. Captions mishear words, so only runs that agree with each other
 * (later in the book is later in the recording) are kept.
 */

/** Words in a row that must match. Four is rare enough to be unique in a novel, short enough to survive mishearing. */
const RUN = 4
/** Keep about one point per this many seconds; more adds nothing between steady stretches. */
const SPACING_SECONDS = 3
/** A narrator never reads slower or faster than this many words a second; points implying it are mismatches. */
const MIN_RATE = 0.8
const MAX_RATE = 7

export interface TimedText {
  seconds: number
  text: string
}

/** Lower case letters and digits only, so "Well," matches "well". */
export function normalizeWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Each transcript word with the moment it's spoken, spread evenly through its caption. */
function timedWords(segments: TimedText[]): { word: string; seconds: number }[] {
  const out: { word: string; seconds: number }[] = []
  segments.forEach((segment, k) => {
    const words = segment.text.split(/\s+/).map(normalizeWord).filter(Boolean)
    const next = segments[k + 1]?.seconds
    const span = next !== undefined && next > segment.seconds ? next - segment.seconds : words.length / 2.6
    words.forEach((word, j) => out.push({ word, seconds: segment.seconds + (j / Math.max(words.length, 1)) * span }))
  })
  return out
}

/** Sync points from a timed transcript; empty when it doesn't match the book (a chapter list, say). */
export function alignTranscript(segments: TimedText[], bookWords: string[]): SyncPoint[] {
  // The book's words, normalized, remembering where each came from.
  const tokens: string[] = []
  const at: number[] = []
  bookWords.forEach((w, i) => {
    const n = normalizeWord(w)
    if (n) {
      tokens.push(n)
      at.push(i)
    }
  })
  // Each run of words in the book, and where it is if it's there only once.
  const runs = new Map<string, number>()
  for (let t = 0; t + RUN <= tokens.length; t++) {
    const key = tokens.slice(t, t + RUN).join(' ')
    runs.set(key, runs.has(key) ? -1 : t)
  }

  const spoken = timedWords(segments)
  const candidates: SyncPoint[] = []
  for (let s = 0; s + RUN <= spoken.length; s++) {
    const t = runs.get(spoken.slice(s, s + RUN).map((x) => x.word).join(' '))
    if (t !== undefined && t >= 0) candidates.push({ index: at[t], seconds: spoken[s].seconds })
  }
  return thin(plausible(increasing(candidates)))
}

/** The longest run of candidates going forward in both the book and the recording (they arrive in recording order). */
function increasing(points: SyncPoint[]): SyncPoint[] {
  const tails: number[] = []
  const previous = new Array<number>(points.length).fill(-1)
  points.forEach((p, k) => {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (points[tails[mid]].index < p.index) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) previous[k] = tails[lo - 1]
    tails[lo] = k
  })
  const chain: SyncPoint[] = []
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = previous[k]) chain.push(points[k])
  return chain.reverse().filter((p, k, all) => k === 0 || p.seconds > all[k - 1].seconds)
}

/** Drops points that would have the narrator racing or crawling: a match in the wrong place. */
function plausible(points: SyncPoint[]): SyncPoint[] {
  const kept: SyncPoint[] = []
  for (const p of points) {
    const last = kept[kept.length - 1]
    if (!last) {
      kept.push(p)
      continue
    }
    const rate = (p.index - last.index) / (p.seconds - last.seconds)
    // A long gap (an untranscribed stretch) can't be judged by pace; trust it.
    if ((rate >= MIN_RATE && rate <= MAX_RATE) || p.seconds - last.seconds > 120) kept.push(p)
  }
  return kept
}

function thin(points: SyncPoint[]): SyncPoint[] {
  const kept: SyncPoint[] = []
  points.forEach((p, k) => {
    const last = kept[kept.length - 1]
    if (!last || k === points.length - 1 || p.seconds - last.seconds >= SPACING_SECONDS) kept.push(p)
  })
  return kept
}
