import { useEffect, useRef, useState } from 'react'
import {
  findLinks,
  formatTime,
  matchChapters,
  parseTimestamps,
  sourceFromLink,
  type AudioLink,
} from '../lib/audio'
import type { Chapter } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  title: string
  chapters: Chapter[]
  link: AudioLink | null
  /** Where the recording would start for the word being read, in seconds. */
  startsAt: number
  listening: boolean
  error: string | null
  /** Animating out; the reader unmounts it shortly after. */
  closing?: boolean
  onLink: (link: AudioLink | null, file?: File) => void
  onListen: () => void
  onClose: () => void
}

/** Find an audiobook, link it to the book, and line it up with chapter timestamps. */
export function AudioPanel({ title, chapters, link, startsAt, listening, error, closing, onLink, onListen, onClose }: Props) {
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

  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [timestamps, setTimestamps] = useState(link?.timestamps ?? '')
  const stamps = parseTimestamps(timestamps)
  const matched = matchChapters(stamps, chapters).length

  const addPasted = () => {
    const source = sourceFromLink(pasted)
    if (!source) {
      setPasteError('That doesn’t look like a link. Paste a YouTube video or an audio file’s address.')
      return
    }
    setPasteError(null)
    setPasted('')
    onLink({ source, timestamps, points: [] })
  }

  // Saved a moment after typing stops (or pasting), once there's a recording to go with.
  useEffect(() => {
    if (!link || timestamps === link.timestamps) return
    const timer = window.setTimeout(() => onLink({ ...link, timestamps }), 400)
    return () => window.clearTimeout(timer)
  }, [timestamps, link, onLink])

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
            <>
              <div className="audio-source">
                <Icon name="headphones" size={18} />
                <span className="audio-source-name">{describe(link)}</span>
                <button type="button" className="text-button" onClick={() => onLink(null)}>
                  Remove
                </button>
              </div>
              <button type="button" className="bookmark-here" onClick={onListen}>
                <Icon name={listening ? 'pause' : 'play'} size={16} />
                {listening ? 'Pause' : `Listen from here · ${formatTime(startsAt)}`}
              </button>
              {error && <p className="search-hint audio-error" role="alert">{error}</p>}
              <p className="search-hint">
                The book follows the narrator while you listen. If it drifts, pause where the narrator is and tap{' '}
                <em>Sync here</em> under the progress bar.
                {link.points.length > 0 && (
                  <>
                    {' '}
                    {link.points.length} synced {link.points.length === 1 ? 'spot' : 'spots'} ·{' '}
                    <button type="button" className="link-button" onClick={() => onLink({ ...link, points: [] })}>
                      Clear
                    </button>
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="search-hint">
                Listen along to an audiobook someone has recorded: a video on YouTube, a free recording from LibriVox, or a
                file of your own. Reading picks up in the recording wherever you are in the book.
              </p>
              <h3 className="search-section">Find a recording</h3>
              <div className="audio-find">
                {findLinks(title).map((l) => (
                  <a key={l.label} className="cast-chip" href={l.url} target="_blank" rel="noreferrer">
                    {l.label}
                  </a>
                ))}
              </div>
              <h3 className="search-section">Add it</h3>
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
              <label className="search-hint audio-file">
                or{' '}
                <span className="link-button">choose an audio file</span>
                <input
                  type="file"
                  accept="audio/*,.mp3,.m4a,.m4b,.ogg,.opus,.wav,.aac"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) onLink({ source: { kind: 'file', name: file.name }, timestamps, points: [] }, file)
                  }}
                />
              </label>
            </>
          )}

          <h3 className="search-section">
            Chapter times <span className="muted">(optional)</span>
          </h3>
          <textarea
            className="audio-times"
            rows={4}
            placeholder={'Paste the chapter list from the video’s description:\n0:00 Chapter 1\n24:10 Chapter 2'}
            value={timestamps}
            onChange={(e) => setTimestamps(e.target.value)}
            aria-label="Chapter times"
            spellCheck={false}
          />
          {stamps.length > 0 && (
            <p className="search-hint" aria-live="polite">
              {matched > 0
                ? `Matched ${matched} of ${stamps.length} times to chapters.`
                : chapters.length > 1
                  ? 'None of these match a chapter title in this book.'
                  : 'This book has no chapters to match these to; use Sync here instead.'}
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}

function describe(link: AudioLink): string {
  const { source } = link
  if (source.kind === 'youtube') return 'YouTube video'
  if (source.kind === 'file') return source.name
  try {
    const url = new URL(source.url)
    return decodeURIComponent(url.pathname.split('/').pop() || url.hostname)
  } catch {
    return source.url
  }
}
