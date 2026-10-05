import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasSelection, usePressGestures } from '../hooks/usePressGestures'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { useRsvp } from '../hooks/useRsvp'
import { alignTranscript } from '../lib/align'
import { authorFromTitle } from '../lib/archive'
import {
  addPoint,
  fileParts,
  formatTime,
  paceAt,
  parseTimestamps,
  partsOf,
  partWindow,
  setPace,
  speedFor,
  syncPoints,
  timeAt,
  trackAt,
  trackRange,
  spokenLetters,
  trackStarts,
  wordAt as wordHeardAt,
  type AudioLink,
  type AudioSource,
} from '../lib/audio'
import { indexAudio, type AudioIndex } from '../lib/media'
import { detectSync, MAX_BYTES } from '../lib/syncClient'
import { glanceRange, pausedRange } from '../lib/glance'
import { recapRange, shouldRecap, timeAgo } from '../lib/recap'
import { chapterTargets, planSession, type Landing } from '../lib/session'
import type { BookAnalysis } from '../lib/analysis'
import { isBookmarked, toggleBookmark } from '../lib/bookmarks'
import { buildTimeline, formatMinutes, minutesBetween, nextSentence, previousSentence } from '../lib/rsvp'
import { BookSearch } from '../lib/searchClient'
import type { Settings } from '../lib/storage'
import type { Book, Bookmark } from '../lib/types'
import { AudioPanel } from './AudioPanel'
import { BookmarksPanel } from './BookmarksPanel'
import { Icon } from './Icon'
import { PageView, type PageNav } from './PageView'
import { Scrubber } from './Scrubber'
import { SearchPanel } from './SearchPanel'
import { SyncPanel } from './SyncPanel'
import { SessionMenu } from './SessionMenu'
import { SettingsMenu } from './SettingsMenu'
import { reducedMotion } from './transition'
import { WordDisplay } from './WordDisplay'

interface Props {
  book: Book
  initialIndex: number
  /** When the book was last read; a long gap shows a "Previously…" recap. */
  lastReadAt?: number
  settings: Settings
  onSettings: (settings: Settings) => void
  onProgress: (index: number) => void
  bookmarks: Bookmark[]
  onBookmarks: (bookmarks: Bookmark[]) => void
  /** The audiobook linked to this book, and its file when it's one from the device. */
  audio: AudioLink | null
  audioFile: Blob | null
  onAudio: (link: AudioLink | null, file?: File) => void
  /** Reports reading time (while playing) and words read, for statistics. */
  onReadingTime: (ms: number, words: number) => void
  /** Reading starts (playback, not browsing), for a finished book to go back on the Reading shelf. */
  onPlay?: () => void
  onClose: () => void
}

const WPM_STEP = 25
const MIN_WPM = 100
const MAX_WPM = 1200
const CONTEXT_WORDS = 40
/** Controls fade out after this long without pointer or key activity while playing. */
const IDLE_MS = 2000
/** Extra time on the first word of a new page in page mode, covering the turn animation. */
const PAGE_TURN_MS = 450
/** Extra time on the first word of each line in page mode, as a fraction of a word. */
const LINE_RETURN = 0.3
/** Length of the panels' closing animation; keep in sync with index.css. */
const PANEL_CLOSE_MS = 200
/** Jumps further than this offer a "back" button, shown for JUMP_BACK_MS. */
const JUMP_BACK_MIN_WORDS = 50
const JUMP_BACK_MS = 8000

export function Reader({
  book,
  initialIndex,
  lastReadAt,
  settings,
  onSettings,
  onProgress,
  bookmarks,
  onBookmarks,
  audio,
  audioFile,
  onAudio,
  onReadingTime,
  onPlay,
  onClose,
}: Props) {
  const { words, chapters } = book
  const { wpm, textScale, wordTiming, mode, font } = settings
  const holdToRead = settings.playControl === 'hold'
  const headings = useMemo(() => book.headings ?? [], [book.headings])
  // People, places and smart-pacing extras, worked out in the background by
  // the search worker. Until they arrive, smart pacing times words naturally.
  const [analysis, setAnalysis] = useState<BookAnalysis | null>(null)
  const extras = wordTiming === 'smart' ? analysis?.extras : undefined
  const timeline = useMemo(
    () => buildTimeline(words, book.paragraphEnds, wordTiming, headings, extras),
    [words, book.paragraphEnds, wordTiming, headings, extras],
  )
  const headingWords = useMemo(() => {
    const set = new Set<number>()
    for (const h of headings) for (let i = h.start; i <= h.end; i++) set.add(i)
    return set
  }, [headings])
  const chapterStarts = useMemo(() => chapters.map((c) => c.start), [chapters])
  // Page mode gives the eye time to travel: the first word of a new page (the
  // word after the visible page's end) waits for the turn, and the first word
  // of each line gets a beat for the sweep back to the left margin.
  const pageEnd = useRef(-1)
  const lineStarts = useRef<Set<number>>(new Set())
  const pageDelay = useCallback(
    (i: number) => {
      if (mode !== 'page') return 0
      if (i === pageEnd.current + 1) return PAGE_TURN_MS
      return lineStarts.current.has(i) ? LINE_RETURN * (60000 / wpm) : 0
    },
    [mode, wpm],
  )
  const onPage = useCallback((_start: number, end: number, lines: Set<number>) => {
    pageEnd.current = end
    lineStarts.current = lines
  }, [])
  const pageNav = useRef<PageNav | null>(null)

  // A timed session ("read for 10 minutes"), planned to end at a natural break.
  const [session, setSession] = useState<{ from: number; end: number; minutes: number; landing: Landing } | null>(null)
  const [sessionDone, setSessionDone] = useState<{ minutes: number; words: number; landing: Landing; where: string } | null>(
    null,
  )
  const chapterTitleAt = useCallback(
    (i: number) => {
      let title = ''
      for (const c of chapters) if (c.start <= i) title = c.title
      return chapters.length > 1 ? title : ''
    },
    [chapters],
  )
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  })
  const finishSession = useCallback(() => {
    const s = sessionRef.current
    if (!s) return
    setSession(null)
    setSessionDone({ minutes: s.minutes, words: s.end - s.from + 1, landing: s.landing, where: chapterTitleAt(s.end) })
  }, [chapterTitleAt])

  const { index, playing, toggle, play, pause, seek, plannedMs } = useRsvp(
    timeline.weights,
    wpm,
    initialIndex,
    pageDelay,
    session?.end,
    finishSession,
  )

  // Coming back after a while: a short "Previously…" of the last few
  // sentences, until reading carries on or it's dismissed.
  const [recapAgo] = useState(() =>
    shouldRecap(lastReadAt, initialIndex, Date.now()) ? timeAgo(lastReadAt!, Date.now()) : null,
  )
  const [recapDismissed, setRecapDismissed] = useState(false)
  const showRecap = recapAgo !== null && !recapDismissed && !playing && index === initialIndex

  // Glance back: hold anywhere on the stage to see the last couple of sentences (reading
  // pauses while you look), let go to carry on. Swipe to move by sentence.
  const [glancing, setGlancing] = useState(false)
  const resumeAfterGlance = useRef(false)
  // Hold to read: reading runs only while a finger (or the mouse) is down on
  // the text. A swipe still moves by sentence or page, measured from where
  // the press began.
  const pressFrom = useRef(0)
  // Buttons and cards on the stage keep their own taps, and so does selected
  // text: a tap on it brings up the system's menu (Look Up, Copy, Translate).
  const ignorePress = (target: Element) => !!target.closest('button, a, input, select, .recap') || onSelection(target)
  const onSelection = (target: Element) => {
    const word = target.closest('[data-i]')
    return !!word && hasSelection() && !!window.getSelection()?.containsNode(word, true)
  }
  // Words in the paused text and on the page can be selected, for the
  // system's Look Up. With Tap to play, a long press selects like anywhere
  // else; with Hold to read a long press reads, so a double-tap selects.
  const [selecting, setSelecting] = useState(false)
  const canSelect = !playing && (!holdToRead || selecting)
  const selectable = (target: Element) => canSelect && !!target.closest('.context [data-i], .page-text')
  const selectAt = useRef<number | null>(null)
  const selectWord = (i: number) => {
    if (!words[i]) return
    pause()
    seek(i)
    setSelecting(true)
    selectAt.current = i
  }
  // Select once the word is on screen and selectable (after the render above).
  useEffect(() => {
    const i = selectAt.current
    if (i === null) return
    const span = document.querySelector(`.context [data-i="${i}"], .page-text [data-i="${i}"]`)
    if (!span) return
    selectAt.current = null
    // Just the word, without its punctuation ("hedge", not "hedge."), so Look Up finds it.
    const range = document.createRange()
    const text = span.firstChild
    const word = text?.textContent?.match(/^[^\p{L}\p{N}]*(.*?)[^\p{L}\p{N}]*$/su)
    if (text && word?.[1]) {
      const start = word[0].indexOf(word[1])
      range.setStart(text, start)
      range.setEnd(text, start + word[1].length)
    } else range.selectNodeContents(span)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  })
  useEffect(() => {
    const update = () => setSelecting(hasSelection())
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])
  // A word in the paused text, if that's what a tap landed on.
  const wordAt = (target: Element | null) => {
    const el = target?.closest<HTMLElement>('.context [data-i]')
    return el ? Number(el.dataset.i) : null
  }
  // Double-tap to select: the word that was showing (or tapped) at the first
  // tap. The first tap acts straight away (play, pause or jump), so single
  // taps never wait; the second pauses there and selects the word.
  const tapIndex = useRef(0)
  const onTapWord = (target: Element | null, act: () => void) => {
    const tapped = wordAt(target)
    tapIndex.current = tapped ?? index
    if (tapped !== null) tapWord(tapped)
    else act()
  }
  // Always the first tap's word: that tap may have jumped to it, moving the
  // paused text, so the second tap can land on a different word.
  const onDoubleTap = () => selectWord(tapIndex.current)
  // A tap that only dismissed a selection didn't move anything, so a second
  // tap straight after selects the word under it.
  const onDismissTap = (target: Element | null) => {
    tapIndex.current = wordAt(target) ?? index
  }
  // While held, the controls get out of the way at once, and come straight
  // back on release (rather than fading after a couple of idle seconds).
  const [holding, setHolding] = useState(false)
  const startHold = () => {
    window.getSelection()?.removeAllRanges()
    setHolding(true)
    play()
  }
  const endHold = () => {
    setHolding(false)
    pause()
  }
  // With Hold to read, nothing starts reading on its own: not the play
  // button, Space, starting a session or continuing from a card. Those wait
  // for a hold instead, so reading only ever runs while something is held.
  const begin = () => {
    if (!holdToRead) play()
  }
  const holdHandlers = {
    ignore: ignorePress,
    onPressStart: () => {
      pressFrom.current = index
      startHold()
    },
    onPressEnd: endHold,
  }
  const holdTaps = {
    // A tap isn't a hold: undo the moment of reading it started, so tapping
    // (or double-tapping to select) never moves your place. A tap on a word
    // in the paused text jumps there instead.
    onTap: (target: Element | null) => {
      const tapped = wordAt(target)
      tapIndex.current = tapped ?? pressFrom.current
      seek(tapIndex.current)
    },
    onDoubleTap,
    onDismiss: onDismissTap,
  }
  const wordGestures = usePressGestures(
    holdToRead
      ? {
          ...holdHandlers,
          ...holdTaps,
          onSwipe: (direction) =>
            seek(
              direction === 'left'
                ? nextSentence(words, pressFrom.current)
                : previousSentence(words, pressFrom.current),
            ),
        }
      : {
          ignore: ignorePress,
          allowMenu: selectable,
          onTap: (target) => onTapWord(target, togglePlayback),
          onDoubleTap,
          onDismiss: onDismissTap,
          onHoldStart: (target) => {
            // A long press on a word in the paused text selects it instead.
            if (target && selectable(target)) {
              resumeAfterGlance.current = false
              return
            }
            resumeAfterGlance.current = playing
            setGlancing(true)
            pause()
          },
          onHoldEnd: () => {
            setGlancing(false)
            if (resumeAfterGlance.current) play()
          },
          onSwipe: (direction) =>
            seek(direction === 'left' ? nextSentence(words, index) : previousSentence(words, index)),
        },
  )
  // Page mode: swipe to turn pages, like an e-reader.
  const pageGestures = usePressGestures({
    ...(holdToRead && {
      ...holdHandlers,
      // Taps on words are the page's own (jump there, double-tap to select);
      // a tap anywhere else just undoes its moment of reading.
      onTap: (target: Element | null) => {
        if (!target?.closest('[data-i]')) seek(pressFrom.current)
      },
    }),
    allowMenu: selectable,
    onSwipe: (direction) => (direction === 'left' ? pageNav.current?.next() : pageNav.current?.previous()),
  })

  // Big jumps (progress bar, chapter menu, search) offer a way back for a few
  // seconds, so an accidental jump never costs your place.
  const [jumpedFrom, setJumpedFrom] = useState<number | null>(null)
  const jumpTo = (i: number) => {
    if (Math.abs(i - index) > JUMP_BACK_MIN_WORDS) setJumpedFrom(index)
    seek(i)
  }
  useEffect(() => {
    if (jumpedFrom === null) return
    const timer = window.setTimeout(() => setJumpedFrom(null), JUMP_BACK_MS)
    return () => window.clearTimeout(timer)
  }, [jumpedFrom])
  const [panel, setPanel] = useState<'search' | 'settings' | 'bookmarks' | 'session' | 'audio' | 'sync' | null>(null)
  // A closing panel stays mounted briefly so it can animate out.
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)
  const idle = useIdle(playing && !panel, IDLE_MS)
  const marked = isBookmarked(bookmarks, words, index)
  const toggleMark = () => onBookmarks(toggleBookmark(bookmarks, words, index))

  const closePanel = useCallback(() => {
    window.clearTimeout(closeTimer.current)
    if (reducedMotion()) {
      setPanel(null)
      return
    }
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      setPanel(null)
      setClosing(false)
    }, PANEL_CLOSE_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const openPanel = (which: 'search' | 'settings' | 'bookmarks' | 'session' | 'audio' | 'sync') => {
    pause()
    if (panel === which && !closing) {
      closePanel()
      return
    }
    window.clearTimeout(closeTimer.current)
    setClosing(false)
    setPanel(which)
  }

  const startSession = (plan: { end: number; landing: Landing; minutes: number }) => {
    setSession({ ...plan, from: index })
    setSessionDone(null)
    closePanel()
    begin()
  }

  // Start indexing in the background as soon as the book opens.
  const [bookSearch, setBookSearch] = useState<BookSearch | null>(null)
  useEffect(() => {
    const s = new BookSearch(book.id, words)
    setBookSearch(s)
    let live = true
    s.analysis.then((a) => live && setAnalysis(a))
    return () => {
      live = false
      s.dispose()
    }
  }, [book.id, words])

  // Listening along to an audiobook: the book follows the narrator, lined up
  // by a matched transcript, chapter starts and words tapped while listening
  // (src/lib/audio.ts). The recording plays at the reading speed.
  const audioHost = useRef<HTMLDivElement>(null)
  const player = useAudioPlayer(audio?.source ?? null, audioFile, audioHost)
  const { currentTime, play: playAudio, pause: pauseAudio, setSpeed, seeking: audioSeeking, unlock: unlockAudio, provide: provideAudio } = player
  const listening = player.playing
  const timestamps = audio?.timestamps ?? ''
  const transcript = useMemo(() => alignTranscript(parseTimestamps(timestamps), words), [timestamps, words])
  const points = useMemo(() => (audio ? syncPoints(audio, chapters, transcript, words.length) : []), [audio, chapters, transcript, words.length])
  /** The narrator's pace here: as set by hand from the last word synced on, or as measured from the points. */
  const narratorPace = (i: number) => {
    const anchor = audio?.pace ? Math.max(...audio.points.map((p) => p.seconds)) : Infinity
    return audio?.pace && timeAt(points, i) >= anchor ? audio.pace : paceAt(points, i)
  }
  const speed = audio && audio.matchSpeed !== false ? speedFor(wpm, narratorPace(index)) : 1
  useEffect(() => setSpeed(speed), [speed, setSpeed])
  /** Whether the guide follows the recording while it plays (the guide's own pause stops it, the recording plays on). */
  const [following, setFollowing] = useState(true)
  const followingNow = useRef(following)
  useEffect(() => {
    followingNow.current = following
  }, [following])
  /** The last word moved to by following the narrator; any other move is the reader's own jump. */
  const followed = useRef(-1)
  /** YouTube's player reports the old time for a moment after a seek; don't follow until then. */
  const settling = useRef(0)
  // Lining each file up from its sound (pauses.ts): before playing from a
  // spot, the file it's in; while listening, the next one before it's
  // reached. Done once per file and saved with the link.
  const narration = useMemo(() => buildTimeline(words, book.paragraphEnds, 'natural', headings).weights, [words, book.paragraphEnds, headings])
  const latestAudio = useRef(audio)
  useEffect(() => {
    latestAudio.current = audio
  })
  /** The points as they are now, including files lined up since the last render. */
  const pointsNow = useCallback(
    () => (latestAudio.current ? syncPoints(latestAudio.current, chapters, transcript, words.length) : []),
    [chapters, transcript, words.length],
  )
  /** The file (or part of a long file) playing `seconds` into the recording. */
  const fileAt = useCallback((seconds: number) => {
    const source = latestAudio.current?.source
    return source ? trackAt(partsOf(source), seconds) : 0
  }, [])
  // A long audiobook file of one's own is read for where its chapters and
  // each moment's sound are (media.ts), so it can be lined up a part at a
  // time without decoding hours of it at once.
  const indexes = useRef(new WeakMap<Blob, Promise<AudioIndex | null>>())
  const indexOf = useCallback((file: Blob) => {
    let index = indexes.current.get(file)
    if (!index) {
      index = indexAudio(file).catch(() => null)
      indexes.current.set(file, index)
    }
    return index
  }, [])
  /** Splits a linked file into the parts it's lined up in, once (saved with the link). */
  const ensureParts = useCallback(async () => {
    const link = latestAudio.current
    if (!link || link.source.kind !== 'file' || link.source.parts !== undefined || !audioFile) return
    const index = await indexOf(audioFile)
    const now = latestAudio.current
    if (!now || now.source.kind !== 'file' || now.source.name !== link.source.name || now.source.parts !== undefined) return
    const parts = index ? fileParts(index.duration, index.chapters, audioFile.size > MAX_BYTES) : []
    // Points found from the file as a whole were in different parts' places: start afresh.
    const next = { ...now, source: { ...now.source, parts }, detected: parts.length ? {} : now.detected }
    latestAudio.current = next
    onAudio(next)
  }, [audioFile, indexOf, onAudio])
  /** Letters said before each word: between sync points, time goes with letters, not words. */
  const letters = useMemo(() => spokenLetters(words), [words])
  const [lining, setLining] = useState(0)
  /** How much of the file being lined up for Listen has downloaded (0–1), or null. */
  const [progress, setProgress] = useState<number | null>(null)
  const linings = useRef(new Map<string, Promise<void>>())
  const lineUp = useCallback(
    (k: number, showProgress = false): Promise<void> => {
      const link = latestAudio.current
      if (!link || k < 0 || link.detected?.[k] !== undefined) return Promise.resolve()
      const { source } = link
      // A file not yet split into parts is split first (prepare does that).
      if (source.kind === 'file' && source.parts === undefined) return Promise.resolve()
      const parts = partsOf(source)
      const target = source.kind === 'archive' ? source.tracks[k]?.url : source.kind === 'url' ? source.url : source.kind === 'file' ? audioFile : null
      if (!target || (parts.length ? k >= parts.length : k > 0)) return Promise.resolve()
      const id = `${sourceId(source)}#${k}`
      const running = linings.current.get(id)
      if (running) return running
      setLining((n) => n + 1)
      /** What to decode, and where in the recording it starts: a part of a long file is just its own stretch. */
      const audioFor = async (): Promise<{ audio: string | Blob; offset: number; keep?: [number, number] }> => {
        if (source.kind === 'archive') return { audio: target, offset: trackStarts(parts)[k] }
        if (source.kind !== 'file' || !parts.length || typeof target === 'string') return { audio: target, offset: 0 }
        const index = await indexOf(target)
        if (!index) throw new Error('This audiobook file can’t be read in parts.')
        const window = partWindow(parts, k, pointsNow())
        const stretch = index.stretch(target, window.from, window.to)
        return { audio: new Blob(stretch.parts as BlobPart[], { type: stretch.type }), offset: stretch.start, keep: [window.start, window.end] }
      }
      let offset = 0
      /** The part's own stretch of the recording: points in the neighbours' bits decoded with it are theirs to place. */
      let keep: [number, number] = [-Infinity, Infinity]
      const done = audioFor()
        .then((chosen) => {
          offset = chosen.offset
          if (chosen.keep) keep = chosen.keep
          return detectSync(
            chosen.audio,
            { words, weights: narration, paragraphEnds: book.paragraphEnds },
            (duration) =>
              trackRange(parts.length ? parts : [{ url: '', title: '', seconds: duration }], k, chapters, pointsNow(), words.length, duration, chosen.keep ? offset : undefined),
            showProgress ? setProgress : undefined,
          )
        })
        .then(({ points: found, audio: file }) => {
          // Downloaded once: the player plays this copy instead of fetching it again.
          if (source.kind === 'archive') provideAudio(k, file)
          const now = latestAudio.current
          if (!now || sourceId(now.source) !== sourceId(source)) return
          const placed = found.map((p) => ({ index: p.index, seconds: p.seconds + offset })).filter((p) => p.seconds >= keep[0] && p.seconds < keep[1])
          const next = { ...now, detected: { ...now.detected, [k]: placed } }
          // Seen straight away by whatever is waiting on this, before the next render.
          latestAudio.current = next
          onAudio(next)
        })
        // Without lining up, chapter starts and taps still place the recording; say it's a guess.
        .catch(() => {
          if (showProgress) failedLining.current = true
          // Not lined up after all: let a later try download it again.
          linings.current.delete(id)
        })
        .finally(() => {
          setLining((n) => n - 1)
          if (showProgress) setProgress(null)
        })
      linings.current.set(id, done)
      return done
    },
    [audioFile, words, narration, book.paragraphEnds, chapters, onAudio, pointsNow, provideAudio, indexOf],
  )
  /**
   * Lines up the file that word `i` is in. The first guess at which file
   * that is can be wrong (a book whose chapters the recording doesn't name),
   * so if the word turns out to be outside the file, the file it's in now
   * looks to be is lined up too.
   */
  const prepare = useCallback(
    async (i: number, showProgress = false) => {
      await ensureParts()
      const seen = new Set<number>()
      for (let step = 0; step < 4; step++) {
        const k = fileAt(timeAt(pointsNow(), i, letters))
        if (seen.has(k)) return
        seen.add(k)
        // A long file's parts without a chapter marker can only be placed after
        // the part before them (their sound alone can't tell where in the book
        // they are): line up the ones between the last placed and this, in order.
        const link = latestAudio.current
        const parts = link?.source.kind === 'file' ? partsOf(link.source) : []
        let from = k
        while (from > 0 && !parts[from]?.title && link?.detected?.[from - 1] === undefined) from--
        for (let m = from; m < k; m++) {
          if (showProgress) setProgress((m - from) / (k - from + 1))
          await lineUp(m)
          if (!latestAudio.current?.detected?.[m]?.length) break
        }
        await lineUp(k, showProgress)
        const found = latestAudio.current?.detected?.[k]
        if (!found || found.length < 2 || (i >= found[0].index && i <= found[found.length - 1].index)) return
      }
    },
    [fileAt, lineUp, pointsNow, letters, ensureParts],
  )
  /**
   * Listen waits for lining up rather than start from a guess (it shows how
   * far the download has got); only a connection this slow gives up and
   * starts from the best guess.
   */
  const PREPARE_MS = 90000
  const [preparing, setPreparing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** Lining up for Listen failed (no connection, say): the recording starts from a guess. */
  const failedLining = useRef(false)
  /** Further than this from anything lined up in the file, the passage probably isn't in the recording. */
  const NOT_COVERED_WORDS = 300
  /** Bumped by each new start, so an older one still lining up doesn't play once a newer one has begun. */
  const startToken = useRef(0)
  /** Play the recording from word `i`: lined up first, so it starts where the text is. */
  const playFrom = async (i: number) => {
    const token = ++startToken.current
    setFollowing(true)
    followingNow.current = true
    failedLining.current = false
    followed.current = i
    pauseAudio()
    // Phones only allow sound in response to a tap: allow it now, while lining up waits.
    unlockAudio()
    setPreparing(true)
    await Promise.race([prepare(i, true), new Promise((resolve) => window.setTimeout(resolve, PREPARE_MS))])
    if (token !== startToken.current) return
    setPreparing(false)
    const now = pointsNow()
    // A recording of part of the book (or another edition) may not have this passage at all.
    const k = fileAt(timeAt(now, i, letters))
    const found = latestAudio.current?.detected?.[k]
    setNotice(
      failedLining.current
        ? 'Couldn’t line up this chapter (check the connection), so it starts from a guess. Tap the word you hear to sync.'
        : found && found.length > 2 && (i < found[0].index - NOT_COVERED_WORDS || i > found[found.length - 1].index + NOT_COVERED_WORDS)
          ? 'This recording doesn’t seem to include this part of the book, so it plays the nearest part it has.'
          : null,
    )
    failedLining.current = false
    followed.current = i
    settling.current = performance.now() + 800
    playAudio(timeAt(now, i, letters))
  }
  // The audio button pauses only the recording: if the guide was following
  // it, the guide carries on at the reading speed by itself.
  const listen = () => {
    if (listening || preparing) {
      startToken.current++
      setPreparing(false)
      pauseAudio()
      // Once it has stopped (the player says so a moment later).
      if (listening && following) guideTakesOver.current = true
      return
    }
    pause()
    void playFrom(index)
  }
  // Tapping a word moves there, as when reading; while the guide follows the
  // recording, the recording comes along. Syncing a word to the recording is
  // done in the Sync sheet, where that's all a tap does.
  const tapWord = (i: number) => seek(i)
  // Syncing by hand (SyncPanel): the recording is held at a moment, or plays
  // while the book stays still, until the word being said there is tapped.
  const syncing = useRef(false)
  useEffect(() => {
    syncing.current = panel === 'sync'
  }, [panel])
  /** Where the recording is held while paused for syncing, in seconds. */
  const [held, setHeld] = useState(0)
  const openSync = () => {
    if (!audio) return
    startToken.current++
    setPreparing(false)
    // From where it's playing, or else where the book says the word being read is.
    setHeld(listening ? currentTime() : timeAt(points, index, letters))
    pauseAudio()
    openPanel('sync')
  }
  const syncTime = () => (listening ? currentTime() : held)
  /** The whole recording's length: its parts' when known, or the player's. */
  const recordingLength = () => {
    const parts = audio ? partsOf(audio.source) : []
    return parts.length ? parts.reduce((sum, p) => sum + p.seconds, 0) : player.duration()
  }
  // Text pace: when the text runs ahead of the voice or falls behind, the
  // narrator's pace is set a little slower or faster, from the word shown now.
  const PACE_STEP = 1.06
  const nudgePace = (faster: boolean) => {
    if (!audio) return
    const t = currentTime()
    const pace = narratorPace(index) * (faster ? PACE_STEP : 1 / PACE_STEP)
    onAudio(setPace(audio, pace, index, t))
    followed.current = index
  }
  const syncSeek = (seconds: number) => {
    const t = Math.max(0, seconds)
    if (listening) {
      settling.current = performance.now() + 800
      playAudio(t)
    } else setHeld(t)
  }
  const syncPlay = () => {
    if (listening) {
      setHeld(currentTime())
      pauseAudio()
    } else {
      settling.current = performance.now() + 800
      playAudio(held)
    }
  }
  /** Word `i` is what's said now: pinned there, and listening carries on from it. */
  const syncPick = (i: number) => {
    if (!audio) return
    const t = syncTime()
    onAudio({ ...audio, points: addPoint(audio.points, i, t) })
    followed.current = i
    seek(i)
    setNotice(null)
    closePanel()
    if (!listening) {
      settling.current = performance.now() + 800
      playAudio(t)
    }
  }
  /** The whole second being heard, for the time shown while listening. */
  const [heard, setHeard] = useState(0)
  useEffect(() => {
    if (!listening) return
    const follow = () => {
      const t = currentTime()
      setHeard(Math.floor(t))
      // Still moving to where it was asked to start: nothing new to follow yet.
      if (performance.now() < settling.current || audioSeeking()) return
      const k = fileAt(t)
      void lineUp(k)
      // Halfway through a chapter's file, line up the next one too.
      const parts = latestAudio.current ? partsOf(latestAudio.current.source) : []
      if (parts.length) {
        const start = trackStarts(parts)[k]
        if (t - start > (parts[k]?.seconds ?? Infinity) / 2) void lineUp(k + 1)
      }
      // Lining up by hand, or the guide paused: the text stays put.
      if (syncing.current || !followingNow.current) return
      // A touch ahead: the word shown should be the one being said, not the one just said.
      const i = wordHeardAt(points, t + FOLLOW_LEAD_SECONDS, words.length, letters)
      if (i === current.current) return
      followed.current = i
      seek(i)
    }
    const timer = window.setInterval(follow, 100)
    return () => window.clearInterval(timer)
  }, [listening, points, currentTime, words.length, seek, fileAt, lineUp, audioSeeking, letters])
  // With a recording linked, line up the part for where the reader is, so
  // pressing Listen can start straight away.
  const sourceKey = audio ? sourceId(audio.source) : ''
  useEffect(() => {
    if (sourceKey) void prepare(current.current)
  }, [sourceKey, prepare])
  useEffect(() => {
    if (panel === 'audio' && sourceKey) void prepare(current.current)
  }, [panel, sourceKey, prepare])
  // A jump while listening (the progress bar, a chapter, a page turn) takes the recording there too.
  useEffect(() => {
    if (!listening || !following || index === followed.current) return
    void playFrom(index)
    // Only the reader's position moving should re-seek, not new points arriving.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [index])
  // While listening, the guide's play and pause are whether it follows the
  // recording; the recording itself plays on (the audio button pauses that).
  const togglePlayback = () => {
    if (!listening) {
      toggle()
      return
    }
    if (following) {
      setFollowing(false)
      return
    }
    // Back to following: from the word being said now, not from where the text stopped.
    followed.current = -1
    setFollowing(true)
  }
  const guideMoving = playing || (listening && following)
  /** The recording was paused while the guide followed it: the guide goes on by itself once it stops. */
  const guideTakesOver = useRef(false)
  useEffect(() => {
    if (listening || !guideTakesOver.current) return
    guideTakesOver.current = false
    play()
  }, [listening, play])
  // The guide never runs on its own clock while it could follow the recording.
  useEffect(() => {
    if (playing && listening) {
      pause()
      setFollowing(true)
    }
  }, [playing, listening, pause])

  // Persist progress: whenever paused, and periodically while playing.
  const lastSaved = useRef(index)
  useEffect(() => {
    if (!(playing || listening) || Math.abs(index - lastSaved.current) >= 50) {
      lastSaved.current = index
      onProgress(index)
    }
  }, [index, playing, listening, onProgress])
  const current = useRef(index)
  useEffect(() => {
    current.current = index
  }, [index])

  useReadingTime(playing, index, wpm, onReadingTime)
  useEffect(() => {
    if (playing) onPlay?.()
  }, [playing, onPlay])
  useEffect(() => () => onProgress(current.current), [onProgress])

  const setWpm = (next: number) => onSettings({ ...settings, wpm: Math.max(MIN_WPM, Math.min(MAX_WPM, next)) })

  // Keep the key handler reading the latest state without re-binding every word.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  const onKey = (e: KeyboardEvent) => {
    if (panel) return
    if ((e.key === 'f' && (e.ctrlKey || e.metaKey)) || e.key === '/') {
      e.preventDefault()
      openPanel('search')
      return
    }
    const t = e.target
    if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && e.key.startsWith('Arrow'))) return
    switch (e.key) {
      case ' ':
      case 'k':
        // Hold to read: hold the key to read, let go to stop (see keyup below).
        if (!holdToRead) togglePlayback()
        else if (!e.repeat) startHold()
        break
      case 'ArrowLeft':
        seek(e.shiftKey || e.ctrlKey || e.metaKey ? previousSentence(words, index) : index - 1)
        break
      case 'ArrowRight':
        seek(e.shiftKey || e.ctrlKey || e.metaKey ? nextSentence(words, index) : index + 1)
        break
      case 'ArrowUp':
        setWpm(wpm + WPM_STEP)
        break
      case 'ArrowDown':
        setWpm(wpm - WPM_STEP)
        break
      case 'Escape':
        pause()
        onClose()
        break
      case 'b':
      case 'B':
        toggleMark()
        break
      case 'm':
      case 'M':
        onSettings({ ...settings, mode: mode === 'page' ? 'word' : 'page' })
        break
      case 'PageDown':
        pageNav.current?.next()
        break
      case 'PageUp':
        pageNav.current?.previous()
        break
      default:
        return
    }
    e.preventDefault()
  }
  useEffect(() => {
    keys.current = onKey
  })
  const onKeyUp = (e: KeyboardEvent) => {
    if (holdToRead && (e.key === ' ' || e.key === 'k')) endHold()
  }
  const keysUp = useRef(onKeyUp)
  useEffect(() => {
    keysUp.current = onKeyUp
  })
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e)
    const upHandler = (e: KeyboardEvent) => keysUp.current(e)
    window.addEventListener('keydown', handler)
    window.addEventListener('keyup', upHandler)
    return () => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener('keyup', upHandler)
    }
  }, [])

  const chapterIndex = useMemo(() => {
    let c = 0
    for (let i = 0; i < chapters.length; i++) if (chapters[i].start <= index) c = i
    return c
  }, [chapters, index])
  const chapterEnd = chapters[chapterIndex + 1]?.start ?? words.length

  const percent = words.length > 1 ? Math.round((index / (words.length - 1)) * 100) : 100
  const bookLeft = formatMinutes(minutesBetween(timeline, index, words.length, wpm))
  const chapterLeft = formatMinutes(minutesBetween(timeline, index, chapterEnd, wpm))
  const hasChapters = chapters.length > 1
  const describePosition = (i: number) => {
    const pct = `${words.length > 1 ? Math.round((i / (words.length - 1)) * 100) : 100}%`
    if (!hasChapters) return pct
    let title = chapters[0].title
    for (const c of chapters) if (c.start <= i) title = c.title
    return `${pct} · ${title}`
  }

  const context = useMemo(() => {
    if (playing || mode === 'page') return null
    const { start, end } = pausedRange(words, index, CONTEXT_WORDS)
    return words.slice(start, end + 1).map((w, i) => ({ w, i: start + i }))
  }, [playing, index, words, mode])

  const doneCard = sessionDone && !playing && (
    <aside className="recap" aria-label="Session done" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <p className="recap-head">Session done · {sessionDone.minutes} min</p>
      <p className="recap-text session-summary">
        You read {sessionDone.words.toLocaleString()} words
        {sessionDone.landing === 'chapter' && sessionDone.where ? ` and finished ${sessionDone.where}` : ''}
        {sessionDone.landing === 'book' ? ' and finished the book' : ''}.
      </p>
      {holdToRead ? (
        <div className="recap-actions">
          <span className="recap-hint">Hold anywhere to keep reading.</span>
          <button type="button" className="text-button" onClick={() => setSessionDone(null)}>
            Done
          </button>
        </div>
      ) : (
        <div className="recap-actions">
          <button
            type="button"
            className="demo-button"
            onClick={() => {
              setSessionDone(null)
              play()
            }}
          >
            <Icon name="play" size={16} />
            Keep going
          </button>
          <button type="button" className="text-button" onClick={() => setSessionDone(null)}>
            Done
          </button>
        </div>
      )}
    </aside>
  )

  const recapCard = recapAgo && (
    <Recap
      words={words}
      index={initialIndex}
      where={hasChapters ? chapters[chapterIndex].title : null}
      ago={recapAgo}
      holdToRead={holdToRead}
      onContinue={() => {
        setRecapDismissed(true)
        play()
      }}
      onDismiss={() => setRecapDismissed(true)}
    />
  )

  return (
    <main className={`reader${playing ? ' is-playing' : ''}${idle ? ' is-idle' : ''}${holding && playing ? ' is-holding' : ''}${canSelect ? ' can-select' : ''}`}>
      <header className="reader-top chrome">
        <button type="button" className="nav-button" onClick={onClose}>
          <Icon name="chevronLeft" size={22} />
          <span className="nav-label">Library</span>
        </button>

        <div className="running-head">
          <span className="running-title" title={book.title}>
            {book.title}
          </span>
          {hasChapters && (
            // The chapter name with its arrow right beside it; the real (invisible)
            // select sits on top, so tapping opens the system chapter picker.
            <span className="chapter-picker">
              <span className="chapter-name">{chapters[chapterIndex].title}</span>
              <Icon name="chevronDown" size={14} />
              <select
                className="chapter-select"
                value={chapterIndex}
                onChange={(e) => jumpTo(chapters[Number(e.target.value)].start)}
                aria-label="Jump to chapter"
              >
                {chapters.map((c, i) => (
                  <option key={i} value={i}>
                    {c.title}
                  </option>
                ))}
              </select>
            </span>
          )}
        </div>

        <div className="top-actions">
          <button
            type="button"
            className={`icon-button${audio ? ' is-marked' : ''}`}
            onClick={() => openPanel('audio')}
            title="Listen to an audiobook"
            aria-label={audio ? 'Listen (an audiobook is linked)' : 'Listen'}
          >
            <Icon name="headphones" size={21} />
          </button>
          <button type="button" className="icon-button" onClick={() => openPanel('search')} title="Search (/)" aria-label="Search">
            <Icon name="search" size={21} />
          </button>
          <button
            type="button"
            className={`icon-button${marked ? ' is-marked' : ''}`}
            onClick={() => openPanel('bookmarks')}
            title="Bookmarks (B adds one here)"
            aria-label={marked ? 'Bookmarks (this spot is bookmarked)' : 'Bookmarks'}
          >
            <Icon name={marked ? 'bookmarkFilled' : 'bookmark'} size={21} />
          </button>
          <button
            type="button"
            className="icon-button aa"
            onClick={() => openPanel('settings')}
            aria-label="Reading settings"
            aria-expanded={panel === 'settings'}
          >
            Aa
          </button>
          {panel === 'settings' && (
            <SettingsMenu settings={settings} onSettings={onSettings} closing={closing} onClose={closePanel} />
          )}
        </div>
      </header>

      {mode === 'page' ? (
        <section
          {...pageGestures.handlers}
          onClickCapture={(e) => {
            // The click a swipe ends with shouldn't also jump to the word under the finger.
            if (pageGestures.wasSwipe()) {
              e.stopPropagation()
              e.preventDefault()
            }
          }}
          className={`stage stage-page${settings.pageGuide === 'pacer' || settings.pageGuide === 'none' ? ' no-highlight' : ''}${settings.pageGuide === 'highlight' || settings.pageGuide === 'none' ? ' no-pacer' : ''}`}
        >
          <PageView
            words={words}
            paragraphEnds={book.paragraphEnds}
            chapterStarts={chapterStarts}
            headings={headings}
            index={index}
            playing={playing}
            scale={textScale}
            font={font}
            pace={60000 / wpm}
            durationOf={(i) => plannedMs(i, index)}
            focusLines={settings.lineFocus === 'one' ? 1 : settings.lineFocus === 'three' ? 3 : 0}
            onSeek={seek}
            onTapWord={tapWord}
            onSelectWord={selectWord}
            onToggle={holdToRead ? noop : togglePlayback}
            onPage={onPage}
            navRef={pageNav}
          />
          {showRecap && recapCard}
          {doneCard}
        </section>
      ) : (
        <section
          className="stage"
          {...wordGestures.handlers}
          onClickCapture={(e) => {
            // A hold or swipe ends with a click; it shouldn't also jump to a word.
            if (wordGestures.wasSwipe()) {
              e.stopPropagation()
              e.preventDefault()
            }
          }}
        >
          <WordDisplay word={words[index] ?? ''} scale={textScale} heading={headingWords.has(index)} font={font} />
          {glancing && <Glance words={words} index={index} headings={headingWords} />}
          {showRecap && recapCard}
          {doneCard}
          <div className="context" aria-hidden={playing}>
            {/* A recap or session card takes this space; the text would show round its edges. */}
            {context && !showRecap && !(sessionDone && !playing) && (
              <p>
                {context.map(({ w, i }, k) => (
                  <Fragment key={i}>
                    {k > 0 && headingWords.has(i) && !headingWords.has(i - 1) && <br />}
                    <span
                      data-i={i}
                      className={[i === index && 'current', headingWords.has(i) && 'is-heading'].filter(Boolean).join(' ') || undefined}
                    >
                      {w}{' '}
                    </span>
                    {headingWords.has(i) && !headingWords.has(i + 1) && <br />}
                  </Fragment>
                ))}
              </p>
            )}
          </div>
        </section>
      )}

      <footer className="reader-bottom chrome">
        {jumpedFrom !== null && (
          <button
            type="button"
            className="jump-back"
            onClick={() => {
              seek(jumpedFrom)
              setJumpedFrom(null)
            }}
          >
            <Icon name="chevronLeft" size={16} />
            <span>Back to {describePosition(jumpedFrom)}</span>
          </button>
        )}
        {audio && (
          <div className="listen-bar">
            <button
              type="button"
              className="text-button"
              onClick={listen}
              aria-label={listening ? 'Pause audiobook' : preparing ? 'Stop lining up' : 'Listen from here'}
            >
              <Icon name={listening ? 'pause' : 'headphones'} size={16} />
              {listening ? 'Listening' : preparing ? `Lining up…${progress !== null && progress < 1 ? ` ${Math.round(progress * 100)}%` : ''}` : 'Listen'}
            </button>
            <span className="muted listen-time">
              {formatTime(listening ? heard : timeAt(points, index, letters))}
              {speed !== 1 && ` · ${speed}×`}
              {lining > 0 && !preparing && ' · lining up'}
            </span>
            <button type="button" className="text-button listen-sync" onClick={openSync} aria-label="Sync text and audio">
              Sync
            </button>
            {listening && (
              <span className="listen-pace" role="group" aria-label="Text pace">
                <span className="muted">Text</span>
                <button type="button" className="icon-button" onClick={() => nudgePace(false)} aria-label="Text slower" title="The text is ahead of the voice">
                  <Icon name="minus" size={16} />
                </button>
                <button type="button" className="icon-button" onClick={() => nudgePace(true)} aria-label="Text faster" title="The text is behind the voice">
                  <Icon name="plus" size={16} />
                </button>
              </span>
            )}
            {listening && (notice || !following) && (
              <span className="muted listen-hint">{notice ?? 'Text paused while the recording plays. Press play to follow it again.'}</span>
            )}
          </div>
        )}
        <Scrubber value={index} max={Math.max(words.length - 1, 0)} onSeek={jumpTo} describe={describePosition} />

        <div className="deck">
          <div className="deck-meta-wrap">
            {session ? (
              <div className="deck-meta session-active">
                <span className="session-left">
                  <Icon name="clock" size={13} />
                  {formatMinutes(minutesBetween(timeline, index, session.end + 1, wpm))} left in session
                  <button type="button" className="text-button session-end" onClick={() => setSession(null)}>
                    End
                  </button>
                </span>
                <span className="muted">{describeLanding(session.landing, chapterTitleAt(session.end))}</span>
              </div>
            ) : (
              <button
                type="button"
                className="deck-meta muted session-open"
                onClick={() => openPanel('session')}
                title="Read for a set time"
                aria-label={`${hasChapters ? `${chapterLeft} left in chapter, ` : ''}${bookLeft} left${hasChapters ? ' in book' : ''}, ${percent}%. Read for a set time`}
              >
                {hasChapters && <span>{chapterLeft} left in chapter</span>}
                <span>
                  {bookLeft} left{hasChapters && ' in book'} · {percent}%
                  <Icon name="clock" size={13} />
                </span>
              </button>
            )}
            {panel === 'session' && (
              <SessionMenu
                landsFor={(minutes) => {
                  const plan = planSession(timeline, words, book.paragraphEnds, chapterStarts, index, minutes, wpm)
                  return describeLanding(plan.landing, chapterTitleAt(plan.end))
                }}
                chapters={chapterTargets(chapters, index, words.length).map((c) => ({
                  ...c,
                  time: formatMinutes(minutesBetween(timeline, index, c.end + 1, wpm)),
                }))}
                closing={closing}
                onStartTime={(minutes) => {
                  const plan = planSession(timeline, words, book.paragraphEnds, chapterStarts, index, minutes, wpm)
                  startSession({ ...plan, minutes })
                }}
                onStartChapter={(c) => {
                  const minutes = Math.max(1, Math.round(minutesBetween(timeline, index, c.end + 1, wpm)))
                  startSession({ end: c.end, landing: 'chapter', minutes })
                }}
                onClose={closePanel}
              />
            )}
          </div>

          <div className="transport">
            <button type="button" className="icon-button" title="Previous sentence (Shift+←)" aria-label="Previous sentence" onClick={() => seek(previousSentence(words, index))}>
              <Icon name="sentenceBack" />
            </button>
            <button type="button" className="icon-button" title="Back one word (←)" aria-label="Back one word" onClick={() => seek(index - 1)}>
              <Icon name="back" />
            </button>
            {holdToRead ? (
              // Hold to read: no play button until you hold. A wide pad to rest
              // a thumb on, labelled in words (an icon alone is ambiguous), that
              // fills the moment it's pressed; then the controls fade away.
              <button
                type="button"
                className={`hold-pad${holding && playing ? ' is-pressed' : ''}`}
                title="Or hold Space"
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.currentTarget.setPointerCapture(e.pointerId)
                  startHold()
                }}
                onPointerUp={endHold}
                onPointerCancel={endHold}
                onContextMenu={(e) => e.preventDefault()}
              >
                Hold to read
              </button>
            ) : (
              <button
                type="button"
                className="play-button"
                onClick={togglePlayback}
                aria-label={guideMoving ? 'Pause' : 'Play'}
                title="Play / pause (Space)"
              >
                <Icon name={guideMoving ? 'pause' : 'play'} size={22} />
              </button>
            )}
            <button type="button" className="icon-button" title="Forward one word (→)" aria-label="Forward one word" onClick={() => seek(index + 1)}>
              <Icon name="forward" />
            </button>
            <button type="button" className="icon-button" title="Next sentence (Shift+→)" aria-label="Next sentence" onClick={() => seek(nextSentence(words, index))}>
              <Icon name="sentenceForward" />
            </button>
          </div>

          <div className="speed" role="group" aria-label="Reading speed">
            <button type="button" className="icon-button" onClick={() => setWpm(wpm - WPM_STEP)} aria-label="Slower" title="Slower (↓)">
              −
            </button>
            <span className="speed-value">
              {wpm}
              <span className="muted"> wpm</span>
            </span>
            <button type="button" className="icon-button" onClick={() => setWpm(wpm + WPM_STEP)} aria-label="Faster" title="Faster (↑)">
              +
            </button>
          </div>
        </div>
      </footer>


      {panel === 'bookmarks' && (
        <BookmarksPanel
          bookmarks={bookmarks}
          words={words}
          chapters={chapters}
          here={marked}
          onToggleHere={toggleMark}
          closing={closing}
          onSelect={(i) => {
            jumpTo(i)
            closePanel()
          }}
          onRemove={(i) => onBookmarks(bookmarks.filter((b) => b.index !== i))}
          onClose={closePanel}
        />
      )}

      {audio?.source.kind === 'youtube' && <div ref={audioHost} className="audio-video" />}

      {panel === 'audio' && (
        <AudioPanel
          title={book.title}
          author={book.author ?? authorFromTitle(book.title)}
          wordCount={words.length}
          chapters={chapters}
          link={audio}
          startsAt={timeAt(points, index, letters)}
          transcriptMatches={transcript.length}
          speed={speedFor(wpm, narratorPace(index))}
          listening={listening}
          preparing={preparing}
          lining={lining > 0}
          error={player.error}
          closing={closing}
          onLink={onAudio}
          onListen={listen}
          onSync={openSync}
          onClose={closePanel}
        />
      )}

      {panel === 'sync' && audio && (
        <SyncPanel
          words={words}
          paragraphEnds={book.paragraphEnds}
          bookSearch={bookSearch}
          time={listening ? heard : held}
          duration={recordingLength()}
          wordAt={(t) => wordHeardAt(points, t, words.length, letters)}
          timeAt={(i) => timeAt(points, i, letters)}
          chapterAt={(i) => (chapters.length > 1 ? chapterTitleAt(i) : '')}
          playing={listening}
          closing={closing}
          onSeek={syncSeek}
          onTogglePlay={syncPlay}
          onPick={syncPick}
          onClose={closePanel}
        />
      )}

      {panel === 'search' && bookSearch && (
        <SearchPanel
          bookSearch={bookSearch}
          words={words}
          chapters={chapters}
          names={analysis?.names}
          position={index}
          closing={closing}
          onSelect={(i) => {
            jumpTo(i)
            closePanel()
          }}
          onClose={closePanel}
        />
      )}
    </main>
  )
}

/** Where a timed session will stop, in words. */
function describeLanding(landing: Landing, chapter: string): string {
  if (landing === 'book') return 'to the end of the book'
  if (landing === 'chapter') return chapter ? `to the end of ${chapter}` : 'to the end of a chapter'
  return chapter ? `ends in ${chapter}` : landing === 'paragraph' ? 'ends at a paragraph break' : 'ends at a full stop'
}

/** "Previously…": the last few sentences before where you left off. */
function Recap({
  words,
  index,
  where,
  ago,
  holdToRead,
  onContinue,
  onDismiss,
}: {
  words: string[]
  index: number
  where: string | null
  ago: string
  holdToRead: boolean
  onContinue: () => void
  onDismiss: () => void
}) {
  const { start, end } = recapRange(words, index)
  if (end < start) return null
  return (
    <aside className="recap" aria-label="Previously" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <p className="recap-head">
        Previously{where && <> · {where}</>} <span className="muted">· {ago}</span>
      </p>
      <p className="recap-text">
        {start > 0 && '… '}
        {words.slice(start, end + 1).join(' ')}
      </p>
      <div className="recap-actions">
        {holdToRead ? (
          <span className="recap-hint">Hold anywhere to carry on.</span>
        ) : (
          <button type="button" className="demo-button" onClick={onContinue}>
            <Icon name="play" size={16} />
            Continue reading
          </button>
        )}
        <button type="button" className="text-button" onClick={onDismiss}>
          {holdToRead ? 'OK' : 'Dismiss'}
        </button>
      </div>
    </aside>
  )
}

/** The previous and current sentence, shown while the word is held. */
function Glance({ words, index, headings }: { words: string[]; index: number; headings: Set<number> }) {
  const { start, end } = glanceRange(words, index)
  return (
    <div className="glance" role="status">
      <p>
        {words.slice(start, end + 1).map((w, k) => {
          const i = start + k
          const classes = [i === index ? 'current' : i > index && 'ahead', headings.has(i) && 'is-heading']
          return (
            <Fragment key={i}>
              {k > 0 && headings.has(i) && !headings.has(i - 1) && <br />}
              <span className={classes.filter(Boolean).join(' ') || undefined}>{w} </span>
              {headings.has(i) && !headings.has(i + 1) && <br />}
            </Fragment>
          )
        })}
      </p>
      <span className="glance-hint">Let go to keep reading</span>
    </div>
  )
}

const noop = () => {}

/** Follow the narrator this far ahead (seconds of recording): the book was measured to trail by about this much. */
const FOLLOW_LEAD_SECONDS = 0.3

/** Report reading while playing: every 30s, on pause, and when the reader closes. */
const STATS_FLUSH_MS = 30_000

/**
 * Counts time spent playing and the words the clock moved through (not
 * jumps), and reports them periodically. Time is capped at twice what the
 * words should have taken, so a phone asleep or a background tab mid-play
 * doesn't count as hours of reading.
 */
function useReadingTime(playing: boolean, index: number, wpm: number, report: (ms: number, words: number) => void) {
  const session = useRef<{ at: number; words: number } | null>(null)
  const previous = useRef(index)
  const pace = useRef(wpm)
  useEffect(() => {
    pace.current = wpm
  }, [wpm])
  useEffect(() => {
    if (playing && session.current && index === previous.current + 1) session.current.words++
    previous.current = index
  }, [index, playing])
  useEffect(() => {
    if (!playing) return
    session.current = { at: performance.now(), words: 0 }
    const flush = () => {
      const s = session.current
      if (!s) return
      const now = performance.now()
      const ms = Math.min(now - s.at, ((s.words * 60000) / pace.current) * 2)
      if (s.words > 0) report(ms, s.words)
      session.current = { at: now, words: 0 }
    }
    const timer = window.setInterval(flush, STATS_FLUSH_MS)
    return () => {
      window.clearInterval(timer)
      flush()
      session.current = null
    }
  }, [playing, report])
}

/**
 * True after `ms` without pointer/keyboard activity, while `active`.
 *
 * A press on the reading area isn't activity: it plays, pauses or (with Hold
 * to read) keeps reading, and a held finger always drifts a little, and is
 * re-targeted when the page under it turns. Counting those would bring the
 * controls back mid-read. Mouse movement without a press still wakes them.
 */
function useIdle(active: boolean, ms: number): boolean {
  const [idle, setIdle] = useState(false)
  // Pointers that went down on the reading area and are still down. Tracked
  // all the time, since with Hold to read the press starts before playing does.
  const onStage = useRef(new Set<number>())
  useEffect(() => {
    const presses = onStage.current
    const down = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.stage')) presses.add(e.pointerId)
    }
    const up = (e: PointerEvent) => presses.delete(e.pointerId)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [])
  useEffect(() => {
    if (!active) return
    let timer = window.setTimeout(() => setIdle(true), ms)
    const wake = (e: Event) => {
      if (e instanceof PointerEvent && onStage.current.has(e.pointerId)) return
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), ms)
    }
    const events = ['pointermove', 'pointerdown', 'keydown'] as const
    events.forEach((e) => window.addEventListener(e, wake))
    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, wake))
      setIdle(false)
    }
  }, [active, ms])
  return idle
}

/** What identifies a recording, to tell whether it's still the one linked. */
function sourceId(source: AudioSource): string {
  if (source.kind === 'youtube') return `yt:${source.videoId}`
  if (source.kind === 'archive') return `ia:${source.identifier}`
  if (source.kind === 'url') return `url:${source.url}`
  return `file:${source.name}`
}
