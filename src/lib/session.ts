import { isSentenceEnd, type Timeline } from './rsvp'

/**
 * Timed reading sessions ("read for 10 minutes") that end at a natural break
 * instead of mid-sentence: a chapter end if one falls close to the time,
 * otherwise a paragraph end, otherwise the end of the sentence.
 */
export type Landing = 'chapter' | 'paragraph' | 'sentence' | 'book'

export interface SessionPlan {
  /** Last word of the session (inclusive). */
  end: number
  landing: Landing
}

/** How far (as a share of the session) the end may move to land on a break. */
const SLACK = 0.15

export function planSession(
  timeline: Timeline,
  words: string[],
  paragraphEnds: number[],
  chapterStarts: number[],
  from: number,
  minutes: number,
  wpm: number,
): SessionPlan {
  const { cumulative } = timeline
  const last = words.length - 1
  const budget = minutes * wpm // weights average 1 per word, so this is "word slots"
  const target = cumulative[from] + budget
  if (target >= cumulative[last + 1]) return { end: last, landing: 'book' }
  const at = (weight: number) => {
    // First word whose end reaches `weight`.
    let lo = from
    let hi = last
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cumulative[mid + 1] >= weight) hi = mid
      else lo = mid + 1
    }
    return lo
  }
  const ideal = at(target)
  const lo = at(Math.max(cumulative[from], target - budget * SLACK))
  const hi = at(target + budget * SLACK)
  const closest = (candidates: number[]) =>
    candidates.filter((i) => i >= lo && i <= hi && i > from).sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0]

  const chapterEnd = closest(chapterStarts.map((s) => s - 1))
  if (chapterEnd !== undefined) return { end: chapterEnd, landing: 'chapter' }
  const paragraphEnd = closest(paragraphEnds)
  if (paragraphEnd !== undefined) return { end: paragraphEnd, landing: 'paragraph' }
  let end = ideal
  while (end < last && !isSentenceEnd(words[end])) end++
  return { end, landing: 'sentence' }
}

export interface ChapterTarget {
  /** Chapter title. */
  title: string
  /** Its last word. */
  end: number
  /** Whether it's the chapter being read now. */
  current: boolean
}

/**
 * "Read to the end of…" targets: the current chapter and the next few, so a
 * session can run to a chapter end instead of for a set time.
 */
export function chapterTargets(
  chapters: { title: string; start: number }[],
  from: number,
  totalWords: number,
  count = 4,
): ChapterTarget[] {
  if (chapters.length < 2) return []
  let current = 0
  for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= from) current = i
  const targets: ChapterTarget[] = []
  for (let i = current; i < chapters.length && targets.length < count; i++) {
    const end = (chapters[i + 1]?.start ?? totalWords) - 1
    if (end > from) targets.push({ title: chapters[i].title, end, current: i === current })
  }
  return targets
}
