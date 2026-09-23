import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { pageAnchor, pageBreak, paragraphsBetween } from '../lib/pages'
import { isSentenceEnd } from '../lib/rsvp'

interface Props {
  words: string[]
  paragraphEnds: number[]
  index: number
  scale: number
  /** How long the current word is shown, so the marker glides at reading pace. */
  wordMs: number
  onSeek: (index: number) => void
  onToggle: () => void
  /** Reports the visible page so the reader can pause briefly before turning it. */
  onPage: (start: number, end: number) => void
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
 * Guided reading: the book shown as screen-sized pages, with a marker that
 * glides under each word at reading speed and turns the page at the end.
 *
 * Pages are measured, not estimated: a chunk of text is laid out invisibly
 * and the page ends at the last word that fully fits, or at a sentence end on
 * the last two lines so a turn doesn't split a thought. Measured pages are
 * remembered so paging back and forth is stable, and re-measured when the
 * size changes.
 *
 * Turning slides the old page out while the new one slides in (reversed when
 * going back), and the marker fades in on the new page's first word.
 */
export function PageView({ words, paragraphEnds, index, scale, wordMs, onSeek, onToggle, onPage, navRef }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const marker = useRef<HTMLDivElement>(null)
  const ghostTimer = useRef<number | undefined>(undefined)
  const ends = useMemo(() => new Set(paragraphEnds), [paragraphEnds])
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
    // Unless this is the book's last page, prefer ending at a sentence.
    if (end < words.length - 1) {
      const fits = Array.from(spans)
        .slice(0, lo + 1)
        .map((s) => ({ index: Number(s.dataset.i), top: s.offsetTop }))
      const cut = pageBreak(fits, (i) => ends.has(i) || isSentenceEnd(words[i]))
      if (cut >= page.start) end = cut
    }
    known.current.set(page.start, end)
    setPage({ ...page, end })
  }, [page, words, ends])

  useLayoutEffect(() => {
    if (page.end !== null) onPage(page.start, page.end)
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
      copy.className = 'page-text' // drop its own entrance animation
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
  const last = measuring ? Math.min(page.start + CHUNK, words.length - 1) : (page.end as number)
  const content = useMemo(
    () =>
      paragraphsBetween(ends, page.start, last).map((para) => (
        <p key={para[0]}>
          {para.map((i) => (
            <Fragment key={i}>
              <span data-i={i}>{words[i]}</span>{' '}
            </Fragment>
          ))}
        </p>
      )),
    [ends, page.start, last, words],
  )

  // Glide the marker to the current word; jump without animating on a new line or page.
  const prev = useRef<{ top: number; start: number } | null>(null)
  useLayoutEffect(() => {
    const m = marker.current
    if (!m || measuring) return
    const span = text.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)
    if (!span) {
      m.style.opacity = '0'
      return
    }
    // Layout offsets, not screen rects: they ignore the page's slide-in
    // transform, so the marker lands where the word will come to rest.
    const top = span.offsetTop
    const left = span.offsetLeft
    const newPage = !prev.current || prev.current.start !== page.start
    const newLine = !newPage && prev.current!.top !== top
    prev.current = { top, start: page.start }
    const glide = Math.min(wordMs * 0.6, 140)
    m.style.transition = newPage || newLine ? 'none' : `transform ${glide}ms ease-out, width ${glide}ms ease-out`
    m.style.transform = `translate(${left}px, ${top}px)`
    m.style.width = `${Math.max(span.offsetWidth, 4)}px`
    m.style.height = `${span.offsetHeight}px`
    if (newPage) {
      // Appear once the new page has slid in, so the eye lands on it.
      m.style.opacity = '0'
      void m.offsetWidth
      m.style.transition = `opacity 180ms ease-out ${TURN_MS - 60}ms`
    }
    m.style.opacity = '1'
  }, [index, page.start, measuring, wordMs, content])

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
      <div className={`page-text${page.turn ? ` entering-${page.turn}` : ''}`} key={page.start} ref={text}>
        {content}
      </div>
    </div>
  )
}

function clearGhost(g: HTMLElement) {
  g.replaceChildren()
  g.className = 'page-ghost'
}
