import { Fragment, useEffect, useRef, useState } from 'react'
import type { SearchHit, SearchResult } from '../lib/search'
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
const PAGE = 30
const CONTEXT_WORDS = 7
const NO_RESULT: SearchResult = { matches: [], related: [], totalMatches: 0, totalRelated: 0 }

export function SearchPanel({ bookSearch, words, chapters, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  // The query the current results belong to, so stale results are never shown as fresh.
  const [answered, setAnswered] = useState<{ query: string; result: SearchResult } | null>(null)
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

  useEffect(() => input.current?.focus(), [])

  const result = answered?.result ?? NO_RESULT
  const searching = answered?.query !== query
  const asked = (answered?.query ?? '').trim()
  const nothing = asked !== '' && result.totalMatches === 0 && result.totalRelated === 0
  const first = result.matches[0] ?? result.related[0]
  const quoted = /^["“].*["”]$/.test(asked)
  // The query as typed, shown inside our own quotation marks.
  const shownQuery = quoted ? asked.slice(1, -1) : asked

  const chapterTitle = (i: number) => {
    let title = ''
    for (const c of chapters) if (c.start <= i) title = c.title
    return chapters.length > 1 ? title : ''
  }

  const renderHit = (group: string) => (hit: SearchHit, k: number) => {
    const from = Math.max(0, hit.start - CONTEXT_WORDS)
    const to = Math.min(words.length - 1, hit.end + CONTEXT_WORDS)
    const marked = new Set(hit.highlights)
    const where = chapterTitle(hit.start)
    return (
      <li key={`${group}-${k}-${hit.start}-${hit.end}`}>
        <button type="button" onClick={() => onSelect(hit.start)}>
          <span className="search-snippet">
            {from > 0 && '… '}
            {words.slice(from, to + 1).map((w, k) => (
              <Fragment key={k}>
                {marked.has(from + k) ? <mark>{w}</mark> : w}{' '}
              </Fragment>
            ))}
            {to < words.length - 1 && '…'}
          </span>
          <span className="muted small">
            {where && `${where} · `}
            {Math.round((hit.start / Math.max(words.length - 1, 1)) * 100)}%
          </span>
        </button>
      </li>
    )
  }

  const more = (shown: number, total: number) =>
    total > shown &&
    !searching && (
      <li>
        <button type="button" className="search-more" onClick={() => setLimit(limit + PAGE)}>
          Show more ({(total - shown).toLocaleString()} left)
        </button>
      </li>
    )

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
            placeholder="Search this book"
            value={query}
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && first && !searching) onSelect(first.start)
            }}
            aria-label="Search text"
          />
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close search">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className={`search-body${searching && asked ? ' stale' : ''}`} aria-live="polite">
          {!query.trim() && (
            <p className="search-hint">
              Find a word, a phrase, or a passage you half remember. Different forms of a word count too
              (<em>run</em> finds <em>running</em>). Use “quotes” for an exact phrase.
            </p>
          )}

          {query.trim() && searching && !asked && <p className="search-status">Searching…</p>}

          {result.correctedQuery && !nothing && (
            <p className="search-status">
              No matches for “{shownQuery}”. Showing results for{' '}
              <button type="button" className="link-button" onClick={() => setQuery(result.correctedQuery!)}>
                {result.correctedQuery}
              </button>
              .
            </p>
          )}

          {nothing && asked.length < 2 && <p className="search-status">Keep typing to search…</p>}

          {nothing && asked.length >= 2 && (
            <div className="search-empty">
              <p className="search-empty-title">No matches for “{shownQuery}”</p>
              <p className="muted">
                {quoted
                  ? 'That exact phrase isn’t in this book. Try without the quotes to find passages with these words close together.'
                  : 'Check the spelling, or try fewer or different words.'}
              </p>
            </div>
          )}

          {result.totalMatches > 0 && (
            <section>
              <h3 className="search-section">
                {result.totalMatches.toLocaleString()} {result.totalMatches === 1 ? 'match' : 'matches'}
              </h3>
              <ol className="search-results">
                {result.matches.map(renderHit('match'))}
                {more(result.matches.length, result.totalMatches)}
              </ol>
            </section>
          )}

          {result.totalRelated > 0 && (
            <section>
              <h3 className="search-section">
                {result.totalMatches > 0 ? 'Related passages' : 'Passages with these words'} ·{' '}
                {result.totalRelated.toLocaleString()}
                <span className="muted"> — all your words, close together</span>
              </h3>
              <ol className="search-results">
                {result.related.map(renderHit('related'))}
                {more(result.related.length, result.totalRelated)}
              </ol>
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}
