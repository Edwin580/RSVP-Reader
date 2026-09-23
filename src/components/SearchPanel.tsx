import { useEffect, useRef, useState } from 'react'
import type { SearchResult } from '../lib/search'
import type { BookSearch } from '../lib/searchClient'
import type { Chapter } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  bookSearch: BookSearch
  words: string[]
  chapters: Chapter[]
  onSelect: (index: number) => void
  onClose: () => void
}

/** Results fetched and rendered per page; more are loaded on demand. */
const PAGE = 50
const SNIPPET_WORDS = 8

export function SearchPanel({ bookSearch, words, chapters, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  // The query the current results belong to, so stale results are never shown as fresh.
  const [answered, setAnswered] = useState<{ query: string; result: SearchResult }>({
    query: '',
    result: { matches: [], total: 0 },
  })
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    bookSearch.query(query, limit).then((result) => {
      if (!cancelled) setAnswered({ query, result })
    })
    return () => {
      cancelled = true
    }
  }, [bookSearch, query, limit])

  const { matches, total } = answered.result
  const searching = answered.query !== query

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
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) onSelect(matches[0].start)
            }}
            aria-label="Search text"
          />
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close search">
            <Icon name="close" size={18} />
          </button>
        </div>
        {query.trim() && (
          <p className="muted small search-count" aria-live="polite">
            {searching && !answered.query.trim()
              ? 'Searching…'
              : total === 0
                ? 'No matches'
                : `${total.toLocaleString()} match${total === 1 ? '' : 'es'}`}
          </p>
        )}
        <ol className={`search-results${searching ? ' stale' : ''}`}>
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
          {total > matches.length && !searching && (
            <li>
              <button type="button" className="search-more" onClick={() => setLimit(limit + PAGE)}>
                Show more ({(total - matches.length).toLocaleString()} left)
              </button>
            </li>
          )}
        </ol>
      </aside>
    </div>
  )
}
