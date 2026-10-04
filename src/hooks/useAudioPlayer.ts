import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { AudioSource } from '../lib/audio'

/** The parts of YouTube's IFrame Player API used here. */
interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  destroy(): void
}
interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string
      width?: string | number
      height?: string | number
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: () => void
        onStateChange?: (e: { data: number }) => void
        onError?: (e: { data: number }) => void
      }
    },
  ) => YTPlayer
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const YT_PLAYING = 1

let youTubeApi: Promise<YTNamespace> | null = null
/** Loads YouTube's player script once, when a video is first played. */
function loadYouTube(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  youTubeApi ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT!)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      youTubeApi = null
      reject(new Error('YouTube couldn’t be reached. Check your connection.'))
    }
    document.head.appendChild(script)
  })
  return youTubeApi
}

export interface AudioPlayer {
  playing: boolean
  /** Why it can't play, in words for the reader. */
  error: string | null
  /** Start playing from `seconds`. Call from a tap so phones allow sound. */
  play: (seconds: number) => void
  pause: () => void
  /** Where playback is now, in seconds. */
  currentTime: () => number
}

/**
 * Plays an audiobook from a YouTube video (in a small visible player inside
 * `container`, as YouTube requires) or an audio file from the web or the
 * device.
 */
export function useAudioPlayer(
  source: AudioSource | null,
  file: Blob | null,
  container: RefObject<HTMLElement | null>,
): AudioPlayer {
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const yt = useRef<Promise<YTPlayer> | null>(null)
  const ytPlayer = useRef<YTPlayer | null>(null)
  const kind = source?.kind ?? null
  /** What identifies the recording: a video id or an address. Saving new timestamps keeps it, and the player. */
  const key = !source ? '' : source.kind === 'youtube' ? source.videoId : source.kind === 'url' ? source.url : source.name
  const fileMissing = kind === 'file' && !file

  // An audio file (from the web or the device) plays in an <audio> element.
  useEffect(() => {
    if (kind !== 'url' && kind !== 'file') return
    if (kind === 'file' && !file) return
    const url = kind === 'file' ? URL.createObjectURL(file!) : key
    const el = new Audio()
    el.preload = 'metadata'
    el.src = url
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onError = () => {
      setPlaying(false)
      setError('This audio couldn’t be played. Links need to go straight to an audio file, such as an MP3.')
    }
    const events = [['play', onPlay], ['pause', onPause], ['ended', onPause], ['error', onError]] as const
    for (const [name, handler] of events) el.addEventListener(name, handler)
    audio.current = el
    return () => {
      for (const [name, handler] of events) el.removeEventListener(name, handler)
      el.pause()
      el.removeAttribute('src')
      el.load()
      audio.current = null
      if (kind === 'file') URL.revokeObjectURL(url)
      setPlaying(false)
      setError(null)
    }
  }, [kind, key, file])

  useEffect(
    () => () => {
      ytPlayer.current?.destroy()
      ytPlayer.current = null
      yt.current = null
      setPlaying(false)
      setError(null)
    },
    [key],
  )

  /** The YouTube player, created on first play. */
  const youTube = useCallback((): Promise<YTPlayer> => {
    if (!source || source.kind !== 'youtube') return Promise.reject(new Error('Not a video'))
    if (yt.current) return yt.current
    const host = container.current
    if (!host) return Promise.reject(new Error('No player'))
    const mount = document.createElement('div')
    host.replaceChildren(mount)
    const created = loadYouTube().then(
      (YT) =>
        new Promise<YTPlayer>((resolve) => {
          const player = new YT.Player(mount, {
            videoId: source.videoId,
            width: '100%',
            height: '100%',
            playerVars: { playsinline: 1, rel: 0 },
            events: {
              onReady: () => {
                ytPlayer.current = player
                resolve(player)
              },
              onStateChange: (e) => setPlaying(e.data === YT_PLAYING),
              onError: () => {
                setPlaying(false)
                setError('This video can’t be played here. Some videos don’t allow it; try another.')
              },
            },
          })
        }),
    )
    created.catch(() => {
      yt.current = null
    })
    yt.current = created
    return created
  }, [source, container])

  const play = useCallback(
    (seconds: number) => {
      setError(null)
      if (source?.kind === 'youtube') {
        youTube().then(
          (p) => {
            p.seekTo(seconds, true)
            p.playVideo()
          },
          (e: Error) => setError(e.message),
        )
        return
      }
      const el = audio.current
      if (!el) return
      const start = () => {
        el.currentTime = Math.min(seconds, Number.isFinite(el.duration) ? Math.max(0, el.duration - 1) : seconds)
        el.play().catch(() => {})
      }
      if (el.readyState >= 1) start()
      else {
        el.addEventListener('loadedmetadata', start, { once: true })
        // Phones only allow sound in response to a tap: start now, then move to the spot.
        el.play().catch(() => {})
      }
    },
    [source, youTube],
  )

  const pause = useCallback(() => {
    audio.current?.pause()
    ytPlayer.current?.pauseVideo()
  }, [])

  const currentTime = useCallback(() => {
    if (source?.kind === 'youtube') return ytPlayer.current?.getCurrentTime() ?? 0
    return audio.current?.currentTime ?? 0
  }, [source])

  return {
    playing,
    error: fileMissing ? 'This audiobook file isn’t on this device. Choose it again.' : error,
    play,
    pause,
    currentTime,
  }
}
