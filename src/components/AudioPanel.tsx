import { useEffect, useRef, useState } from 'react'
import {
  formatTime,
  matchChapters,
  parseTimestamps,
  sourceFromLink,
  trackStarts,
  youTubeSearch,
  type AudioLink,
  type AudioSource,
} from '../lib/audio'
import { loadRecording, searchRecordings, type Recording } from '../lib/archive'
import type { Chapter } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  title: string
  author?: string
  chapters: Chapter[]
  link: AudioLink | null
  /** Where the recording would start for the word being read, in seconds. */
  startsAt: number
  /** How many spots a pasted transcript was matched to the book at. */
  transcriptMatches: number
  /** The playback speed that matches the reading speed. */
  speed: number
  listening: boolean
  /** A file of the recording is being lined up with the book from its sound. */
  lining: boolean
  error: string | null
  /** Animating out; the reader unmounts it shortly after. */
  closing?: boolean
  onLink: (link: AudioLink | null, file?: File) => void
  onListen: () => void
  onClose: () => void
}

type Search = { state: 'searching' } | { state: 'done'; results: Recording[] } | { state: 'failed'; message: string }

/**
 * Find an audiobook of the book (the Internet Archive is searched straight
 * away), or add a video or file, and line it up with a transcript or
 * chapter times.
 */
export function AudioPanel(props: Props) {
  const { title, author, chapters, link, startsAt, transcriptMatches, speed, listening, lining, error, closing, onLink, onListen, onClose } = props
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', esc, { capture: true })
    return () => window.removeEventListener('keydown', esc, { capture: true })
  }, [onClose])
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])

  const [timestamps, setTimestamps] = useState(link?.timestamps ?? '')
  // Saved a moment after typing stops (or pasting), once there's a recording to go with.
  useEffect(() => {
    if (!link || timestamps === link.timestamps) return
    const timer = window.setTimeout(() => onLink({ ...link, timestamps }), 400)
    return () => window.clearTimeout(timer)
  }, [timestamps, link, onLink])

  const use = (source: AudioSource, file?: File) => onLink({ source, timestamps, points: [], matchSpeed: true }, file)

  return (
    <div className={`search-backdrop is-sheet${closing ? ' is-closing' : ''}`} onClick={onClose}>
      <aside className="search-panel audio-panel" role="dialog" aria-label="Listen" onClick={(e) => e.stopPropagation()}>
        <div className="panel-bar">
          <h2 className="panel-title">Listen</h2>
          <button type="button" className="icon-button" ref={close} onClick={onClose} aria-label="Close listen">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="search-body">
          {link ? (
            <Linked
              link={link}
              chapters={chapters}
              startsAt={startsAt}
              speed={speed}
              listening={listening}
              lining={lining}
              error={error}
              onLink={onLink}
              onListen={onListen}
            />
          ) : (
            <Find title={title} author={author} onUse={use} />
          )}

          {/* A recording lines itself up from its sound; a video can't, so it's for videos (or what was pasted before). */}
          {(!link || link.source.kind === 'youtube' || timestamps.trim() !== '') && (
            <>
              <h3 className="search-section">
                Transcript or chapter times <span className="muted">(optional)</span>
              </h3>
              <p className="search-hint">
                Paste a video’s transcript and the book follows the narrator word for word. YouTube’s app doesn’t let you
                copy it, so open the video on a computer, click <em>Show transcript</em> under the description, and copy it
                all. A chapter list (<em>0:00 Chapter 1</em>) works too. Without either, tap the word you hear while listening.
              </p>
              <textarea
                className="audio-times"
                rows={4}
                placeholder={'0:00\nChapter one. Down the rabbit hole.\n0:06\nAlice was beginning to get very tired…'}
                value={timestamps}
                onChange={(e) => setTimestamps(e.target.value)}
                aria-label="Transcript or chapter times"
                spellCheck={false}
              />
              <SyncStatus timestamps={timestamps} chapters={chapters} transcriptMatches={transcriptMatches} linked={!!link} />
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

/** Recordings of the book on the Internet Archive, and other ways to add one. */
function Find({ title, author, onUse }: { title: string; author?: string; onUse: (source: AudioSource, file?: File) => void }) {
  const [search, setSearch] = useState<Search>({ state: 'searching' })
  const [loading, setLoading] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    searchRecordings(title, author).then(
      (results) => live && setSearch({ state: 'done', results }),
      () => live && setSearch({ state: 'failed', message: 'The Internet Archive couldn’t be reached. Check your connection.' }),
    )
    return () => {
      live = false
    }
  }, [title, author])

  const choose = async (recording: Recording) => {
    setLoading(recording.identifier)
    setLoadError(null)
    try {
      onUse(await loadRecording(recording))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setLoading(null)
    }
  }

  const addPasted = () => {
    const source = sourceFromLink(pasted)
    if (!source) {
      setPasteError('That doesn’t look like a link. Paste a YouTube video or an audio file’s address.')
      return
    }
    setPasteError(null)
    onUse(source)
  }

  return (
    <>
      <h3 className="search-section">Recordings of this book</h3>
      {search.state === 'searching' && <p className="search-hint">Looking on the Internet Archive…</p>}
      {search.state === 'failed' && <p className="search-hint audio-error">{search.message}</p>}
      {search.state === 'done' && search.results.length === 0 && (
        <p className="search-hint">
          No free recording found. LibriVox records books that are out of copyright; for others, try YouTube below.
        </p>
      )}
      {search.state === 'done' && search.results.length > 0 && (
        <ol className="search-results audio-results">
          {search.results.map((r) => (
            <li key={r.identifier}>
              <button type="button" onClick={() => choose(r)} disabled={loading !== null}>
                <span className="audio-result-title">{r.title || r.identifier}</span>
                <span className="muted small">
                  {[r.creator, r.librivox ? 'LibriVox' : 'Internet Archive'].filter(Boolean).join(' · ')}
                  {loading === r.identifier && ' · Opening…'}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {loadError && <p className="search-hint audio-error" role="alert">{loadError}</p>}

      <h3 className="search-section">Or add your own</h3>
      <form
        className="search-bar audio-link"
        onSubmit={(e) => {
          e.preventDefault()
          addPasted()
        }}
      >
        <input
          type="url"
          inputMode="url"
          placeholder="Paste a YouTube or MP3 link"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          aria-label="Audiobook link"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" className="text-button" disabled={!pasted.trim()}>
          Add
        </button>
      </form>
      {pasteError && <p className="search-hint audio-error" role="alert">{pasteError}</p>}
      <p className="search-hint">
        <a className="link-button" href={youTubeSearch(title)} target="_blank" rel="noreferrer">
          Search YouTube
        </a>{' '}
        and paste a video’s link, or{' '}
        <label className="audio-file">
          <span className="link-button">choose an audio file</span>
          <input
            type="file"
            accept="audio/*,.mp3,.m4a,.m4b,.ogg,.opus,.wav,.aac"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onUse({ kind: 'file', name: file.name }, file)
            }}
          />
        </label>
        .
      </p>
    </>
  )
}

function Linked({
  link,
  chapters,
  startsAt,
  speed,
  listening,
  lining,
  error,
  onLink,
  onListen,
}: {
  link: AudioLink
  chapters: Chapter[]
  startsAt: number
  speed: number
  listening: boolean
  lining: boolean
  error: string | null
  onLink: (link: AudioLink | null) => void
  onListen: () => void
}) {
  const { source } = link
  const tracksMatched =
    source.kind === 'archive'
      ? matchChapters(
          trackStarts(source.tracks).map((seconds, k) => ({ seconds, label: source.tracks[k].title, text: '' })),
          chapters,
        ).length
      : 0
  const matchSpeed = link.matchSpeed !== false
  const lined = Object.values(link.detected ?? {}).filter((points) => points.length > 0).length
  return (
    <>
      <div className="audio-source">
        <Icon name="headphones" size={18} />
        <span className="audio-source-name">{describe(link)}</span>
        <button type="button" className="text-button" onClick={() => onLink(null)}>
          Remove
        </button>
      </div>
      <p className="search-hint" aria-live="polite">
        {source.kind === 'youtube'
          ? 'A video can’t be lined up from its sound, so it starts at a guess. Tap the word you hear to sync, or paste its transcript below.'
          : `The first time you listen to ${source.kind === 'archive' ? 'a chapter' : 'it'}, its sound is matched to the text, sentence by sentence.`}
        {lining && ' Lining up now…'}
        {!lining && lined > 0 && source.kind === 'archive' && ` ${lined} of ${source.tracks.length} lined up so far.`}
        {!lining && lined > 0 && source.kind !== 'archive' && ' Lined up.'}
        {source.kind === 'archive' && tracksMatched === 0 && ' Its tracks aren’t named after this book’s chapters, so each is found by its sound.'}
      </p>
      <button type="button" className="bookmark-here" onClick={onListen}>
        <Icon name={listening ? 'pause' : 'play'} size={16} />
        {listening ? 'Pause' : `Listen from here · ${formatTime(startsAt)}`}
      </button>
      {error && <p className="search-hint audio-error" role="alert">{error}</p>}
      <div className="setting audio-speed">
        <span className="setting-name">Speed</span>
        <div className="segmented" role="radiogroup" aria-label="Playback speed">
          <button type="button" role="radio" aria-checked={!matchSpeed} onClick={() => onLink({ ...link, matchSpeed: false })}>
            As recorded
          </button>
          <button type="button" role="radio" aria-checked={matchSpeed} onClick={() => onLink({ ...link, matchSpeed: true })}>
            My speed{matchSpeed && speed !== 1 ? ` · ${speed}×` : ''}
          </button>
        </div>
      </div>
      <p className="search-hint">
        While it plays, the book follows the narrator. If they’re somewhere else, tap the word you hear and the book
        lines up from there.
        {link.points.length > 0 && (
          <>
            {' '}
            {link.points.length} {link.points.length === 1 ? 'word' : 'words'} synced ·{' '}
            <button type="button" className="link-button" onClick={() => onLink({ ...link, points: [] })}>
              Clear
            </button>
          </>
        )}
      </p>
    </>
  )
}

function SyncStatus({
  timestamps,
  chapters,
  transcriptMatches,
  linked,
}: {
  timestamps: string
  chapters: Chapter[]
  transcriptMatches: number
  linked: boolean
}) {
  const stamps = parseTimestamps(timestamps)
  if (stamps.length === 0) return null
  // The reader matches what's saved; until then (or before there's a recording) only the chapter count is known.
  const saved = linked && transcriptMatches > 0
  const matched = matchChapters(stamps, chapters).length
  return (
    <p className="search-hint" aria-live="polite">
      {saved
        ? `Transcript matched to the book at ${transcriptMatches} ${transcriptMatches === 1 ? 'spot' : 'spots'}.`
        : matched > 0
          ? `Matched ${matched} of ${stamps.length} times to chapters.`
          : `${stamps.length} times found.`}
    </p>
  )
}

function describe(link: AudioLink): string {
  const { source } = link
  if (source.kind === 'youtube') return 'YouTube video'
  if (source.kind === 'file') return source.name
  if (source.kind === 'archive') return source.title || source.identifier
  try {
    const url = new URL(source.url)
    return decodeURIComponent(url.pathname.split('/').pop() || url.hostname)
  } catch {
    return source.url
  }
}
