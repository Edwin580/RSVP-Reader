import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { pageAnchor, paragraphsBetween } from '../lib/pages'

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

/**
 * Guided reading: the book shown as screen-sized pages, with a marker that
 * glides under each word at reading speed and turns the page at the end.
 *
 * Pages are measured, not estimated: a chunk of text is laid out invisibly,
 * the last word that fully fits becomes the page end, and the next page
 * starts right after it. Measured pages are remembered so paging back and
 * forth is stable; they're re-measured when the size changes.
 */
export function PageView({ words, paragraphEnds, index, scale, wordMs, onSeek, onToggle, onPage, navRef }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const marker = useRef<HTMLDivElement>(null)
  const ends = useMemo(() => new Set(paragraphEnds), [paragraphEnds])
  const known = useRef(new Map<number, number>())
  const [page, setPage] = useState<{ start: number; end: number | null }>(() => ({
    start: pageAnchor(words, paragraphEnds, index),
    end: null,
  }))

  // Measure: find the last word that fits, then show only that range.
  useLayoutEffect(() => {
    const el = box.current
    if (!el || page.end !== null) return
    const spans = el.querySelectorAll<HTMLElement>('[data-i]')
    const limit = el.clientHeight
    let lo = 0
    let hi = spans.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      const s = spans[mid]
      if (s.offsetTop + s.offsetHeight <= limit) lo = mid
      else hi = mid - 1
    }
    const end = Number(spans[lo]?.dataset.i ?? page.start)
    known.current.set(page.start, end)
    setPage({ start: page.start, end })
  }, [page])

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
    setPage({ start: next, end: known.current.get(next) ?? null })
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
      setPage((p) => ({ start: p.start, end: null }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const firstScale = useRef(scale)
  useLayoutEffect(() => {
    if (firstScale.current === scale) return
    firstScale.current = scale
    known.current.clear()
    setPage((p) => ({ start: p.start, end: null }))
  }, [scale])

  useLayoutEffect(() => {
    if (!navRef) return
    navRef.current = {
      next: () => {
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
    const el = box.current
    const m = marker.current
    if (!el || !m || measuring) return
    const span = el.querySelector<HTMLElement>(`[data-i="${index}"]`)
    if (!span) {
      m.style.opacity = '0'
      return
    }
    const range = document.createRange()
    range.selectNodeContents(span)
    const rects = range.getClientRects()
    const r = rects[0] ?? span.getBoundingClientRect()
    const base = el.getBoundingClientRect()
    const top = r.top - base.top + el.scrollTop
    const jump = !prev.current || prev.current.top !== top || prev.current.start !== page.start
    prev.current = { top, start: page.start }
    const width = Math.max(r.width, 4)
    m.style.transition = jump ? 'none' : `transform ${Math.min(wordMs * 0.6, 140)}ms ease-out, width ${Math.min(wordMs * 0.6, 140)}ms ease-out`
    m.style.transform = `translate(${r.left - base.left}px, ${top}px)`
    m.style.width = `${width}px`
    m.style.height = `${r.height}px`
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
      <div className="page-marker" ref={marker} aria-hidden="true" />
      <div className="page-text" key={page.start}>
        {content}
      </div>
    </div>
  )
}
