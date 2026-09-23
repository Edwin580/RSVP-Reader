import { useCallback, useEffect, useRef, useState } from 'react'

/** Extra time for the first few words after pressing play, so the eye can lock on. */
const RAMP_UP = [1.8, 1.5, 1.25, 1.1]

/** If playback falls this far behind (e.g. a background tab), resync instead of racing to catch up. */
const MAX_LAG_MS = 1000

/**
 * Plays words one at a time. `weights[i] × 60000 / wpm` is how long word i
 * stays on screen.
 *
 * Each word is scheduled against the ideal time it should appear, not
 * "now + delay", so timer and render latency don't pile up into drift and
 * uneven rhythm.
 */
export function useRsvp(weights: Float32Array, wpm: number, initialIndex = 0) {
  const count = weights.length
  const [index, setIndexState] = useState(() => clamp(initialIndex, count))
  const [playing, setPlaying] = useState(false)
  const sincePlay = useRef(0)
  /** When the current word was due on screen, in performance.now() time. */
  const clock = useRef<{ index: number; at: number } | null>(null)

  useEffect(() => {
    if (!playing) {
      clock.current = null
      return
    }
    const now = performance.now()
    if (!clock.current || clock.current.index !== index || now - clock.current.at > MAX_LAG_MS) {
      clock.current = { index, at: now }
    }
    const duration = (60000 / wpm) * (weights[index] ?? 1) * (RAMP_UP[sincePlay.current] ?? 1)
    const due = clock.current.at + duration
    const timer = window.setTimeout(() => {
      sincePlay.current++
      if (index >= count - 1) {
        setPlaying(false)
        return
      }
      clock.current = { index: index + 1, at: due }
      setIndexState(index + 1)
    }, Math.max(0, due - performance.now()))
    return () => window.clearTimeout(timer)
  }, [playing, index, wpm, weights, count])

  const play = useCallback(() => {
    sincePlay.current = 0
    setIndexState((i) => (i >= count - 1 ? 0 : i))
    setPlaying(true)
  }, [count])

  const pause = useCallback(() => setPlaying(false), [])

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play])

  const seek = useCallback(
    (i: number) => {
      sincePlay.current = 0
      setIndexState(clamp(i, count))
    },
    [count],
  )

  return { index, playing, play, pause, toggle, seek }
}

function clamp(i: number, length: number): number {
  return Math.max(0, Math.min(i, length - 1))
}
