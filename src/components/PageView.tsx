import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DOUBLE_TAP_MS, hasSelection } from '../hooks/usePressGestures'
import { draggedLine, groupLines, lineAt, lineOf, lineSpacing, type Line } from '../lib/guide'
import { nextChapterStart, pageAnchor, pageBreak, paragraphsBetween } from '../lib/pages'
import { isSentenceEnd } from '../lib/rsvp'

interface Props {
  words: string[]
  paragraphEnds: number[]
  /** First word of each chapter, ascending. Every chapter starts on a new page. */
  chapterStarts: number[]
  /** Word ranges set as headings (chapter titles). */
  headings: { start: number; end: number }[]
  index: number
  playing: boolean
  scale: number
  /** The reading font setting; pages are re-measured when it changes. */
  font?: string
  /** Milliseconds per unit of word weight (60000 / wpm); a change re-plans the motion. */
  pace: number
  /**
   * How long word i will be on screen if reading carries on from here,
   * including the reader's extra beats (line starts, page turns, the
   * ramp-up after pressing play), so the motion keeps pace with the words.
   */
  durationOf: (i: number) => number
  /** Line focus: how many lines stay clear around the current one (0 = off); the rest black out. */
  focusLines?: number
  onSeek: (index: number) => void
  /** Double-tap on a word: select it, for the system's Look Up, Copy and so on. */
  onSelectWord?: (index: number) => void
  onToggle: () => void
  /** Reports the visible page and the words that begin each line on it. */
  onPage: (start: number, end: number, lineStarts: Set<number>) => void
  /** Filled with page navigation for the reader's keyboard shortcuts. */
  navRef?: React.RefObject<PageNav | null>
  /**
   * Guide: no timer. Holding anywhere and dragging moves the focus along
   * line by line from where it is; past the last line the page turns (past
   * the first, it turns back). A tap on a line moves the focus there.
   */
  guide?: boolean
  /** Whether word i is in a saved highlight, shown underlined in the focus colour. */
  highlighted?: (i: number) => boolean
}

export interface PageNav {
  next: () => void
  previous: () => void
  /** Guide: the focus to the next or previous line, turning the page at its ends. */
  nextLine?: () => void
  previousLine?: () => void
  /** Guide: a press anywhere on the reading area, to follow as it drags (or taps). */
  press?: (e: React.PointerEvent) => void
}

/** Guide: a press that moves less than this (px) is a tap. */
const TAP_SLOP = 8

/** Words laid out per measuring pass; comfortably more than fits on any screen. */
const CHUNK = 700
/** Length of the page-turn slide; keep in sync with the CSS animations. */
const TURN_MS = 240

/**
 * Guided reading: the book shown as screen-sized pages, with the current word
 * softly highlighted and a thin pacer line that sweeps along the line at
 * reading speed, so the eye has something continuous to follow.
 *
 * Pages are measured, not estimated: a chunk of text is laid out invisibly
 * and the page ends at the last word that fully fits, or at a sentence end on
 * the last two lines so a turn doesn't split a thought. Like an e-reader,
 * every chapter starts on a new page with its title set as a heading.
 * Measured pages are remembered so paging back and forth is stable, and
 * re-measured when the size changes.
 *
 * Turning slides the old page out while the new one slides in (reversed when
 * going back), and the highlight fades in on the new page's first word.
 */
export function PageView({
  words,
  paragraphEnds,
  chapterStarts,
  headings,
  index,
  playing,
  scale,
  font,
  pace,
  durationOf,
  focusLines = 0,
  onSeek,
  onSelectWord,
  onToggle,
  onPage,
  navRef,
  guide = false,
  highlighted = never,
}: Props) {
  const box = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const marker = useRef<HTMLDivElement>(null)
  const pacer = useRef<HTMLDivElement>(null)
  const ghostTimer = useRef<number | undefined>(undefined)
  const ends = useMemo(() => new Set(paragraphEnds), [paragraphEnds])
  const headingStarts = useMemo(() => new Set(headings.map((h) => h.start)), [headings])
  const known = useRef(new Map<number, number>())
  const lastClick = useRef<{ i: number; at: number } | null>(null)
  const selectionClick = useRef(false)
  const [page, setPage] = useState<{ start: number; end: number | null; turn: 'forward' | 'back' | null }>(() => ({
    start: pageAnchor(words, paragraphEnds, index),
    end: null,
    turn: null,
  }))

  // Measure: find the last word that fits, then show only that range.
  useLayoutEffect(() => {
    const el = box.current
    const t = text.current
    if (!el || !t || page.end !== null) return
    const spans = t.querySelectorAll<HTMLElement>('[data-i]')
    const limit = el.clientHeight
    let lo = 0
    let hi = spans.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      const s = spans[mid]
      if (s.offsetTop + s.offsetHeight <= limit) lo = mid
      else hi = mid - 1
    }
    let end = Number(spans[lo]?.dataset.i ?? page.start)
    // Unless the page already ends its chapter, prefer ending at a sentence.
    if (end < chapterLimit(chapterStarts, page.start, words.length)) {
      const fits = Array.from(spans)
        .slice(0, lo + 1)
        .map((s) => ({ index: Number(s.dataset.i), top: s.offsetTop }))
      const cut = pageBreak(fits, (i) => ends.has(i) || isSentenceEnd(words[i]))
      if (cut >= page.start) end = cut
    }
    known.current.set(page.start, end)
    setPage({ ...page, end })
  }, [page, words, ends, chapterStarts])

  // Report the page and where its lines begin (the reader gives line starts a beat more).
  useLayoutEffect(() => {
    if (page.end === null) return
    const lineStarts = new Set<number>()
    let top = -1
    for (const s of text.current?.querySelectorAll<HTMLElement>('[data-i]') ?? []) {
      if (s.offsetTop > top) {
        if (top !== -1) lineStarts.add(Number(s.dataset.i))
        top = s.offsetTop
      }
    }
    onPage(page.start, page.end, lineStarts)
  }, [page, onPage])

  // Follow the reading position: next page when it runs off the end,
  // otherwise a remembered page that contains it, otherwise a fresh anchor.
  useLayoutEffect(() => {
    const { start, end } = page
    if (end === null || (index >= start && index <= end)) return
    let next = index === end + 1 ? end + 1 : -1
    if (next === -1) {
      for (const [s, e] of known.current) if (s <= index && index <= e) next = s
    }
    if (next === -1) next = pageAnchor(words, paragraphEnds, index)
    // Keep a copy of the outgoing page on screen to slide it away.
    const direction = next > start ? 'forward' : 'back'
    const g = ghost.current
    if (g && text.current && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const copy = text.current.cloneNode(true) as HTMLElement
      copy.className = text.current.className.replace(/\s*entering-\w+/, '') // drop its own entrance animation
      g.replaceChildren(copy)
      g.className = `page-ghost leaving-${direction}`
      // Clear it when the slide ends; the timer is a backstop if no animationend fires.
      window.clearTimeout(ghostTimer.current)
      ghostTimer.current = window.setTimeout(() => clearGhost(g), TURN_MS + 100)
    }
    setPage({ start: next, end: known.current.get(next) ?? null, turn: direction })
  }, [index, page, words, paragraphEnds])

  // Re-paginate when the available space changes.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    let last = { w: el.clientWidth, h: el.clientHeight }
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === last.w && el.clientHeight === last.h) return
      last = { w: el.clientWidth, h: el.clientHeight }
      known.current.clear()
      setPage((p) => ({ start: p.start, end: null, turn: null }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const layout = `${scale} ${font}`
  const firstLayout = useRef(layout)
  useLayoutEffect(() => {
    if (firstLayout.current === layout) return
    firstLayout.current = layout
    known.current.clear()
    setPage((p) => ({ start: p.start, end: null, turn: null }))
  }, [layout])

  // The lines on the page as laid out (positions from the top of the text).
  const pageLines = (): Line[] =>
    groupLines(
      Array.from(text.current?.querySelectorAll<HTMLElement>('[data-i]') ?? [], (s) => ({
        i: Number(s.dataset.i),
        top: s.offsetTop,
        height: s.offsetHeight,
      })),
    )
  const nextPage = () => {
    // Jump to the start of the next page (the follow effect turns to it).
    if (page.end !== null && page.end < words.length - 1) onSeek(page.end + 1)
  }
  // To the end of the previous page: its last line, for the guide.
  const lastOfPreviousPage = () => {
    if (page.start > 0) onSeek(page.start - 1)
  }
  const moveLine = (step: 1 | -1) => {
    const lines = pageLines()
    const k = lineOf(lines, index) + step
    if (k >= lines.length) nextPage()
    else if (k < 0) lastOfPreviousPage()
    else onSeek(lines[k].start)
  }

  // Guide: the press being followed, anywhere on the reading area. The focus
  // moves from line `from` a line for every line's height dragged since `y`.
  // When the page turns under the drag, it carries on from the new page's
  // first line (or, going back, its last) once that page is laid out.
  const drag = useRef<{
    id: number
    x: number
    y: number
    from: number | 'last'
    moved: boolean
    turnedFrom: number | null
  } | null>(null)
  const follow = (clientX: number, clientY: number) => {
    const d = drag.current
    if (!d || page.end === null) return
    if (Math.abs(clientX - d.x) > TAP_SLOP || Math.abs(clientY - d.y) > TAP_SLOP) d.moved = true
    if (d.turnedFrom === page.start) return // Still waiting for the new page.
    const lines = pageLines()
    if (lines.length === 0) return
    if (d.turnedFrom !== null) {
      d.turnedFrom = null
      if (d.from === 'last') d.from = lines.length - 1
    }
    const from = d.from === 'last' ? lines.length - 1 : d.from
    const k = draggedLine(from, clientY - d.y, lineSpacing(lines))
    if (k >= lines.length && page.end < words.length - 1) {
      Object.assign(d, { from: 0, y: clientY, turnedFrom: page.start })
      return nextPage()
    }
    if (k < 0 && page.start > 0) {
      Object.assign(d, { from: 'last', y: clientY, turnedFrom: page.start })
      return lastOfPreviousPage()
    }
    const line = lines[Math.min(Math.max(k, 0), lines.length - 1)]
    if (lineOf(lines, index) !== lines.indexOf(line)) onSeek(line.start)
  }
  // A tap (no drag): the focus to the line tapped, if it was on the text.
  const tapAt = (clientY: number) => {
    const t = text.current
    const lines = pageLines()
    if (!t || lines.length === 0) return
    const y = clientY - t.getBoundingClientRect().top
    if (y < lines[0].top - TAP_SLOP || y > lines[lines.length - 1].bottom + TAP_SLOP) return
    onSeek(lines[lineAt(lines, y)].start)
  }
  // The latest of each (they read this render's page and position).
  const latest = useRef({ follow, tapAt })
  useLayoutEffect(() => {
    latest.current = { follow, tapAt }
  })
  // Followed on the window: the stage takes the pointer over during a long
  // press, and the page under the finger can turn.
  const press = (e: React.PointerEvent) => {
    if (drag.current) return
    const id = e.pointerId
    drag.current = { id, x: e.clientX, y: e.clientY, from: lineOf(pageLines(), index), moved: false, turnedFrom: null }
    const move = (m: PointerEvent) => {
      if (m.pointerId === id) latest.current.follow(m.clientX, m.clientY)
    }
    const end = (u: PointerEvent) => {
      if (u.pointerId !== id) return
      const tapped = drag.current && !drag.current.moved
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      if (tapped && u.type === 'pointerup') latest.current.tapAt(u.clientY)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  useLayoutEffect(() => {
    if (!navRef) return
    navRef.current = {
      next: nextPage,
      previous: () => {
        if (page.start === 0) return onSeek(0)
        for (const [s, e] of known.current) if (e === page.start - 1) return onSeek(s)
        onSeek(pageAnchor(words, paragraphEnds, page.start - 1))
      },
      nextLine: () => moveLine(1),
      previousLine: () => moveLine(-1),
      press: guide ? press : undefined,
    }
  })

  const measuring = page.end === null
  const last = measuring
    ? Math.min(page.start + CHUNK, chapterLimit(chapterStarts, page.start, words.length))
    : (page.end as number)
  // Set the page lower only when it opens with a title, like a chapter's first page.
  const opensChapter = headingStarts.has(page.start)
  const content = useMemo(
    () =>
      paragraphsBetween(ends, page.start, last).map((para) => {
        const Tag = headingStarts.has(para[0]) ? 'h2' : 'p'
        return (
          <Tag key={para[0]} className={Tag === 'h2' ? 'page-heading' : undefined}>
            {para.map((i) => (
              <Fragment key={i}>
                <span data-i={i} className={highlighted(i) ? 'is-highlighted' : undefined}>
                  {words[i]}
                </span>
                {/* The space inside a highlight is highlighted too, so it reads as one stroke. */}
                {highlighted(i) && highlighted(i + 1) ? <span className="is-highlighted"> </span> : ' '}
              </Fragment>
            ))}
          </Tag>
        )
      }),
    [ends, headingStarts, page.start, last, words, highlighted],
  )

  // Move the highlight and the line along with the reading. Both cover the
  // line from its first word up to the current one, like a highlighter pen.
  //
  // While reading they glide at one steady speed along each whole line: one
  // linear motion from where reading is to the end of the line, timed from
  // the words left on it. Moving word by word (a new motion per word, each
  // at its own speed) looked jagged. The motion is only re-planned when
  // something changes: a new line or page, a jump, play or pause, a new
  // speed, or the reading falling out of step with the plan. They grow with
  // a transform (scaleX), so the browser animates them off the main thread.
  const timing = useRef(durationOf)
  useLayoutEffect(() => {
    timing.current = durationOf
  })
  // The current glide: when it set off, and when each word on the line is due.
  const glide = useRef<{ at: number; due: Map<number, number> } | null>(null)
  const prev = useRef<{
    index: number
    top: number
    start: number
    lineLeft: number
    lineWidth: number
    lineEnd: number
    playing: boolean
    pace: number
  } | null>(null)
  useLayoutEffect(() => {
    const m = marker.current
    const p = pacer.current
    const t = text.current
    if (!m || !p || !t || measuring) return
    const at = (i: number) => t.querySelector<HTMLElement>(`[data-i="${i}"]`)
    const span = at(index)
    if (!span) {
      m.style.opacity = p.style.opacity = '0'
      return
    }
    // Layout offsets, not screen rects: they ignore the page's slide-in
    // transform, so both land where the word will come to rest.
    const top = span.offsetTop
    const left = span.offsetLeft
    const width = Math.max(span.offsetWidth, 4)
    const height = span.offsetHeight
    const before = prev.current
    const newPage = !before || before.start !== page.start
    const newLine = !newPage && before.top !== top
    // Anything but reading on to the next word restarts at this word.
    // Staying on the same word (pausing, say) keeps it as it is.
    const restart = newPage || newLine || (before.index !== index - 1 && before.index !== index)
    // The line runs from its first word to its last.
    let lineLeft = before?.lineLeft ?? left
    let lineWidth = before?.lineWidth ?? width
    let lineEnd = before?.lineEnd ?? index
    if (newPage || newLine || !before) {
      let first = span
      let last = span
      for (let s = at(index - 1); s && s.offsetTop === top; s = at(Number(s.dataset.i) - 1)) first = s
      for (let s = at(index + 1); s && s.offsetTop === top; s = at(Number(s.dataset.i) + 1)) last = s
      lineLeft = first.offsetLeft
      lineWidth = Math.max(last.offsetLeft + last.offsetWidth - lineLeft, 1)
      lineEnd = Number(last.dataset.i)
    }
    const startedPlaying = playing && !before?.playing
    const newPace = !!before && before.pace !== pace
    prev.current = { index, top, start: page.start, lineLeft, lineWidth, lineEnd, playing, pace }
    const delay = newPage && before ? TURN_MS - 60 : 0
    // A word arriving well before or after the plan said (the reading
    // stalled, or the tab was in the background): set off again from here.
    // Words that are simply shown longer or shorter than their width (a
    // pause at a full stop) are expected; the glide evens out by line end.
    const due = glide.current?.due.get(index)
    const outOfStep = due === undefined || Math.abs(performance.now() - due) > 250
    const replan = playing && (restart || startedPlaying || newPace || outOfStep)
    // Time left on this line, from the start of the current word, and when each word is due.
    let remaining = 0
    if (replan) {
      const at = performance.now() + delay
      const dueAt = new Map<number, number>()
      for (let i = index; i <= lineEnd; i++) {
        dueAt.set(i, at + remaining)
        remaining += timing.current(i)
      }
      glide.current = { at, due: dueAt }
    }
    remaining = Math.max(remaining, 16)
    if (!playing) glide.current = null

    // `pad` widens the highlight a little past the words at both ends.
    const sweep = (el: HTMLElement, y: number, h: number, pad: number) => {
      const x = lineLeft - pad
      const w = lineWidth + pad * 2
      const wordStart = (left + pad - x) / w
      const wordEnd = (left + width + pad - x) / w
      const place = (f: number) => `translate(${x}px, ${y}px) scaleX(${Math.min(Math.max(f, 0), 1)})`
      el.style.width = `${w}px`
      el.style.height = `${h}px`
      if (!playing) {
        // Paused: covered through the current word, eased there if it was moving.
        el.style.transition = restart ? 'none' : 'transform 150ms ease-out'
        el.style.transform = place(wordEnd)
        return
      }
      if (!replan) return
      // From the start of this word, or (same line, just re-timed) from
      // wherever it is right now, so it never jumps.
      const now = new DOMMatrixReadOnly(getComputedStyle(el).transform).a
      el.style.transition = 'none'
      el.style.transform = place(restart || startedPlaying ? wordStart : now)
      void el.offsetWidth
      el.style.transition = `transform ${Math.max(remaining - delay, 16)}ms linear ${delay}ms`
      el.style.transform = place(1)
    }
    sweep(p, top + height - 2, 2, 0)
    sweep(m, top, height, 3)

    if (newPage) {
      // Appear once the new page has slid in, so the eye lands on it.
      for (const el of [m, p]) {
        const motion = el.style.transition
        el.style.opacity = '0'
        void el.offsetWidth
        el.style.transition = `opacity 180ms ease-out ${TURN_MS - 60}ms${motion.startsWith('transform') ? `, ${motion}` : ''}`
      }
    }
    m.style.opacity = '1'
    p.style.opacity = '1'
  }, [index, page.start, measuring, content, playing, pace])

  // Line focus: every word outside the lines around the current one is
  // dimmed (almost hidden while reading, faint when paused; see the CSS).
  // Only redone when the line, the page or the setting changes.
  const focused = useRef<{ el: HTMLElement | null; key: string }>({ el: null, key: '' })
  useLayoutEffect(() => {
    const t = text.current
    if (!t || measuring) return
    const current = t.querySelector<HTMLElement>(`[data-i="${index}"]`)
    const key = `${focusLines}:${current?.offsetTop ?? -1}`
    if (focused.current.el === t && focused.current.key === key) return
    focused.current = { el: t, key }
    const spans = Array.from(t.querySelectorAll<HTMLElement>('[data-i]'))
    if (!focusLines || !current) {
      for (const s of spans) s.classList.remove('is-dim')
      return
    }
    const tops = [...new Set(spans.map((s) => s.offsetTop))].sort((a, b) => a - b)
    const line = tops.indexOf(current.offsetTop)
    const reach = (focusLines - 1) / 2
    const first = tops[Math.max(0, line - reach)]
    const last = tops[Math.min(tops.length - 1, line + reach)]
    for (const s of spans) s.classList.toggle('is-dim', s.offsetTop < first || s.offsetTop > last)
  }, [index, page.start, measuring, content, focusLines])

  return (
    <div
      className={`page${measuring ? ' is-measuring' : ''}${focusLines ? ' has-focus' : ''}${playing ? ' is-playing' : ''}${guide ? ' is-guided' : ''}`}
      ref={box}
      style={{ '--page-scale': scale } as React.CSSProperties}
      onPointerDown={() => {
        selectionClick.current = hasSelection()
      }}
      onPointerUp={() => {
        selectionClick.current ||= hasSelection()
      }}
      onClick={(e) => {
        // Text was just selected (a long press or a drag), or a tap is
        // dismissing a selection: that's not a tap on the page.
        if (selectionClick.current) return
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')
        if (!target) return guide ? undefined : onToggle()
        const i = Number(target.dataset.i)
        // The same word tapped twice in quick succession: select it (the
        // first tap has already jumped there).
        const before = lastClick.current
        const now = performance.now()
        lastClick.current = { i, at: now }
        if (before && before.i === i && now - before.at < DOUBLE_TAP_MS && onSelectWord) {
          lastClick.current = null
          onSelectWord(i)
        } else if (!guide) onSeek(i) // The guide has already moved to the line on the press.
      }}
    >
      <div
        className="page-ghost"
        ref={ghost}
        aria-hidden="true"
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) clearGhost(e.currentTarget)
        }}
      />
      <div className="page-marker" ref={marker} aria-hidden="true" />
      <div className="page-pacer" ref={pacer} aria-hidden="true" />
      <div
        className={`page-text${opensChapter ? ' opens-chapter' : ''}${page.turn ? ` entering-${page.turn}` : ''}`}
        key={page.start}
        ref={text}
      >
        {content}
      </div>
    </div>
  )
}

/** Last word a page starting at `start` may show: the end of its chapter or of the book. */
function chapterLimit(chapterStarts: number[], start: number, length: number): number {
  return Math.min(nextChapterStart(chapterStarts, start, length) - 1, length - 1)
}

const never = () => false

function clearGhost(g: HTMLElement) {
  g.replaceChildren()
  g.className = 'page-ghost'
}
