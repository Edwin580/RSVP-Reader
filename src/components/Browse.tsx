import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useSheetDrag } from '../hooks/useSheetDrag'
import {
  CATALOG_NAME,
  SORTS,
  SUBJECTS,
  downloadBook,
  easeLabel,
  previewStart,
  type CatalogBook,
  type CatalogDetails,
  type CatalogSort,
  type ContentsEntry,
} from '../lib/catalog'
import { searchIndex } from '../lib/catalogIndex'
import { ensureIndex, ensureNewest, indexState, loadContents, loadDetails, loadSection, prefetchBook, retryIndex, subscribe } from '../lib/catalogStore'
import { formatMinutes } from '../lib/rsvp'
import type { BookMeta } from '../lib/types'
import { Icon } from './Icon'

interface Props {
  /** The library, to show which books are in it already. */
  books: BookMeta[]
  wpm: number
  onBack: () => void
  /** Add a downloaded book to the library and open it; rejects if it can't be read. */
  onAdd: (file: File) => Promise<void>
  onOpen: (id: string) => void
}

type View = { kind: 'list' } | { kind: 'book'; entry: CatalogBook } | { kind: 'preview'; entry: CatalogBook }

interface Search {
  query: string
  subject: string
  sort: CatalogSort | null
}

// The last search and where it was scrolled to, kept for the session so
// coming back to browsing picks up where it was.
let lastSearch: Search = { query: '', subject: '', sort: null }
let lastScroll = 0

/** Books listed at first, and added each time more are asked for. */
const LIST_STEP = 30

const readingTime = (words: number | undefined, wpm: number) => (words ? formatMinutes(words / wpm) : undefined)
const inLibrary = (books: BookMeta[], title: string) => books.find((b) => b.title.trim().toLowerCase() === title.trim().toLowerCase())

/**
 * Free books to find and add: a catalog of public-domain classics from
 * Standard Ebooks, searchable and sorted, each with a description and a
 * preview of its opening, downloaded only once confirmed.
 */
export function Browse({ books, wpm, onBack, onAdd, onOpen }: Props) {
  const [view, setView] = useState<View>({ kind: 'list' })
  const listScroll = useRef(lastScroll)

  const show = (next: View) => {
    if (view.kind === 'list') listScroll.current = window.scrollY
    setView(next)
  }
  // A new view starts at the top; the list comes back where it was.
  useLayoutEffect(() => {
    window.scrollTo(0, view.kind === 'list' ? listScroll.current : 0)
  }, [view])
  useEffect(() => () => void (lastScroll = view.kind === 'list' ? window.scrollY : listScroll.current), [view])

  const back = useCallback(() => {
    if (view.kind === 'preview') setView({ kind: 'book', entry: view.entry })
    else if (view.kind === 'book') setView({ kind: 'list' })
    else onBack()
  }, [view, onBack])

  // Escape goes back, unless a pop-up or a field has it.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role=dialog]')) return
      if ((e.target as Element)?.closest?.('input')) return
      back()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [back])

  return (
    <main className="library browse">
      {view.kind === 'list' && <BookList books={books} wpm={wpm} onBack={onBack} onPick={(entry) => show({ kind: 'book', entry })} />}
      {view.kind === 'book' && (
        <BookPage
          entry={view.entry}
          books={books}
          wpm={wpm}
          onBack={back}
          onPreview={() => show({ kind: 'preview', entry: view.entry })}
          onAdd={onAdd}
          onOpen={onOpen}
        />
      )}
      {view.kind === 'preview' && <Preview entry={view.entry} books={books} onBack={back} onAdd={onAdd} onOpen={onOpen} />}
    </main>
  )
}

/** Load something (kept on the device, see catalogStore), keeping only the latest request's answer. */
function useLoad<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: string }>({ key: null })
  const [attempt, setAttempt] = useState(0)
  const loader = useRef(load)
  useEffect(() => {
    loader.current = load
  })
  useEffect(() => {
    if (!key) return
    let current = true
    loader.current().then(
      (data) => current && setState({ key, data }),
      (e) => current && setState({ key, error: message(e) }),
    )
    return () => {
      current = false
    }
  }, [key, attempt])
  const fresh = state.key === key
  return {
    data: fresh ? state.data : undefined,
    error: fresh ? state.error : undefined,
    loading: !!key && !fresh,
    retry: () => {
      setState({ key: null })
      setAttempt((n) => n + 1)
    },
  }
}

/**
 * The catalog, searched, filtered and sorted on the device as you type
 * (see catalogIndex.ts). The first visit fetches it, listing books as they
 * arrive; after that it opens at once, offline too, and refreshes weekly.
 */
function BookList({ books, wpm, onBack, onPick }: { books: BookMeta[]; wpm: number; onBack: () => void; onPick: (entry: CatalogBook) => void }) {
  const [search, setSearch] = useState<Search>(lastSearch)
  const [limit, setLimit] = useState(LIST_STEP)
  const index = useSyncExternalStore(subscribe, indexState)
  useEffect(() => {
    ensureIndex()
  }, [])
  useEffect(() => {
    lastSearch = search
    if (search.sort === 'newest') ensureNewest()
  }, [search])
  const update = (change: Partial<Search>) => {
    setSearch((s) => ({ ...s, ...change }))
    setLimit(LIST_STEP)
  }
  // Typing stays quick on a long list: the results follow a moment behind.
  const query = useDeferredValue(search.query)
  const found = useMemo(
    () => searchIndex(index.books, { query, subject: search.subject || undefined, sort: search.sort }),
    [index.books, query, search.subject, search.sort],
  )
  const shown = found.slice(0, limit)
  const searching = !!search.query.trim()
  const building = index.status === 'building' || index.status === 'loading'

  return (
    <>
      <header className="browse-header">
        <button type="button" className="icon-button browse-back" onClick={onBack} aria-label="Back to your library">
          <Icon name="back" size={22} />
        </button>
        <h1>Free books</h1>
        <p className="muted">
          Classics from {CATALOG_NAME}: free, in the public domain, and carefully edited. Look inside before you add one.
        </p>
      </header>

      <form
        className="browse-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          ;(document.activeElement as HTMLElement)?.blur()
        }}
      >
        <Icon name="search" size={18} />
        <input
          type="search"
          placeholder="Title, author or subject"
          aria-label="Search free books"
          value={search.query}
          enterKeyHint="search"
          onChange={(e) => update({ query: e.target.value })}
        />
      </form>

      <div className="browse-subjects" role="group" aria-label="Subjects">
        {[{ value: '', label: 'All' }, ...SUBJECTS].map((s) => (
          <button
            key={s.value}
            type="button"
            className="chip"
            aria-pressed={search.subject === s.value}
            onClick={() => update({ subject: s.value })}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="segmented browse-sort" role="radiogroup" aria-label="Order">
        {(searching ? [{ value: 'relevance' as const, label: 'Best match' }, ...SORTS] : SORTS).map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={(search.sort ?? (searching ? 'relevance' : 'popularity')) === o.value}
            onClick={() => update({ sort: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>

      {shown.length > 0 && (
        <ul className="browse-list" aria-label="Books">
          {shown.map((b) => {
            const owned = inLibrary(books, b.title)
            const time = readingTime(b.words, wpm)
            return (
              <li key={b.id}>
                <button
                  type="button"
                  className="browse-item"
                  onClick={() => onPick(b)}
                  // Its page is fetched as soon as it's touched, so it opens complete.
                  onPointerDown={() => prefetchBook(b.id)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && prefetchBook(b.id)}
                  onFocus={() => prefetchBook(b.id)}
                >
                  <CatalogCover book={b} />
                  <span className="browse-item-text">
                    <span className="browse-title">{b.title}</span>
                    <span className="browse-author">{b.author}</span>
                    <span className="browse-meta muted">
                      {[b.words && `${b.words.toLocaleString()} words`, time, owned && 'In your library'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Icon name="forward" size={18} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {building && (
        <div className="browse-status muted" role="status">
          <p>{index.books.length ? `Getting the catalog… ${index.books.length.toLocaleString()} books so far` : 'Getting the catalog…'}</p>
          {index.total > 0 && (
            <span className="bar" aria-hidden="true">
              <span style={{ width: `${Math.round((index.loaded / index.total) * 100)}%` }} />
            </span>
          )}
        </div>
      )}
      {search.sort === 'newest' && index.newest === 'building' && (
        <p className="browse-status muted" role="status">
          Sorting by newest…
        </p>
      )}
      {index.status === 'error' && (
        <div className="browse-status" role="alert">
          <p>
            {index.error}
            {index.books.length > 0 && ' Only part of the catalog is listed.'}
          </p>
          <button type="button" className="text-button" onClick={() => retryIndex()}>
            Try again
          </button>
        </div>
      )}
      {!building && index.status !== 'error' && found.length === 0 && (
        <p className="browse-status muted">No books match. Try other words, or another subject.</p>
      )}
      {found.length > shown.length && (
        <button type="button" className="text-button browse-more" onClick={() => setLimit((n) => n + LIST_STEP)}>
          Show more
        </button>
      )}
      {index.status === 'ready' && found.length > 0 && (
        <p className="browse-count muted">
          {found.length === index.books.length
            ? `${index.books.length.toLocaleString()} books`
            : `${found.length.toLocaleString()} of ${index.books.length.toLocaleString()} books`}
        </p>
      )}

      <Credit />
    </>
  )
}

function Credit() {
  return (
    <footer className="browse-credit muted">
      Books from{' '}
      <a href="https://standardebooks.org" target="_blank" rel="noreferrer">
        {CATALOG_NAME}
      </a>
      , a volunteer project. They’re thought to be free of copyright in the United States; elsewhere, check your
      local laws.
    </footer>
  )
}

function CatalogCover({ book, large }: { book: Pick<CatalogBook, 'cover' | 'title'>; large?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (!book.cover || failed)
    return (
      <span className={`cover cover-plain${large ? ' cover-large' : ''}`} aria-hidden="true">
        <span>{book.title}</span>
      </span>
    )
  return (
    <img
      className={`cover${large ? ' cover-large' : ''}`}
      src={book.cover}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

function BookPage({
  entry,
  books,
  wpm,
  onBack,
  onPreview,
  onAdd,
  onOpen,
}: {
  entry: CatalogBook
  books: BookMeta[]
  wpm: number
  onBack: () => void
  onPreview: () => void
  onAdd: (file: File) => Promise<void>
  onOpen: (id: string) => void
}) {
  const page = useLoad(`book:${entry.id}`, () => loadDetails(entry.id))
  const details = page.data
  // The preview's contents too, so it opens at once.
  useEffect(() => {
    if (details?.contents) loadContents(details).catch(() => {})
  }, [details])
  // Shown straight away from the list, filled in once the book's page arrives.
  const book: CatalogBook & Partial<CatalogDetails> = { ...entry, ...details, cover: entry.cover ?? details?.cover }
  const time = readingTime(book.words, wpm)

  return (
    <article className="browse-book">
      <nav className="browse-nav">
        <button type="button" className="text-button browse-back-text" onClick={onBack}>
          <Icon name="back" size={20} />
          Free books
        </button>
      </nav>
      <header className="browse-book-head">
        <CatalogCover book={book} large />
        <div>
          <h1>{book.title}</h1>
          <p className="browse-author">{book.author}</p>
          {book.translator && <p className="muted">Translated by {book.translator}</p>}
          <p className="browse-facts muted">
            {[
              book.words && `${book.words.toLocaleString()} words`,
              time && `about ${time} at ${wpm} wpm`,
              book.readingEase !== undefined && `${easeLabel(book.readingEase)} to read`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {book.subjects.length > 0 && <p className="browse-subjects-line muted">{book.subjects.join(', ')}</p>}
        </div>
      </header>

      <Actions details={details} title={book.title} books={books} onPreview={onPreview} onAdd={onAdd} onOpen={onOpen} />

      <section className="browse-about" aria-label="About this book">
        {details?.summary && <p className="browse-summary">{details.summary}</p>}
        {details?.description.map((p, k) => <p key={k}>{p}</p>)}
        {page.loading && <p className="muted" role="status">Loading the description…</p>}
        {page.error && (
          <div role="alert">
            <p>{page.error}</p>
            <button type="button" className="text-button" onClick={page.retry}>
              Try again
            </button>
          </div>
        )}
      </section>
      <Credit />
    </article>
  )
}

/** Preview and add, or open the copy already in the library. */
function Actions({
  details,
  title,
  books,
  onPreview,
  onAdd,
  onOpen,
}: {
  details: CatalogDetails | undefined
  title: string
  books: BookMeta[]
  onPreview?: () => void
  onAdd: (file: File) => Promise<void>
  onOpen: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const owned = inLibrary(books, title)
  return (
    <div className="browse-actions">
      {owned ? (
        <button type="button" className="demo-button" onClick={() => onOpen(owned.id)}>
          <Icon name="play" size={18} />
          Open from your library
        </button>
      ) : (
        <span className="menu-anchor">
          <button type="button" className="demo-button" disabled={!details} onClick={() => setConfirming(true)}>
            <Icon name="plus" size={18} />
            Add to library
          </button>
          {confirming && details && <AddSheet details={details} onAdd={onAdd} onClose={() => setConfirming(false)} />}
        </span>
      )}
      {onPreview && (
        <button type="button" className="text-button" disabled={!details?.contents} onClick={onPreview}>
          Read a preview
        </button>
      )}
    </div>
  )
}

/** Downloading only happens here, once confirmed. */
function AddSheet({ details, onAdd, onClose }: { details: CatalogDetails; onAdd: (file: File) => Promise<void>; onClose: () => void }) {
  const sheet = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ step: 'confirm' } | { step: 'downloading'; fraction: number } | { step: 'adding' } | { step: 'failed'; error: string }>({
    step: 'confirm',
  })
  const download = useRef<AbortController | null>(null)
  const close = useCallback(() => {
    download.current?.abort()
    onClose()
  }, [onClose])
  useSheetDrag(sheet, close)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [close])
  useEffect(() => () => download.current?.abort(), [])

  const start = async () => {
    const controller = new AbortController()
    download.current = controller
    setState({ step: 'downloading', fraction: 0 })
    try {
      const file = await downloadBook(details, (fraction) => setState({ step: 'downloading', fraction }), controller.signal)
      setState({ step: 'adding' })
      await onAdd(file)
    } catch (e) {
      if (controller.signal.aborted) return
      setState({ step: 'failed', error: message(e) })
    }
  }

  const working = state.step === 'downloading' || state.step === 'adding'
  return (
    <>
      <div className="popover-backdrop" aria-hidden="true" onClick={close} />
      <div ref={sheet} className="popover add-sheet" role="dialog" aria-label={`Add ${details.title}`}>
        <div className="sheet-handle" aria-hidden="true" />
        <p className="add-title">Add “{details.title}” to your library?</p>
        <p className="muted">
          It’s downloaded from {CATALOG_NAME} as an EPUB
          {details.words ? ` (${details.words.toLocaleString()} words)` : ''} and kept on this device, like a book you
          add yourself.
        </p>
        {state.step === 'failed' && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
        {working && (
          <div className="add-progress" role="status">
            <span>{state.step === 'adding' ? 'Adding to your library…' : `Downloading… ${Math.round(state.fraction * 100)}%`}</span>
            <span className="bar" aria-hidden="true">
              <span style={{ width: `${state.step === 'adding' ? 100 : Math.round(state.fraction * 100)}%` }} />
            </span>
          </div>
        )}
        <div className="add-buttons">
          <button type="button" className="demo-button" onClick={start} disabled={working}>
            <Icon name="check" size={18} />
            {state.step === 'failed' ? 'Try again' : 'Download and add'}
          </button>
          <button type="button" className="text-button" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}

function Preview({
  entry,
  books,
  onBack,
  onAdd,
  onOpen,
}: {
  entry: CatalogBook
  books: BookMeta[]
  onBack: () => void
  onAdd: (file: File) => Promise<void>
  onOpen: (id: string) => void
}) {
  const details = useLoad(`book:${entry.id}`, () => loadDetails(entry.id))
  const contents = useLoad(details.data ? `contents:${entry.id}` : null, () => loadContents(details.data!))
  const [at, setAt] = useState<number | null>(null)
  const entries: ContentsEntry[] = contents.data ?? []
  const k = at ?? (entries.length ? previewStart(entries) : 0)
  const section = useLoad(entries[k] ? `section:${entries[k].href}` : null, () => loadSection(entries[k].href))
  // The next section too, so Next turns the page at once.
  const following = entries[k + 1]?.href
  useEffect(() => {
    if (section.data && following) loadSection(following).catch(() => {})
  }, [section.data, following])
  const error = details.error ?? contents.error ?? section.error
  const go = (next: number) => {
    setAt(next)
    window.scrollTo(0, 0)
  }

  return (
    <article className="browse-preview">
      <nav className="browse-nav">
        <button type="button" className="text-button browse-back-text" onClick={onBack}>
          <Icon name="back" size={20} />
          {entry.title}
        </button>
      </nav>
      <p className="browse-preview-label muted">
        Preview{entries[k] ? ` · ${sectionName(entries[k].label)}` : ''}
      </p>
      <div className="browse-preview-text">
        {section.data?.paragraphs.map((p, n) => <p key={n}>{p}</p>)}
        {!error && !section.data && (
          <p className="muted" role="status">
            Loading the opening…
          </p>
        )}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="text-button"
              onClick={() => (details.error ? details.retry : contents.error ? contents.retry : section.retry)()}
            >
              Try again
            </button>
          </div>
        )}
      </div>
      {entries.length > 0 && (
        <div className="browse-preview-nav">
          <button type="button" className="text-button" disabled={k <= 0} onClick={() => go(k - 1)}>
            <Icon name="back" size={18} />
            Previous
          </button>
          <button type="button" className="text-button" disabled={k >= entries.length - 1} onClick={() => go(k + 1)}>
            Next
            <Icon name="forward" size={18} />
          </button>
        </div>
      )}
      <div className="browse-preview-add">
        <Actions details={details.data} title={entry.title} books={books} onAdd={onAdd} onOpen={onOpen} />
      </div>
    </article>
  )
}

/** "I" or "12" is a chapter number; anything else ("Preface") is a name already. */
function sectionName(label: string): string {
  return /^([IVXLCDM]+|\d+)\.?$/.test(label) ? `Chapter ${label}` : label
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
