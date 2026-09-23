import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { buildSearchIndex, search } from '../lib/search'
import type { Chapter } from '../lib/types'

interface Props {
  words: string[]
  chapters: Chapter[]
  onSelect: (index: number) => void
  onClose: () => void
}

const LIMIT = 200
const SNIPPET_WORDS = 8

export function SearchPanel({ words, chapters, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const input = useRef<HTMLInputElement>(null)

  const index = useMemo(() => buildSearchIndex(words), [words])
  const matches = useMemo(() => search(index, deferredQuery, LIMIT), [index, deferredQuery])

  useEffect(() => input.current?.focus(), [])

  const chapterTitle = (i: number) => {
    let title = ''
    for (const c of chapters) if (c.start <= i) title = c.title
    return chapters.length > 1 ? title : ''
  }

  return (
    <div className="search-backdrop" onClick={onClose}>
      <aside
        className="search-panel"
        role="dialog"
        aria-label="Search in book"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="search-bar">
          <input
            ref={input}
            type="search"
            placeholder="Search for a word or phrase…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) onSelect(matches[0].start)
            }}
            aria-label="Search text"
          />
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close search">
            ✕
          </button>
        </div>
        {deferredQuery.trim() && (
          <p className="muted small search-count">
            {matches.length === 0
              ? 'No matches'
              : `${matches.length >= LIMIT ? `${LIMIT}+` : matches.length} match${matches.length === 1 ? '' : 'es'}`}
          </p>
        )}
        <ol className="search-results">
          {matches.map((m) => {
            const before = words.slice(Math.max(0, m.start - SNIPPET_WORDS), m.start).join(' ')
            const hit = words.slice(m.start, m.end + 1).join(' ')
            const after = words.slice(m.end + 1, m.end + 1 + SNIPPET_WORDS).join(' ')
            const where = chapterTitle(m.start)
            return (
              <li key={m.start}>
                <button type="button" onClick={() => onSelect(m.start)}>
                  <span className="search-snippet">
                    {m.start > SNIPPET_WORDS && '… '}
                    {before} <mark>{hit}</mark> {after}
                    {m.end + 1 + SNIPPET_WORDS < words.length && ' …'}
                  </span>
                  <span className="muted small">
                    {where && `${where} · `}
                    {((m.start / Math.max(words.length - 1, 1)) * 100).toFixed(1)}%
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </aside>
    </div>
  )
}
