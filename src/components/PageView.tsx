import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  /** How long the current word is shown, so the marker moves at reading pace. */
  wordMs: number
  /** Extra time the reader adds to the first word of a line, and of a new page. */
  lineReturnMs: number
  turnMs: number
  onSeek: (index: number) => void
  onToggle: () => void
  /** Reports the visible page and the words that begin each line on it. */
  onPage: (start: number, end: number, lineStarts: Set<number>) => void
  /** Filled with page navigation for the reader's keyboard shortcuts. */
  navRef?: React.RefObject<PageNav | null>
}

export interface PageNav {
  next: () => void
  previous: () => void
}

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
  wordMs,
  lineReturnMs,
  turnMs,
  onSeek,
  onToggle,
  onPage,
  navRef,
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
  const firstScale = useRef(scale)
  useLayoutEffect(() => {
    if (firstScale.current === scale) return
    firstScale.current = scale
    known.current.clear()
    setPage((p) => ({ start: p.start, end: null, turn: null }))
  }, [scale])

  useLayoutEffect(() => {
    if (!navRef) return
    navRef.current = {
      next: () => {
        // Jump to the start of the next page (the follow effect turns to it).
        if (page.end !== null && page.end < words.length - 1) onSeek(page.end + 1)
      },
      previous: () => {
        if (page.start === 0) return onSeek(0)
        for (const [s, e] of known.current) if (e === page.start - 1) return onSeek(s)
        onSeek(pageAnchor(words, paragraphEnds, page.start - 1))
      },
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
                <span data-i={i}>{words[i]}</span>{' '}
              </Fragment>
            ))}
          </Tag>
        )
      }),
    [ends, headingStarts, page.start, last, words],
  )

  // Move the highlight and pacer to the current word.
  const prev = useRef<{ index: number; top: number; start: number; lineLeft: number } | null>(null)
  useLayoutEffect(() => {
    const m = marker.current
    const p = pacer.current
    if (!m || !p || measuring) return
    const span = text.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)
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
    // Anything but reading on to the next word on the same line restarts the pacer here.
    const restart = newPage || newLine || before.index !== index - 1
    const lineLeft = restart ? left : before.lineLeft
    prev.current = { index, top, start: page.start, lineLeft }
    // How long this word is actually on screen, including the reader's extra beats.
    const shownMs = Math.max(wordMs + (newPage && before ? turnMs : newLine ? lineReturnMs : 0), 16)

    // Highlight: a soft box that eases from word to word.
    const glide = Math.min(wordMs * 0.5, 160)
    m.style.transition = newPage || newLine ? 'none' : `transform ${glide}ms cubic-bezier(0.4, 0, 0.2, 1), width ${glide}ms cubic-bezier(0.4, 0, 0.2, 1)`
    m.style.transform = `translate(${left}px, ${top}px)`
    m.style.width = `${width}px`
    m.style.height = `${height}px`

    // Pacer: a line under the text whose end moves steadily through the
    // current word over exactly the time it's shown, so it never stops
    // while playing. It fills the line from where reading started on it.
    const target = left + width - lineLeft
    if (restart) {
      p.style.transition = 'none'
      p.style.transform = `translate(${lineLeft}px, ${top + height - 2}px)`
      p.style.width = playing ? '0px' : `${target}px`
      void p.offsetWidth
    }
    if (playing) {
      p.style.transition = `width ${shownMs}ms linear`
      p.style.width = `${target}px`
    } else if (!restart) {
      p.style.transition = 'none'
      p.style.width = `${target}px`
    }

    if (newPage) {
      // Appear once the new page has slid in, so the eye lands on it.
      for (const el of [m, p]) {
        el.style.opacity = '0'
        void el.offsetWidth
      }
      m.style.transition = `opacity 180ms ease-out ${TURN_MS - 60}ms`
      p.style.transition = `opacity 180ms ease-out ${TURN_MS - 60}ms, width ${Math.max(shownMs - (TURN_MS - 60), 16)}ms linear ${TURN_MS - 60}ms`
    }
    m.style.opacity = '1'
    p.style.opacity = '1'
  }, [index, page.start, measuring, wordMs, lineReturnMs, turnMs, content, playing])

  return (
    <div
      className={`page${measuring ? ' is-measuring' : ''}`}
      ref={box}
      style={{ '--page-scale': scale } as React.CSSProperties}
      onClick={(e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')
        if (target) onSeek(Number(target.dataset.i))
        else onToggle()
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

function clearGhost(g: HTMLElement) {
  g.replaceChildren()
  g.className = 'page-ghost'
}
