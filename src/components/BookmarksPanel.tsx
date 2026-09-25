import { useEffect, useRef } from 'react'
import type { Bookmark, Chapter } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  bookmarks: Bookmark[]
  words: string[]
  chapters: Chapter[]
  /** Whether the sentence being read is already bookmarked. */
  here: boolean
  onToggleHere: () => void
  onSelect: (index: number) => void
  onRemove: (index: number) => void
  onClose: () => void
}

const SNIPPET_WORDS = 18

/** Saved spots in the book: add one where you are, jump to or remove the others. */
export function BookmarksPanel({ bookmarks, words, chapters, here, onToggleHere, onSelect, onRemove, onClose }: Props) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])

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
        aria-label="Bookmarks"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="panel-bar">
          <h2 className="panel-title">Bookmarks</h2>
          <button type="button" className="icon-button" ref={close} onClick={onClose} aria-label="Close bookmarks">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="search-body">
          <button type="button" className="bookmark-here" onClick={onToggleHere}>
            <Icon name={here ? 'bookmarkFilled' : 'bookmark'} size={18} />
            {here ? 'Remove bookmark here' : 'Bookmark this spot'}
          </button>

          {bookmarks.length === 0 ? (
            <p className="search-hint">
              Bookmarks save the sentence you’re on so you can come back to it. Press <kbd>B</kbd> to add one while
              reading.
            </p>
          ) : (
            <ol className="search-results">
              {bookmarks.map((b) => {
                const where = chapterTitle(b.index)
                const end = Math.min(words.length, b.index + SNIPPET_WORDS)
                return (
                  <li key={b.index} className="bookmark-item">
                    <button type="button" onClick={() => onSelect(b.index)}>
                      <span className="search-snippet">
                        {words.slice(b.index, end).join(' ')}
                        {end < words.length && ' …'}
                      </span>
                      <span className="muted small">
                        {where && `${where} · `}
                        {Math.round((b.index / Math.max(words.length - 1, 1)) * 100)}% ·{' '}
                        {new Date(b.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button bookmark-remove"
                      onClick={() => onRemove(b.index)}
                      aria-label="Remove bookmark"
                      title="Remove"
                    >
                      <Icon name="trash" size={18} />
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      </aside>
    </div>
  )
}
