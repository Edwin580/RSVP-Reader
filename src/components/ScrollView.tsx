import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useGuideLine } from '../hooks/useGuideLine'
import { DOUBLE_TAP_MS, hasSelection, SELECT_HOLD_MS, wordAtPoint } from '../hooks/usePressGestures'
import { draggedLine, focusRange, groupLines, lineAt, lineOf, lineSpacing, windowAround, type Line } from '../lib/guide'
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
  /** Lines kept clear around the one in focus; 0 for none blacked out. */
  focusLines: number
  /** A line under the line in focus, moving with it. */
  line?: boolean
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
/** The focused line is kept between these shares of the view's height, the column scrolling along to keep it there. */
const HIGH = 0.15
const LOW = 0.6
/** A press that moves less than this (px) is a tap. */
const TAP_SLOP = 8
/** Wheel distance (px) that moves the focus one line. */
const WHEEL_STEP = 40

/**
 * Guide, continuous: the book as one column with no pages. As on a page,
 * holding anywhere and dragging moves the focus line by line, and a tap
 * moves it to the line tapped; the column scrolls along to keep the focused
 * line in the upper middle of the view, so reading on never runs out of room.
 *
 * The column is moved with a transform rather than scrolled, so nothing but
 * the finger moves it, and only a stretch of the book around the reading
 * position is laid out, moved along as reading nears its ends.
 */
export function ScrollView({ words, paragraphEnds, headings, index, scale, font, focusLines, line = false, onSeek, onSelectWord, navRef }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const guideLine = useRef<HTMLDivElement>(null)
  useGuideLine(text, guideLine, index)
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
    if (!focusLines) {
      for (const s of t.querySelectorAll<HTMLElement>('[data-i]')) s.classList.remove('is-dim')
      return
    }
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
  // The column follows a line that moves out of the middle of the view, so
  // the focus stays in reach: the text scrolls along as you read on.
  const keepInView = (line: Line | undefined) => {
    if (!line) return
    const y = line.top - offset.current
    const h = height()
    if (y > h * LOW) place(line.top - h * LOW, true)
    else if (y < h * HIGH) place(line.top - h * HIGH, true)
  }
  // Keys and buttons: a line, or about a screenful, at a time.
  const moveBy = (step: number) => {
    const all = lines.current
    const k = Math.min(Math.max(lineOf(all, index) + step, 0), all.length - 1)
    seekLine(k)
    keepInView(all[k])
  }
  const screenful = () => {
    const all = lines.current
    const lineHeight = all.length > 1 ? all[1].top - all[0].top : 30
    return Math.max(1, Math.floor((height() * 0.7) / lineHeight))
  }

  // Holding anywhere and dragging: the focus moves a line for every line's
  // height dragged, from the line it was on (kept by its first word, as the
  // laid-out stretch can move along mid-drag), and the column follows to
  // keep it in view. A tap moves the focus to the line tapped.
  const hold = useRef<{ id: number; x: number; y: number; from: number; moved: boolean } | null>(null)
  const follow = (clientX: number, clientY: number) => {
    const h = hold.current
    const all = lines.current
    if (!h || all.length === 0) return
    if (Math.abs(clientX - h.x) > TAP_SLOP || Math.abs(clientY - h.y) > TAP_SLOP) h.moved = true
    const k = Math.min(Math.max(draggedLine(lineOf(all, h.from), clientY - h.y, lineSpacing(all)), 0), all.length - 1)
    seekLine(k)
    keepInView(all[k])
  }
  const tapAt = (clientY: number) => {
    const el = box.current
    const all = lines.current
    if (!el || all.length === 0) return
    const y = clientY - el.getBoundingClientRect().top + offset.current
    if (y < all[0].top - TAP_SLOP || y > all[all.length - 1].bottom + TAP_SLOP) return
    seekLine(lineAt(all, y))
  }
  const latest = useRef({ follow, tapAt })
  useLayoutEffect(() => {
    latest.current = { follow, tapAt }
  })
  // Followed on the window: the stage takes the pointer over during a long press.
  const press = (e: React.PointerEvent) => {
    if (hold.current) return
    const id = e.pointerId
    const line = lines.current[lineOf(lines.current, index)]
    hold.current = { id, x: e.clientX, y: e.clientY, from: line?.start ?? index, moved: false }
    const move = (m: PointerEvent) => {
      if (m.pointerId === id) latest.current.follow(m.clientX, m.clientY)
    }
    const stop = () => {
      window.clearTimeout(held)
      hold.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    const end = (u: PointerEvent) => {
      if (u.pointerId !== id) return
      const tapped = hold.current && !hold.current.moved
      stop()
      if (tapped && u.type === 'pointerup') latest.current.tapAt(u.clientY)
    }
    // The text is selectable (for Look Up): on a touch screen the system's
    // own long press selects a word, and a drag never selects text. A mouse
    // drag would, so with a mouse the press doesn't select text; holding it
    // still on a word selects the word instead.
    const { clientX, clientY } = e
    const mouse = e.pointerType === 'mouse'
    if (mouse) e.preventDefault()
    const held = mouse
      ? window.setTimeout(() => {
          const i = hold.current && !hold.current.moved ? wordAtPoint(clientX, clientY) : null
          if (i === null || !onSelectWord) return
          stop()
          onSelectWord(i)
        }, SELECT_HOLD_MS)
      : undefined
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  useLayoutEffect(() => {
    if (!navRef) return
    navRef.current = {
      next: () => moveBy(screenful()),
      previous: () => moveBy(-screenful()),
      nextLine: () => moveBy(1),
      previousLine: () => moveBy(-1),
      press,
    }
  })

  const wheel = useRef(0)

  return (
    <div
      className={`page is-guided is-continuous${focusLines ? ' has-focus' : ''}`}
      ref={box}
      style={{ '--page-scale': scale } as React.CSSProperties}
      onPointerDown={() => {
        selectionClick.current = hasSelection()
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
        {line && <div className="guide-line" ref={guideLine} aria-hidden="true" />}
      </div>
    </div>
  )
}
