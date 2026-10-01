import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DOUBLE_TAP_MS, hasSelection } from '../hooks/usePressGestures'
import { paragraphsBetween } from '../lib/pages'
import { Pagination, type Page } from '../lib/pagination'
import { measurePage } from './measurePage'

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
  /** How long the current word is shown, so the marker moves at reading pace. */
  wordMs: number
  /** Extra time the reader adds to the first word of a line, and of a new page. */
  lineReturnMs: number
  turnMs: number
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
}

export interface PageNav {
  next: () => void
  previous: () => void
}

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
  wordMs,
  lineReturnMs,
  turnMs,
  focusLines = 0,
  onSeek,
  onSelectWord,
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
  const lastClick = useRef<{ i: number; at: number } | null>(null)
  const selectionClick = useRef(false)
  // A hidden copy of the text area that pages are measured in.
  const measurer = useRef<HTMLDivElement>(null)
  // The book's pages for the current layout (size, text size, font). Thrown
  // away and found again whenever any of those change.
  const pagination = useRef<Pagination | null>(null)
  const [layoutVersion, setLayoutVersion] = useState(0)
  // The page shown, with its number once every page is known.
  const [page, setPage] = useState<
    (Page & { turn: 'forward' | 'back' | null; number: { page: number; total: number } | null }) | null
  >(null)
  const relayout = () => {
    pagination.current = null
    setPage(null)
    setLayoutVersion((v) => v + 1)
  }

  // Show the page with the reading position: on opening, after a re-layout,
  // and whenever reading (or a jump) leaves the page shown.
  useLayoutEffect(() => {
    if (!measurer.current || words.length === 0) return
    if (page && index >= page.start && index <= page.end) return
    if (!pagination.current) {
      // Lay out a little more than the last full page held (measurePage
      // tries again with more if that all fits).
      let perPage = 0
      pagination.current = new Pagination(words.length, chapterStarts, (start, limit) => {
        const chunk = perPage ? Math.round(perPage * 1.3) + 30 : undefined
        const end = measurePage(measurer.current!, words, ends, headingStarts, start, limit, chunk)
        if (end < limit) perPage = end - start + 1
        return end
      })
    }
    const pages = pagination.current
    const next = pages.pageAt(index)
    const number = pages.number(next)
    if (!page) {
      setPage({ ...next, turn: null, number })
      return
    }
    // Keep a copy of the outgoing page on screen to slide it away.
    const direction = next.start > page.start ? 'forward' : 'back'
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
    setPage({ ...next, turn: direction, number })
  }, [index, page, layoutVersion, words, chapterStarts, ends, headingStarts])

  // The rest of the book is paginated a little at a time in the background,
  // so the page count and numbers appear shortly after opening.
  useEffect(() => {
    let timer = 0
    const work = () => {
      const p = pagination.current
      if (!p) return
      const until = performance.now() + 12
      if (p.work(() => performance.now() > until)) setPage((shown) => shown && { ...shown, number: p.number(shown) })
      else timer = window.setTimeout(work, 30)
    }
    timer = window.setTimeout(work, 300)
    return () => window.clearTimeout(timer)
  }, [layoutVersion])

  // Report the page and where its lines begin (the reader gives line starts a beat more).
  useLayoutEffect(() => {
    if (!page) return
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

  // Re-paginate when the available space changes, or the text size or font,
  // or once the book's font has loaded (pages measured before then are off).
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    let last = { w: el.clientWidth, h: el.clientHeight }
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === last.w && el.clientHeight === last.h) return
      last = { w: el.clientWidth, h: el.clientHeight }
      relayout()
    })
    observer.observe(el)
    const fonts = document.fonts
    fonts?.addEventListener?.('loadingdone', relayout)
    return () => {
      observer.disconnect()
      fonts?.removeEventListener?.('loadingdone', relayout)
    }
  }, [])
  const layout = `${scale} ${font}`
  const firstLayout = useRef(layout)
  useLayoutEffect(() => {
    if (firstLayout.current === layout) return
    firstLayout.current = layout
    relayout()
  }, [layout])

  useLayoutEffect(() => {
    if (!navRef) return
    navRef.current = {
      next: () => {
        const next = page && pagination.current?.next(page)
        if (next) onSeek(next.start)
      },
      previous: () => {
        const previous = page && pagination.current?.previous(page)
        onSeek(previous ? previous.start : 0)
      },
    }
  })

  const measuring = page === null
  const pageStart = page?.start ?? -1
  const pageEnd = page?.end ?? -2
  // Set the page lower only when it opens with a title, like a chapter's first page.
  const opensChapter = headingStarts.has(pageStart)
  const content = useMemo(
    () =>
      paragraphsBetween(ends, pageStart, pageEnd).map((para) => {
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
    [ends, headingStarts, pageStart, pageEnd, words],
  )
  const number = page?.number

  // Move the highlight and the line to the current word. Both work like a
  // highlighter pen drawn along the line: they cover the line from its first
  // word up to the end of the current one, and while playing their end moves
  // steadily through each word over exactly the time it's shown, so they
  // never stop. They grow with a transform (scaleX) rather than a width, so
  // the browser animates them off the main thread and they stay smooth
  // while the page re-renders for each word.
  const prev = useRef<{ index: number; top: number; start: number; lineLeft: number; lineWidth: number } | null>(null)
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
    const newPage = !before || before.start !== pageStart
    const newLine = !newPage && before.top !== top
    // Anything but reading on to the next word restarts the sweep at this
    // word. Staying on the same word (pausing, say) keeps it as it is.
    const restart = newPage || newLine || (before.index !== index - 1 && before.index !== index)
    // The line runs from its first word to its last.
    let lineLeft = before?.lineLeft ?? left
    let lineWidth = before?.lineWidth ?? width
    if (newPage || newLine) {
      let first = span
      let last = span
      for (let s = at(index - 1); s && s.offsetTop === top; s = at(Number(s.dataset.i) - 1)) first = s
      for (let s = at(index + 1); s && s.offsetTop === top; s = at(Number(s.dataset.i) + 1)) last = s
      lineLeft = first.offsetLeft
      lineWidth = Math.max(last.offsetLeft + last.offsetWidth - lineLeft, 1)
    }
    prev.current = { index, top, start: pageStart, lineLeft, lineWidth }
    // How long this word is actually on screen, including the reader's extra beats.
    const shownMs = Math.max(wordMs + (newPage && before ? turnMs : newLine ? lineReturnMs : 0), 16)

    // `pad` widens the highlight a little past the words at both ends.
    const sweep = (el: HTMLElement, y: number, h: number, pad: number) => {
      const x = lineLeft - pad
      const w = lineWidth + pad * 2
      const to = (left + width + pad - x) / w
      const place = (f: number) => `translate(${x}px, ${y}px) scaleX(${Math.min(Math.max(f, 0), 1)})`
      el.style.width = `${w}px`
      el.style.height = `${h}px`
      if (restart) {
        // Covered at once up to the current word (or through it, paused).
        el.style.transition = 'none'
        el.style.transform = place(playing ? (left + pad - x) / w : to)
        void el.offsetWidth
      }
      if (playing) {
        el.style.transition = `transform ${shownMs}ms linear`
        el.style.transform = place(to)
      } else if (!restart) {
        el.style.transition = 'none'
        el.style.transform = place(to)
      }
    }
    sweep(p, top + height - 2, 2, 0)
    sweep(m, top, height, 3)

    if (newPage) {
      // Appear once the new page has slid in, so the eye lands on it.
      for (const el of [m, p]) {
        el.style.opacity = '0'
        void el.offsetWidth
        const delay = TURN_MS - 60
        el.style.transition = `opacity 180ms ease-out ${delay}ms, transform ${Math.max(shownMs - delay, 16)}ms linear ${delay}ms`
      }
    }
    m.style.opacity = '1'
    p.style.opacity = '1'
  }, [index, pageStart, measuring, wordMs, lineReturnMs, turnMs, content, playing])

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
  }, [index, pageStart, measuring, content, focusLines])

  return (
    <div
      className={`page${measuring ? ' is-measuring' : ''}${focusLines ? ' has-focus' : ''}${playing ? ' is-playing' : ''}`}
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
        if (!target) return onToggle()
        const i = Number(target.dataset.i)
        // The same word tapped twice in quick succession: select it (the
        // first tap has already jumped there).
        const before = lastClick.current
        const now = performance.now()
        lastClick.current = { i, at: now }
        if (before && before.i === i && now - before.at < DOUBLE_TAP_MS && onSelectWord) {
          lastClick.current = null
          onSelectWord(i)
        } else onSeek(i)
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
        className={`page-text${opensChapter ? ' opens-chapter' : ''}${page?.turn ? ` entering-${page.turn}` : ''}`}
        key={pageStart}
        ref={text}
      >
        {content}
      </div>
      <div className="page-measure" ref={measurer} aria-hidden="true" />
      <div className="page-folio" aria-label={number ? `Page ${number.page} of ${number.total}` : undefined}>
        {number && `${number.page} of ${number.total}`}
      </div>
    </div>
  )
}

function clearGhost(g: HTMLElement) {
  g.replaceChildren()
  g.className = 'page-ghost'
}
