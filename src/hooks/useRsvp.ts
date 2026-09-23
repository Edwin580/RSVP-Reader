import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { delayMultiplier } from '../lib/rsvp'

/** Extra time for the first few words after pressing play, so the eye can lock on. */
const RAMP_UP = [1.8, 1.5, 1.25, 1.1]

export function useRsvp(words: string[], paragraphEnds: number[], wpm: number, initialIndex = 0) {
  const [index, setIndexState] = useState(() => clamp(initialIndex, words.length))
  const [playing, setPlaying] = useState(false)
  const sincePlay = useRef(0)
  const ends = useMemo(() => new Set(paragraphEnds), [paragraphEnds])

  useEffect(() => {
    if (!playing) return
    const base = 60000 / wpm
    const ramp = RAMP_UP[sincePlay.current] ?? 1
    const delay = base * delayMultiplier(words[index] ?? '', ends.has(index)) * ramp
    const timer = window.setTimeout(() => {
      sincePlay.current++
      if (index >= words.length - 1) setPlaying(false)
      else setIndexState(index + 1)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [playing, index, wpm, words, ends])

  const play = useCallback(() => {
    sincePlay.current = 0
    setIndexState((i) => (i >= words.length - 1 ? 0 : i))
    setPlaying(true)
  }, [words.length])

  const pause = useCallback(() => setPlaying(false), [])

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play])

  const seek = useCallback(
    (i: number) => {
      sincePlay.current = 0
      setIndexState(clamp(i, words.length))
    },
    [words.length],
  )

  return { index, playing, play, pause, toggle, seek }
}

function clamp(i: number, length: number): number {
  return Math.max(0, Math.min(i, length - 1))
}
