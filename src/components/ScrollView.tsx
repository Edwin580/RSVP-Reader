import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DOUBLE_TAP_MS, hasSelection } from '../hooks/usePressGestures'
import { edgeSpeed, focusRange, groupLines, lineAt, lineOf, windowAround, type Line } from '../lib/guide'
import { paragraphsBetween } from '../lib/pages'
import type { PageNav } from './PageView'

interface Props {
  words: string[]
  paragraphEnds: number[]
  /** Word ranges set as headings (chapter titles). */
  headings: { start: number; end: number }[]
  index: number
  scale: number
  /** The reading font setting; lines are re-measured when it changes. */
  font?: string
  /** How many lines stay clear around the focused one (1 or 3); the rest black out. */
  focusLines: number
  onSeek: (index: number) => void
  /** Double-tap on a word: select it, for the system's Look Up, Copy and so on. */
  onSelectWord?: (index: number) => void
  /** Filled with navigation for the reader's keys and buttons. */
  navRef?: React.RefObject<PageNav | null>
}

/** Words laid out either side of the reading position (see windowAround). */
const REACH = 1500
/** Close to the edge of what's laid out (in words), the stretch moves along. */
const MARGIN = 400
/** Where the focused line comes to rest, as a share of the view's height from the top. */
const REST = 0.3
/** Below this share of the height, a line that's let go of glides back up to REST. */
const LOW = 0.6
/** Wheel distance (px) that moves the focus one line. */
const WHEEL_STEP = 40

/**
 * Guide, continuous: the book as one column with no pages. Holding the text
 * puts the focus on the line under the finger and dragging moves it along,
 * as on a page; held near the bottom (or top), the text scrolls on under the
 * finger, faster the closer to the edge. Let go low down and the focused
 * line glides back up, leaving room to carry on.
 *
 * The column is moved with a transform rather than scrolled, so nothing but
 * the finger moves it, and only a stretch of the book around the reading
 * position is laid out, moved along as reading nears its ends.
 */
export function ScrollView({ words, paragraphEnds, headings, index, scale, font, focusLines, onSeek, onSelectWord, navRef }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const ends = useMemo(() => new Set(paragraphEnds), [paragraphEnds])
  const headingStarts = useMemo(() => new Set(headings.map((h) => h.start)), [headings])
  const [stretch, setStretch] = useState(() => windowAround(paragraphEnds, index, REACH, words.length))
  // How far the column is moved up (px), and the lines as laid out.
  const offset = useRef(0)
  const lines = useRef<Line[]>([])
  // Set when the focus moved under the finger (or by a key here), so the
  // column isn't re-placed as it is after a jump from elsewhere.
  const ownMove = useRef(false)
  const lastClick = useRef<{ i: number; at: number } | null>(null)
  const selectionClick = useRef(false)

  const content = useMemo(
    () =>
      paragraphsBetween(ends, stretch.from, stretch.to).map((para) => {
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
    [ends, headingStarts, stretch, words],
  )

  const height = () => box.current?.clientHeight ?? 0
  const place = (to: number, glide = false) => {
    const t = text.current
    if (!t) return
    // No higher than the first line resting at REST, no lower than the last.
    const all = lines.current
    const h = height()
    const min = all.length ? all[0].top - h * REST : 0
    const max = all.length ? all[all.length - 1].bottom - h * REST : 0
    offset.current = Math.min(Math.max(to, min), Math.max(min, max))
    t.style.transition = glide ? 'transform 0.3s cubic-bezier(0.2, 0.7, 0.2, 1)' : 'none'
    t.style.transform = `translateY(${-offset.current}px)`
  }
  const measure = () => {
    lines.current = groupLines(
      Array.from(text.current?.querySelectorAll<HTMLElement>('[data-i]') ?? [], (s) => ({
        i: Number(s.dataset.i),
        top: s.offsetTop,
        height: s.offsetHeight,
      })),
    )
  }
  const focusedLine = () => lines.current[lineOf(lines.current, index)]

  // Lay out again when the stretch, size or font changes, keeping the
  // focused line where it was on screen.
  const anchor = useRef<number | null>(null)
  useLayoutEffect(() => {
    const before = anchor.current
    measure()
    const line = focusedLine()
    if (!line) return
    if (before === null) place(line.top - height() * REST)
    else place(line.top - before)
    anchor.current = null
    // `index` and the helpers are read fresh; this runs for a new layout only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, scale, font])
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const line = focusedLine()
      const y = line ? line.top - offset.current : 0
      measure()
      const now = focusedLine()
      if (now) place(now.top - y)
    })
    observer.observe(el)
    return () => observer.disconnect()
  })

  // Follow the reading position: move the stretch along near its ends, and
  // after a jump from elsewhere (search, the progress bar) bring the line into view.
  useLayoutEffect(() => {
    const own = ownMove.current
    ownMove.current = false
    const nearStart = index < stretch.from + MARGIN && stretch.from > 0
    const nearEnd = index > stretch.to - MARGIN && stretch.to < words.length - 1
    if (nearStart || nearEnd) {
      const line = focusedLine()
      // Outside what's laid out (a jump), it starts at REST; otherwise it stays put on screen.
      anchor.current = line && index >= stretch.from && index <= stretch.to ? line.top - offset.current : null
      setStretch(windowAround(paragraphEnds, index, REACH, words.length))
      return
    }
    const line = focusedLine()
    if (!line || own) return
    const y = line.top - offset.current
    const h = height()
    if (y < h * 0.1 || y > h * 0.8) place(line.top - h * REST, true)
    // For a new position or stretch only; the helpers read the latest layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, stretch, paragraphEnds, words.length])

  // Line focus around the focused line.
  useLayoutEffect(() => {
    const t = text.current
    const all = lines.current
    if (!t || all.length === 0) return
    const [first, last] = focusRange(all.length, lineOf(all, index), focusLines)
    const top = all[first].top
    const bottom = all[last].bottom
    for (const s of t.querySelectorAll<HTMLElement>('[data-i]')) {
      s.classList.toggle('is-dim', s.offsetTop < top || s.offsetTop >= bottom)
    }
  }, [index, content, focusLines, scale, font])

  const seekLine = (k: number) => {
    const line = lines.current[k]
    if (!line || line.start === lines.current[lineOf(lines.current, index)]?.start) return
    ownMove.current = true
    onSeek(line.start)
  }
  // Keys and buttons: a line, or about a screenful, at a time, keeping it in view.
  const moveBy = (step: number) => {
    const all = lines.current
    const k = Math.min(Math.max(lineOf(all, index) + step, 0), all.length - 1)
    const line = all[k]
    if (!line) return
    seekLine(k)
    const y = line.top - offset.current
    if (y < height() * 0.1 || y > height() * LOW) place(line.top - height() * REST, true)
  }
  const screenful = () => {
    const all = lines.current
    const lineHeight = all.length > 1 ? all[1].top - all[0].top : 30
    return Math.max(1, Math.floor((height() * 0.7) / lineHeight))
  }
  useLayoutEffect(() => {
    if (!navRef) return
    navRef.current = {
      next: () => moveBy(screenful()),
      previous: () => moveBy(-screenful()),
      nextLine: () => moveBy(1),
      previousLine: () => moveBy(-1),
    }
  })

  // Holding: the focus follows the finger; near the top or bottom the
  // column scrolls on under it.
  const hold = useRef<{ id: number; y: number; frame: number; at: number } | null>(null)
  const follow = () => {
    const h = hold.current
    if (!h) return
    seekLine(lineAt(lines.current, h.y + offset.current))
  }
  const following = useRef(follow)
  useLayoutEffect(() => {
    following.current = follow
  })
  const startHolding = (e: React.PointerEvent) => {
    const el = box.current
    if (!el) return
    const id = e.pointerId
    const top = el.getBoundingClientRect().top
    const tick = (now: number) => {
      const h = hold.current
      if (!h) return
      const speed = edgeSpeed(h.y, height())
      if (speed) {
        place(offset.current + (speed * Math.min(now - h.at, 50)) / 1000)
        following.current()
      }
      h.at = now
      h.frame = requestAnimationFrame(tick)
    }
    hold.current = { id, y: e.clientY - top, at: performance.now(), frame: requestAnimationFrame(tick) }
    const move = (m: PointerEvent) => {
      if (m.pointerId !== id || !hold.current) return
      hold.current.y = m.clientY - top
      following.current()
    }
    const end = (u: PointerEvent) => {
      if (u.pointerId !== id) return
      cancelAnimationFrame(hold.current?.frame ?? 0)
      hold.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      // Let go low down: the line glides back up, leaving room to carry on.
      const all = lines.current
      const line = all[lineAt(all, u.clientY - top + offset.current)]
      if (line && line.top - offset.current > height() * LOW) place(line.top - height() * REST, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    follow()
  }

  const wheel = useRef(0)

  return (
    <div
      className="page is-guided is-continuous has-focus"
      ref={box}
      style={{ '--page-scale': scale } as React.CSSProperties}
      onPointerDown={(e) => {
        selectionClick.current = hasSelection()
        if (e.button === 0 && !hold.current) startHolding(e)
      }}
      onPointerUp={() => {
        selectionClick.current ||= hasSelection()
      }}
      onWheel={(e) => {
        wheel.current += e.deltaY
        while (Math.abs(wheel.current) >= WHEEL_STEP) {
          const step = Math.sign(wheel.current)
          wheel.current -= step * WHEEL_STEP
          moveBy(step)
        }
      }}
      onClick={(e) => {
        // The press has already moved the focus; a second tap on a word selects it.
        if (selectionClick.current) return
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')
        if (!target || !onSelectWord) return
        const i = Number(target.dataset.i)
        const before = lastClick.current
        const now = performance.now()
        lastClick.current = { i, at: now }
        if (before && before.i === i && now - before.at < DOUBLE_TAP_MS) {
          lastClick.current = null
          onSelectWord(i)
        }
      }}
    >
      <div className="page-text" ref={text}>
        {content}
      </div>
    </div>
  )
}
