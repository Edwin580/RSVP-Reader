/**
 * Guide: reading at your own pace in page mode. You hold anywhere and drag,
 * and the line focus moves with the drag line by line (down to read on, up
 * to go back); a tap on a line moves it there. These are the pure parts:
 * lines from laid-out words, the line a drag or tap lands on, and how much
 * reading a move counts as.
 */

/** A line of laid-out text: where it sits (px from the top of the text) and its first word. */
export interface Line {
  top: number
  bottom: number
  start: number
}

/** Lines from laid-out words, in order: words sharing a top are on one line. */
export function groupLines(words: { i: number; top: number; height: number }[]): Line[] {
  const lines: Line[] = []
  for (const w of words) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(w.top - last.top) < 1) last.bottom = Math.max(last.bottom, w.top + w.height)
    else lines.push({ top: w.top, bottom: w.top + w.height, start: w.i })
  }
  return lines
}

/** The line at height `y` (nearest one if `y` falls between or beyond lines), or -1 with none. */
export function lineAt(lines: Line[], y: number): number {
  let best = -1
  let distance = Infinity
  for (let k = 0; k < lines.length; k++) {
    const { top, bottom } = lines[k]
    const d = y < top ? top - y : y > bottom ? y - bottom : 0
    if (d < distance) {
      best = k
      distance = d
    }
  }
  return best
}

/** The line holding word `index`: the last that starts at or before it. */
export function lineOf(lines: Line[], index: number): number {
  let found = -1
  for (let k = 0; k < lines.length && lines[k].start <= index; k++) found = k
  return found
}

/**
 * Line focus around line `k`: the first and last line kept clear, for `focus`
 * lines (1 or 3) centred on it.
 */
export function focusRange(count: number, k: number, focus: number): [number, number] {
  const reach = Math.floor((Math.max(focus, 1) - 1) / 2)
  return [Math.max(0, k - reach), Math.min(count - 1, k + reach)]
}

/** The usual distance from one line to the next (px), or 0 with fewer than two lines. */
export function lineSpacing(lines: Line[]): number {
  const gaps = lines
    .slice(1)
    .map((l, k) => l.top - lines[k].top)
    .filter((g) => g > 0)
    .sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)] ?? 0
}

/**
 * The line a drag has moved the focus to: from line `from`, a line further
 * on for every line's height dragged down (back for up), wherever on the
 * screen the drag started.
 */
export function draggedLine(from: number, dy: number, spacing: number): number {
  return spacing > 0 ? from + Math.round(dy / spacing) : from
}

/** Below this pace (words a minute) a stretch counts as time away, not reading. */
const SLOWEST_WPM = 60
/** Above this pace a move is skimming or flicking through, not reading. */
const FASTEST_WPM = 1500
/** Guide moves further than this are jumps, not reading. */
export const GUIDE_MOST_WORDS = 200

/**
 * Reading stats when you set the pace (the guide, or turning pages
 * yourself): moving on from word `from` to `to` after `elapsed` ms counts as
 * reading the words in between, for no longer than reading them at a slow
 * pace would take (so time spent away doesn't count). Going back, jumping
 * further than `most` words, or moving on faster than anyone reads (flicking
 * through pages) counts as nothing.
 */
export function guideReading(
  from: number,
  to: number,
  elapsed: number,
  most = GUIDE_MOST_WORDS,
): { ms: number; words: number } | null {
  const words = to - from
  if (words <= 0 || words > most || elapsed <= 0) return null
  if (words / (elapsed / 60000) > FASTEST_WPM) return null
  return { words, ms: Math.min(elapsed, (words * 60000) / SLOWEST_WPM) }
}

/**
 * Continuous layout: the stretch of the book to lay out around word `index`,
 * about `reach` words either side, widened to whole paragraphs. (Laying out
 * a whole book at once would be slow; the stretch moves along as you read.)
 */
export function windowAround(
  paragraphEnds: number[],
  index: number,
  reach: number,
  total: number,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: -1 }
  const lo = Math.max(0, index - reach)
  const hi = Math.min(total - 1, index + reach)
  // The paragraph holding `lo` starts after the last end before it.
  let from = 0
  let to = total - 1
  for (const end of paragraphEnds) {
    if (end < lo) from = end + 1
    if (end >= hi) {
      to = end
      break
    }
  }
  return { from, to }
}
