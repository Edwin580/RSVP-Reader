import type { SyncPoint } from './audio'
import { isSentenceEnd } from './rsvp'

/**
 * Lining a chapter's recording up with its text from the sound alone, with
 * no speech recognition. Narrators pause between sentences, and longer
 * between paragraphs; the recording's pauses are found from its loudness,
 * and matched to the text's sentence breaks so that the stretches between
 * them take as long as their words should (by the reading timeline's
 * weights). That pins nearly every sentence to the moment it starts.
 */

export interface Pause {
  /** Seconds into the recording where the silence starts and ends. */
  start: number
  end: number
}

/** Loudness is measured over windows this long. */
const FRAME_SECONDS = 0.02
/** Silence shorter than this is a stop consonant or a breath between words, not a pause. */
const MIN_PAUSE_SECONDS = 0.2

/** Pauses in a recording: stretches clearly quieter than the speech around them. */
export function findPauses(samples: Float32Array, sampleRate: number): Pause[] {
  const frame = Math.max(1, Math.round(sampleRate * FRAME_SECONDS))
  const count = Math.floor(samples.length / frame)
  const level = new Float32Array(count)
  for (let f = 0; f < count; f++) {
    let sum = 0
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += samples[i] * samples[i]
    level[f] = 10 * Math.log10(sum / frame + 1e-10)
  }
  // Between the recording's own quiet and its speech, whatever its volume.
  const sorted = Float32Array.from(level).sort()
  const quiet = sorted[Math.floor(count * 0.05)] ?? -100
  const speech = sorted[Math.floor(count * 0.7)] ?? 0
  const threshold = quiet + (speech - quiet) * 0.3

  const pauses: Pause[] = []
  let from = -1
  for (let f = 0; f <= count; f++) {
    const silent = f < count && level[f] < threshold
    if (silent && from < 0) from = f
    if (!silent && from >= 0) {
      if ((f - from) * FRAME_SECONDS >= MIN_PAUSE_SECONDS) {
        pauses.push({ start: from * FRAME_SECONDS, end: f * FRAME_SECONDS })
      }
      from = -1
    }
  }
  return pauses
}

export interface ChapterText {
  /** The chapter's words: [start, end). */
  start: number
  end: number
  words: string[]
  /** How long each word takes to read, relative to the others (the reading timeline's weights). */
  weights: ArrayLike<number>
  /** Indices of words that end a paragraph. */
  paragraphEnds: Set<number>
}

/**
 * Recordings often open with an announcement ("This is a LibriVox
 * recording…") and close with credits ("End of chapter one. Recording
 * by…"): the text can start this late and end this early, in seconds, and
 * never more than this share of the recording.
 */
const MAX_INTRO_SECONDS = 75
const MAX_OUTRO_SECONDS = 40
const MAX_INTRO_SHARE = 0.2
const MAX_OUTRO_SHARE = 0.15
/** How many sentence breaks, and pauses, one step of the match may pass over. */
const BREAK_WINDOW = 12
/** Speaking time a single long sentence can take, with no pause clear enough to place a break in it. */
const LONG_SENTENCE_SECONDS = 20
const PAUSE_WINDOW = 16

/** How long a word takes to say; ornaments like "* * *" aren't said at all. */
export function spokenWeight(text: ChapterText, i: number): number {
  return /[\p{L}\p{N}]/u.test(text.words[i] ?? '') ? (text.weights[i] ?? 1) : 0
}

interface Break {
  index: number
  /** How much is said before it in the chapter, in letters (a stand-in for syllables). */
  at: number
  paragraph: boolean
  /** After a comma, semicolon, colon or dash: a narrator often pauses here, but needn't. */
  clause: boolean
}

/** Letters and digits in a word: roughly how long it takes to say, without the pauses around it. */
function letters(word: string | undefined): number {
  return word ? word.replace(/[^\p{L}\p{N}]/gu, '').length : 0
}

function breaks(text: ChapterText): Break[] {
  const out: Break[] = []
  let at = 0
  for (let i = text.start; i < text.end; i++) {
    const previous = i - 1
    const starts = i === text.start || isSentenceEnd(text.words[previous]) || text.paragraphEnds.has(previous)
    const clause = !starts && /[,;:—–)]["”’)]*$/.test(text.words[previous] ?? '')
    if ((starts || clause) && (i === text.start || spokenWeight(text, i) > 0)) {
      out.push({ index: i, at, paragraph: i === text.start || text.paragraphEnds.has(previous), clause })
    }
    at += letters(text.words[i])
  }
  return out
}

export interface AlignOptions {
  /**
   * When where the recording starts in the text is only roughly known: how
   * many words from `start` it may skip before it.
   */
  lead?: number
  /** When where it ends isn't known: the text may run on past the recording (`end` is just as far as to look). */
  openEnd?: boolean
  /**
   * The narrator's pace, in letters a second of speech, if known (from a
   * part of the recording already lined up). With an open end, the text's
   * length can't tell the pace, so without this a typical narrator's is assumed.
   */
  rate?: number
}

/** A typical narrator says about this many letters a second, not counting pauses. */
const TYPICAL_ARTICULATION = 13.2

/** With an open end, the pace may stray this far from the one assumed: enough for a narrator to speed up or slow down, not enough to stretch a page over a chapter. */
const OPEN_END_RATE_SLACK = 0.12

/**
 * Sync points for a chapter from its recording's pauses: the start of each
 * sentence that could be placed, at the moment speech resumes after the
 * pause before it. `duration` is the recording's length in seconds; times
 * are from its start.
 */
export function alignChapter(pauses: Pause[], duration: number, text: ChapterText, options: AlignOptions = {}): SyncPoint[] {
  const marks = breaks(text)
  if (marks.length < 2 || pauses.length < 2) return []
  let total = 0
  for (let i = text.start; i < text.end; i++) total += letters(text.words[i])
  let lead = 0
  for (let i = text.start; i < Math.min(text.end, text.start + (options.lead ?? 0)); i++) lead += letters(text.words[i])
  const openEnd = options.openEnd ?? false

  // Where speech could start a sentence: after each pause, and at the very start.
  const onsets = [0, ...pauses.map((p) => p.end)].filter((t) => t < duration)
  const gaps = [0, ...pauses.map((p) => p.end - p.start)]
  // Time spent speaking before each onset: narrators pause for effect as
  // they please, but say their words at a much steadier pace.
  const spoken = new Float64Array(onsets.length)
  let silent = 0
  for (let o = 1; o < onsets.length; o++) {
    silent += gaps[o]
    spoken[o] = onsets[o] - silent
  }
  const speaking = duration - pauses.reduce((sum, p) => sum + (p.end - p.start), 0)

  // A first guess at the narrator's pace, then measured from the match
  // itself and matched again. The middle of the chapter measures it best:
  // the ends are where an announcement or credits can throw the match off.
  const assumed = options.rate ?? TYPICAL_ARTICULATION
  let rate = openEnd ? assumed : total / Math.max(speaking * 0.9, 1)
  const run = () => match(marks, onsets, spoken, gaps, rate, duration, lead, openEnd)
  let matched = run()
  for (let pass = 0; pass < 2 && matched.length >= 8; pass++) {
    const middle = matched.slice(Math.floor(matched.length * 0.15), Math.ceil(matched.length * 0.85))
    let measured = slope(middle.map((m) => [spoken[m.onset], marks[m.mark].at]))
    if (!(measured > 0)) break
    if (openEnd) measured = Math.min(assumed * (1 + OPEN_END_RATE_SLACK), Math.max(assumed * (1 - OPEN_END_RATE_SLACK), measured))
    rate = measured
    matched = run()
  }
  return matched.map((m) => ({ index: marks[m.mark].index, seconds: onsets[m.onset] }))
}

/** Least-squares slope of y over x. */
function slope(points: [number, number][]): number {
  const n = points.length
  const mx = points.reduce((s, p) => s + p[0], 0) / n
  const my = points.reduce((s, p) => s + p[1], 0) / n
  let sxy = 0
  let sxx = 0
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) * (x - mx)
  }
  return sxx > 0 ? sxy / sxx : NaN
}

/** The best way to pair sentence breaks with pauses, in order (dynamic programming). */
function match(
  marks: Break[],
  onsets: number[],
  spoken: Float64Array,
  gaps: number[],
  rate: number,
  duration: number,
  lead: number,
  openEnd: boolean,
): { mark: number; onset: number }[] {
  const B = marks.length
  const O = onsets.length
  const intro = Math.min(MAX_INTRO_SECONDS, duration * MAX_INTRO_SHARE)
  const outro = Math.min(MAX_OUTRO_SECONDS, duration * MAX_OUTRO_SHARE)
  const cost = new Float64Array(B * O).fill(Infinity)
  const from = new Int32Array(B * O).fill(-1)

  // A sentence left unplaced, a pause left unused (longer ones are likelier sentence breaks).
  const skipMark = (m: number) => (marks[m].paragraph ? 1.6 : marks[m].clause ? 0.15 : 0.8)
  const skipOnset = (o: number) => 0.04 + 0.5 * Math.min(gaps[o] / 0.8, 1.5)
  // A paragraph should start after a real pause.
  const fit = (m: number, o: number) => (marks[m].paragraph && gaps[o] < 0.35 && o > 0 ? 0.4 : 0)

  // The text's first words come after any introduction (and, when where it
  // starts isn't known, at any sentence in the lead). With a known end, the
  // text has to fit before it, which keeps the start honest; with an open
  // end, nothing would stop the start sliding late (the text just ends
  // sooner), so pauses passed over before it cost half as much as anywhere.
  const before = new Float64Array(O)
  for (let o = 1; o < O; o++) before[o] = before[o - 1] + (openEnd ? skipOnset(o - 1) / 2 : 0)
  for (let m = 0; m < B && (m === 0 || marks[m].at <= lead); m++) {
    for (let o = 0; o < O && onsets[o] <= intro; o++) cost[m * O + o] = fit(m, o) + before[o]
  }

  for (let m = 1; m < B; m++) {
    // Only pauses near where this sentence could plausibly be.
    const lo = ((marks[m].at - lead) / rate) * 0.6 - 20
    const hi = (marks[m].at / rate) * 1.5 + intro
    for (let o = 1; o < O; o++) {
      if (spoken[o] < lo) continue
      if (spoken[o] > hi) break
      let best = Infinity
      let arg = -1
      for (let pm = m - 1; pm >= Math.max(0, m - BREAK_WINDOW); pm--) {
        let skippedMarks = 0
        for (let s = pm + 1; s < m; s++) skippedMarks += skipMark(s)
        const want = (marks[m].at - marks[pm].at) / rate
        let skippedOnsets = 0
        for (let po = o - 1; po >= Math.max(0, o - PAUSE_WINDOW); po--) {
          const before = cost[pm * O + po]
          if (before !== Infinity) {
            const took = spoken[o] - spoken[po]
            if (took > 0) {
              // Off by a ratio, judged gently for short stretches, where a pause or two swings it.
              const off = Math.log(took / want)
              const c = before + skippedMarks + skippedOnsets + 4 * off * off * Math.min(1, want / 4) + fit(m, o)
              if (c < best) {
                best = c
                arg = pm * O + po
              }
            }
          }
          skippedOnsets += skipOnset(po)
        }
      }
      if (best < cost[m * O + o]) {
        cost[m * O + o] = best
        from[m * O + o] = arg
      }
    }
  }

  // The best place to finish: later sentences can go unplaced, and pauses
  // after the last one go unused, at the same costs as anywhere else, except
  // in the closing credits.
  const unusedAfter = new Float64Array(O + 1)
  for (let o = O - 1; o >= 0; o--) {
    unusedAfter[o] = unusedAfter[o + 1] + (onsets[o] < duration - outro ? skipOnset(o) : 0)
  }
  // With an open end the text may run on, but the recording is all read:
  // speech left over after the last sentence placed, beyond what one long
  // sentence takes, means the match stopped short.
  const speechAtOutro = spoken[O - 1] + Math.max(0, duration - outro - onsets[O - 1])
  const shortBy = (o: number) => (openEnd ? Math.max(0, speechAtOutro - spoken[o] - LONG_SENTENCE_SECONDS) * 0.5 : 0)
  let end = -1
  let endCost = Infinity
  let tail = 0
  for (let m = B - 1; m >= 0; m--) {
    for (let o = 0; o < O; o++) {
      const c = cost[m * O + o] + tail + unusedAfter[o + 1] + shortBy(o)
      if (c < endCost) {
        endCost = c
        end = m * O + o
      }
    }
    if (!openEnd) tail += skipMark(m)
  }
  const path: { mark: number; onset: number }[] = []
  for (let k = end; k >= 0; k = from[k]) path.push({ mark: Math.floor(k / O), onset: k % O })
  return path.reverse()
}
