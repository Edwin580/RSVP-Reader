import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useGuideLine } from '../hooks/useGuideLine'
import { DOUBLE_TAP_MS, hasSelection, SELECT_HOLD_MS, wordAtPoint } from '../hooks/usePressGestures'
import { focusRange, groupLines, lineAt, lineOf, lineSpacing, windowAround, type Line } from '../lib/guide'
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
/** The reading spot: the line here is the one in focus, as a share of the view's height from the top. */
const REST = 0.3
/** A press that moves less than this (px) is a tap. */
const TAP_SLOP = 8
/** A flick's speed (px/ms) is taken from the finger's last this many ms. */
const FLICK_MS = 100
/** Momentum after a flick: the share of its speed kept each ms, and the speed (px/ms) it stops at. */
const FRICTION = 0.997
const STOP_SPEED = 0.02
/** How long a glide to a line (a tap, a key, a jump) takes (ms). */
const GLIDE_MS = 300

/**
 * Guide, continuous: the book as one column with no pages, which slides
 * under the finger like any scrolling page, carrying on after a flick. The
 * line at the reading spot (a little above the middle) is the one in focus,
 * so the focus stays put on screen and the text moves through it; a tap on
 * a line, the keys and the buttons glide that line to the spot. With nothing
 * marked (no focus, no line) it's just the text, slid to scroll.
 *
 * The column is moved with a transform rather than scrolled, so the page
 * itself never scrolls (Safari's bars), and only a stretch of the book
 * around the reading position is laid out, moved along as reading nears its ends.
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
  const spacing = useRef(0)
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
  // A glide or a flick's momentum under way, moving the column frame by frame.
  const motion = useRef(0)
  const stopMotion = () => {
    cancelAnimationFrame(motion.current)
    motion.current = 0
  }
  useLayoutEffect(() => stopMotion, [])
  /** Moves the column to `to` (clamped); returns whether it was clamped. */
  const place = (to: number) => {
    const t = text.current
    if (!t) return false
    // No higher than the first line at the reading spot, no lower than the last.
    const all = lines.current
    const h = height()
    const min = all.length ? all[0].top - h * REST : 0
    const max = Math.max(min, all.length ? all[all.length - 1].top - h * REST : 0)
    offset.current = Math.min(Math.max(to, min), max)
    t.style.transform = `translateY(${-offset.current}px)`
    return offset.current !== to
  }
  const glide = (to: number) => {
    stopMotion()
    const from = offset.current
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return void place(to)
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / GLIDE_MS)
      place(from + (to - from) * (1 - (1 - t) ** 3))
      motion.current = t < 1 ? requestAnimationFrame(step) : 0
    }
    motion.current = requestAnimationFrame(step)
  }
  // Where a line sits with its top at the reading spot.
  const restingAt = (line: Line) => line.top - height() * REST
  const measure = () => {
    lines.current = groupLines(
      Array.from(text.current?.querySelectorAll<HTMLElement>('[data-i]') ?? [], (s) => ({
        i: Number(s.dataset.i),
        top: s.offsetTop,
        height: s.offsetHeight,
      })),
    )
    spacing.current = lineSpacing(lines.current)
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
    if (before === null) place(restingAt(line))
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
    // Moved from elsewhere: the line comes to the reading spot, so the next
    // slide carries on from it.
    if (Math.abs(restingAt(line) - offset.current) > 1) glide(restingAt(line))
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
  // The focus follows whichever line the column has brought to the reading
  // spot (the nearest, so it moves on halfway between lines).
  const slideTo = (to: number) => {
    const clamped = place(to)
    seekLine(lineAt(lines.current, offset.current + height() * REST + spacing.current / 2))
    return clamped
  }
  // A line to the reading spot, the focus going there with it.
  const bringUp = (k: number) => {
    const line = lines.current[k]
    if (!line) return
    seekLine(k)
    glide(restingAt(line))
  }
  // Keys and buttons: a line, or about a screenful, at a time.
  const moveBy = (step: number) => {
    const all = lines.current
    bringUp(Math.min(Math.max(lineOf(all, index) + step, 0), all.length - 1))
  }
  const screenful = () => {
    const all = lines.current
    const lineHeight = all.length > 1 ? all[1].top - all[0].top : 30
    return Math.max(1, Math.floor((height() * 0.7) / lineHeight))
  }

  // Holding anywhere and dragging slides the column with the finger, from
  // where it was (moved by the drag's steps, as the laid-out stretch can move
  // along mid-drag), and a flick carries on, slowing down. A tap brings the
  // line tapped to the reading spot, when there's a mark to show it.
  const marked = focusLines > 0 || line
  const hold = useRef<{ id: number; x: number; y: number; lastY: number; moved: boolean; track: { y: number; at: number }[] } | null>(null)
  const follow = (clientX: number, clientY: number) => {
    const h = hold.current
    if (!h || lines.current.length === 0) return
    if (Math.abs(clientX - h.x) > TAP_SLOP || Math.abs(clientY - h.y) > TAP_SLOP) h.moved = true
    const now = performance.now()
    h.track = [...h.track.filter((p) => now - p.at < FLICK_MS), { y: clientY, at: now }]
    slideTo(offset.current - (clientY - h.lastY))
    h.lastY = clientY
  }
  const fling = (track: { y: number; at: number }[]) => {
    const first = track[0]
    const last = track[track.length - 1]
    if (!first || last.at - first.at < 1 || performance.now() - last.at > FLICK_MS) return
    let speed = -(last.y - first.y) / (last.at - first.at)
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let before = performance.now()
    const step = (now: number) => {
      const dt = now - before
      before = now
      speed *= FRICTION ** dt
      const clamped = slideTo(offset.current + speed * dt)
      motion.current = !clamped && Math.abs(speed) > STOP_SPEED ? requestAnimationFrame(step) : 0
    }
    motion.current = requestAnimationFrame(step)
  }
  // The tapped line glides up once a second tap (a double tap, selecting a
  // word) can no longer come, so that tap lands on the same word.
  const pendingGlide = useRef(0)
  useLayoutEffect(() => () => window.clearTimeout(pendingGlide.current), [])
  const tapAt = (clientY: number) => {
    const el = box.current
    const all = lines.current
    if (!el || all.length === 0 || !marked) return
    const y = clientY - el.getBoundingClientRect().top + offset.current
    if (y < all[0].top - TAP_SLOP || y > all[all.length - 1].bottom + TAP_SLOP) return
    const k = lineAt(all, y)
    seekLine(k)
    // Found again by its first word, as the stretch may have moved along by then.
    const start = all[k].start
    pendingGlide.current = window.setTimeout(() => {
      const line = lines.current[lineOf(lines.current, start)]
      if (line && !hasSelection()) glide(restingAt(line))
    }, DOUBLE_TAP_MS)
  }
  // Selecting a word (for Look Up) moves the place to it, but leaves the text
  // where it is, under the finger.
  const selectHere = (i: number) => {
    ownMove.current = true
    onSelectWord?.(i)
  }
  const latest = useRef({ follow, tapAt, fling })
  useLayoutEffect(() => {
    latest.current = { follow, tapAt, fling }
  })
  // Followed on the window: the stage takes the pointer over during a long press.
  const press = (e: React.PointerEvent) => {
    if (hold.current) return
    // A press catches the column mid-glide or mid-flick, where it is.
    const moving = motion.current !== 0
    stopMotion()
    window.clearTimeout(pendingGlide.current)
    const id = e.pointerId
    hold.current = { id, x: e.clientX, y: e.clientY, lastY: e.clientY, moved: moving, track: [] }
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
      const h = hold.current
      stop()
      if (!h || u.type !== 'pointerup') return
      if (h.moved) latest.current.fling(h.track)
      else latest.current.tapAt(u.clientY)
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
          selectHere(i)
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
        // Scrolled as far as the wheel or trackpad goes (lines count as 16px).
        stopMotion()
        slideTo(offset.current + e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height() : 1))
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
          selectHere(i)
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
