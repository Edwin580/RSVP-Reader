import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { trackStarts, type AudioSource, type Track } from '../lib/audio'

/** The parts of YouTube's IFrame Player API used here. */
interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  setPlaybackRate(rate: number): void
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
/** Loads YouTube's player script once. */
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
  /** Start playing from `seconds` into the whole recording. Call from a tap so phones allow sound. */
  play: (seconds: number) => void
  pause: () => void
  /** Where playback is in the whole recording, in seconds. */
  currentTime: () => number
  /** Playback speed (1 = as recorded). */
  setSpeed: (speed: number) => void
  /**
   * Call from a tap when playing will only start later (once lining up is
   * done): phones allow sound only in response to a tap, and remember it for
   * the player once it has played.
   */
  unlock: () => void
  /** Still moving to where `play` asked for; `currentTime` gives that spot until it gets there. */
  seeking: () => boolean
  /** Track `k` is already here (downloaded for lining up): play it from memory, not the network. */
  provide: (k: number, file: Blob) => void
}

/** The files to play in turn: a recording's tracks, or a single file of unknown length. */
function tracksOf(source: AudioSource | null, file: Blob | null): Track[] | null {
  if (!source) return null
  if (source.kind === 'archive') return source.tracks
  if (source.kind === 'url') return [{ url: source.url, title: '', seconds: Infinity }]
  if (source.kind === 'file' && file) return [{ url: '', title: source.name, seconds: Infinity }]
  return null
}

/**
 * Plays an audiobook: a YouTube video (in a hidden player inside
 * `container`), a recording made of several files played back to back as
 * one, or a single audio file from the web or the device.
 */
export function useAudioPlayer(
  source: AudioSource | null,
  file: Blob | null,
  container: RefObject<HTMLElement | null>,
): AudioPlayer {
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const speed = useRef(1)
  /** Where `play` asked to go, until playback gets there (seconds into the whole recording), or null. */
  const target = useRef<{ seconds: number; since: number } | null>(null)
  /** Briefly playing (muted) only to be allowed to play later; not the listener playing. */
  const unlocking = useRef(false)
  const kind = source?.kind ?? null
  /** What identifies the recording; saving new timestamps keeps it, and the player. */
  const key = !source
    ? ''
    : source.kind === 'youtube'
      ? source.videoId
      : source.kind === 'url'
        ? source.url
        : source.kind === 'file'
          ? source.name
          : source.identifier
  const fileMissing = kind === 'file' && !file

  // Audio files play in an <audio> element, one track at a time.
  const audio = useRef<HTMLAudioElement | null>(null)
  const tracks = useRef<{ list: Track[]; starts: number[]; current: number }>({ list: [], starts: [], current: -1 })
  /** Tracks already downloaded, as addresses of their copies in memory. */
  const local = useRef(new Map<number, string>())
  const urlOf = (k: number) => local.current.get(k) ?? tracks.current.list[k].url
  const latest = useRef({ source, file })
  useEffect(() => {
    latest.current = { source, file }
  })
  useEffect(() => {
    const list = tracksOf(latest.current.source, latest.current.file)
    if (!list) return
    const objectUrl = kind === 'file' ? URL.createObjectURL(latest.current.file!) : null
    if (objectUrl) list[0] = { ...list[0], url: objectUrl }
    tracks.current = { list, starts: trackStarts(list), current: -1 }
    const kept = local.current
    const el = new Audio()
    el.preload = 'metadata'
    /** Moving on to the next track pauses the element for a moment; that isn't the listener pausing. */
    let advancing = false
    const load = (k: number) => {
      tracks.current.current = k
      el.src = urlOf(k)
      // Loading a file resets the speed to the default one.
      el.defaultPlaybackRate = speed.current
      el.playbackRate = speed.current
    }
    const onPlay = () => {
      if (unlocking.current) return
      advancing = false
      setPlaying(true)
    }
    const onPause = () => {
      if (!advancing && !unlocking.current) setPlaying(false)
    }
    // There at last: the sound comes on (it's muted while the file loads and seeks, so nothing else is heard first).
    const onSeeked = () => {
      if (!target.current || unlocking.current) return
      target.current = null
      el.muted = false
    }
    const onEnded = () => {
      const t = tracks.current
      if (t.current + 1 >= t.list.length) {
        setPlaying(false)
        return
      }
      advancing = true
      load(t.current + 1)
      el.play().catch(() => setPlaying(false))
    }
    const onError = () => {
      setPlaying(false)
      setError('This audio couldn’t be played. Links need to go straight to an audio file, such as an MP3.')
    }
    const events = [['play', onPlay], ['pause', onPause], ['ended', onEnded], ['error', onError], ['seeked', onSeeked]] as const
    for (const [name, handler] of events) el.addEventListener(name, handler)
    load(0)
    audio.current = el
    return () => {
      for (const [name, handler] of events) el.removeEventListener(name, handler)
      el.pause()
      el.removeAttribute('src')
      el.load()
      audio.current = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      for (const url of kept.values()) URL.revokeObjectURL(url)
      kept.clear()
      setPlaying(false)
      setError(null)
    }
  }, [kind, key, file])

  // A video plays in YouTube's player, made as soon as there's a video so a
  // tap can start it straight away (phones only allow sound from a tap).
  const yt = useRef<YTPlayer | null>(null)
  const pendingPlay = useRef<number | null>(null)
  const videoId = source?.kind === 'youtube' ? source.videoId : null
  useEffect(() => {
    const host = container.current
    if (!videoId || !host) return
    const mount = document.createElement('div')
    host.replaceChildren(mount)
    let player: YTPlayer | null = null
    let live = true
    loadYouTube().then(
      (YT) => {
        if (!live) return
        player = new YT.Player(mount, {
          videoId,
          width: '200',
          height: '200',
          playerVars: { playsinline: 1, rel: 0, controls: 0 },
          events: {
            onReady: () => {
              if (!live || !player) return
              yt.current = player
              player.setPlaybackRate(speed.current)
              if (pendingPlay.current !== null) {
                player.seekTo(pendingPlay.current, true)
                player.playVideo()
                pendingPlay.current = null
              }
            },
            onStateChange: (e) => setPlaying(e.data === YT_PLAYING),
            onError: () => {
              setPlaying(false)
              setError('This video can’t be played here. Some videos don’t allow it; try another.')
            },
          },
        })
      },
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
      player?.destroy()
      yt.current = null
      pendingPlay.current = null
      host.replaceChildren()
      setPlaying(false)
      setError(null)
    }
  }, [videoId, container])

  const play = useCallback(
    (seconds: number) => {
      setError(null)
      if (kind === 'youtube') {
        target.current = { seconds, since: performance.now() }
        if (yt.current) {
          yt.current.seekTo(seconds, true)
          yt.current.playVideo()
        } else pendingPlay.current = seconds
        return
      }
      const el = audio.current
      if (!el) return
      unlocking.current = false
      target.current = { seconds, since: performance.now() }
      el.muted = true
      const t = tracks.current
      let k = 0
      while (k + 1 < t.starts.length && t.starts[k + 1] <= seconds) k++
      const offset = seconds - t.starts[k]
      if (k !== t.current || el.src !== urlOf(k)) {
        // Not the file loaded (or now there's a copy in memory): until it's loaded, the old one's position means nothing.
        t.current = k
        el.src = urlOf(k)
        el.defaultPlaybackRate = speed.current
        el.playbackRate = speed.current
      }
      const seek = () => {
        const to = Number.isFinite(el.duration) ? Math.min(offset, Math.max(0, el.duration - 1)) : offset
        // Already there (no seek will happen): sound on now.
        if (Math.abs(el.currentTime - to) < 0.05) {
          target.current = null
          el.muted = false
        }
        el.currentTime = to
      }
      if (el.readyState >= 1) seek()
      else el.addEventListener('loadedmetadata', seek, { once: true })
      // Play straight away, inside the tap, or phones refuse; the seek follows once the file's length is known.
      el.play().catch(() => {})
    },
    [kind],
  )

  const pause = useCallback(() => {
    target.current = null
    audio.current?.pause()
    yt.current?.pauseVideo()
    pendingPlay.current = null
  }, [])

  const seeking = useCallback(() => {
    const asked = target.current
    if (!asked) return false
    // YouTube says nothing when a seek is done: there once its time is close, or after a moment.
    if (kind === 'youtube') {
      const now = yt.current?.getCurrentTime() ?? 0
      if (Math.abs(now - asked.seconds) < 2 || performance.now() - asked.since > 3000) target.current = null
    }
    return target.current !== null
  }, [kind])

  const currentTime = useCallback(() => {
    if (seeking()) return target.current!.seconds
    if (kind === 'youtube') return yt.current?.getCurrentTime() ?? 0
    const t = tracks.current
    return (t.starts[t.current] ?? 0) + (audio.current?.currentTime ?? 0)
  }, [kind, seeking])

  const unlock = useCallback(() => {
    const el = audio.current
    if (!el || !el.paused) return
    unlocking.current = true
    el.muted = true
    const done = () => {
      if (!unlocking.current) return
      unlocking.current = false
      el.pause()
      el.muted = false
    }
    el.play().then(done, done)
  }, [])

  const setSpeed = useCallback((next: number) => {
    if (next === speed.current) return
    speed.current = next
    if (audio.current) audio.current.playbackRate = next
    yt.current?.setPlaybackRate(next)
  }, [])

  const provide = useCallback((k: number, file: Blob) => {
    if (local.current.has(k)) return
    local.current.set(k, URL.createObjectURL(file))
    // Only a few chapters are kept in memory; older ones go back to the network.
    if (local.current.size > 3) {
      const [oldest, url] = local.current.entries().next().value!
      if (oldest !== tracks.current.current) {
        URL.revokeObjectURL(url)
        local.current.delete(oldest)
      }
    }
  }, [])

  return {
    playing,
    error: fileMissing ? 'This audiobook file isn’t on this device. Choose it again.' : error,
    play,
    pause,
    currentTime,
    setSpeed,
    unlock,
    seeking,
    provide,
  }
}
