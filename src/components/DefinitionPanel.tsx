import { useEffect, useRef, useState } from 'react'
import { cleanWord, define, type Lookup } from '../lib/dictionary'
import { definitionCache } from '../lib/storage'
import { Icon } from './Icon'

interface Props {
  /** The word as it appears in the book ("windscreen,"). */
  word: string
  /** Animating out; the reader unmounts it shortly after. */
  closing?: boolean
  onClose: () => void
}

/**
 * A word's definition, opened by double-tapping it. A bottom sheet on phones
 * and a side panel on larger screens, like bookmarks.
 */
export function DefinitionPanel({ word, closing, onClose }: Props) {
  const panel = useRef<HTMLElement>(null)
  const [lookup, setLookup] = useState<{ word: string; result: Lookup } | null>(null)
  const shown = cleanWord(word)

  // Focus moves into the panel (for keyboards and screen readers) without
  // ringing its close button after a double-tap.
  useEffect(() => panel.current?.focus(), [])
  // Escape closes it wherever the focus is.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  useEffect(() => {
    let live = true
    define(word, definitionCache).then(
      (result) => live && setLookup({ word, result }),
      () => live && setLookup({ word, result: { status: 'offline' } }),
    )
    return () => {
      live = false
    }
  }, [word])

  const result = lookup?.word === word ? lookup.result : null

  return (
    <div className={`search-backdrop is-sheet${closing ? ' is-closing' : ''}`} onClick={onClose}>
      <aside
        ref={panel}
        tabIndex={-1}
        className="search-panel definition"
        role="dialog"
        aria-label={`Definition of ${shown}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-bar">
          <h2 className="panel-title definition-word">
            {result?.status === 'found' ? result.definition.word : shown}
            {result?.status === 'found' && result.definition.phonetic && (
              <span className="definition-phonetic">{result.definition.phonetic}</span>
            )}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close definition">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="search-body definition-body" aria-live="polite">
          {!result && <p className="search-hint">Looking up “{shown}”…</p>}

          {result?.status === 'found' && (
            <>
              {result.definition.word !== shown && (
                <p className="definition-form">
                  “{shown}” is a form of <em>{result.definition.word}</em>.
                </p>
              )}
              <ol className="definition-senses">
                {result.definition.senses.map((s, i) => (
                  <li key={i}>
                    {s.partOfSpeech && <span className="definition-pos">{s.partOfSpeech}</span>}
                    <span className="definition-text">{s.text}</span>
                    {s.example && <span className="definition-example">“{s.example}”</span>}
                  </li>
                ))}
              </ol>
              <p className="definition-source">
                From {result.definition.source}.{' '}
                <a href={result.definition.url} target="_blank" rel="noreferrer">
                  Full entry on Wiktionary
                </a>
              </p>
            </>
          )}

          {result?.status === 'not-found' && (
            <p className="search-hint">
              No definition found for “{shown}”. Names and rare words often aren’t in the dictionary.{' '}
              <a href={`https://en.wiktionary.org/w/index.php?search=${encodeURIComponent(shown)}`} target="_blank" rel="noreferrer">
                Search Wiktionary
              </a>
            </p>
          )}

          {result?.status === 'offline' && (
            <p className="search-hint">
              Couldn’t reach the dictionary. Definitions need a connection the first time; after that they’re kept on this
              device.
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}
