import { useEffect, useRef } from 'react'
import type { Bookmark, Chapter } from '../lib/types'
import { useSheetDrag } from '../hooks/useSheetDrag'
import { Icon } from './Icon'

interface Props {
  bookmarks: Bookmark[]
  words: string[]
  chapters: Chapter[]
  /** Whether the sentence being read is already bookmarked. */
  here: boolean
  onToggleHere: () => void
  /** Animating out; the reader unmounts it shortly after. */
  closing?: boolean
  onSelect: (index: number) => void
  onRemove: (index: number) => void
  onClose: () => void
}

const SNIPPET_WORDS = 18

/** Saved spots in the book: add one where you are, jump to or remove the others. */
export function BookmarksPanel({
  bookmarks,
  words,
  chapters,
  here,
  onToggleHere,
  closing,
  onSelect,
  onRemove,
  onClose,
}: Props) {
  // Escape closes it wherever the focus is (not only inside the panel),
  // and never reaches the reader, where it would close the book.
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
  // On phones it's a bottom sheet: pull it down to put it away.
  const sheet = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  useSheetDrag(sheet, onClose, body)

  const chapterTitle = (i: number) => {
    let title = ''
    for (const c of chapters) if (c.start <= i) title = c.title
    return chapters.length > 1 ? title : ''
  }

  return (
    <div className={`search-backdrop is-sheet${closing ? ' is-closing' : ''}`} onClick={onClose}>
      <aside
        ref={sheet}
        className="search-panel"
        role="dialog"
        aria-label="Bookmarks"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="panel-bar">
          <h2 className="panel-title">Bookmarks</h2>
          <button type="button" className="icon-button" ref={close} onClick={onClose} aria-label="Close bookmarks">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="search-body" ref={body}>
          <button type="button" className="bookmark-here" onClick={onToggleHere}>
            <Icon name={here ? 'bookmarkFilled' : 'bookmark'} size={18} />
            {here ? 'Remove bookmark here' : 'Bookmark this spot'}
          </button>

          {bookmarks.length === 0 ? (
            <p className="search-hint">
              Bookmarks save the sentence you’re on so you can come back to it.
              <span className="on-mouse"> Press <kbd>B</kbd> to add one while reading.</span>
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
