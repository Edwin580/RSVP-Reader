// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KEPT_AFTER_PRUNE, MAX_KEPT, RESULTS_MAX_AGE_MS, cached, loadIndex, loadResults, memoryStore, prune, setStore } from '../catalogStore'

beforeEach(() => setStore(memoryStore()))

/** A page of results in the catalog's markup. */
const results = (books: [string, string[]][]) =>
  `<ol>${books
    .map(
      ([id, tags]) => `<li typeof="schema:Book" about="/ebooks/${id}"><p><a href="/ebooks/${id}"><span property="schema:name">${id}</span></a></p>
      <ul class="tags">${tags.map((t) => `<li><a href="/subjects/${t}">${t}</a></li>`).join('')}</ul></li>`,
    )
    .join('')}</ol>`

describe('cached', () => {
  it('loads once, then answers from memory and from storage', async () => {
    const store = memoryStore()
    setStore(store)
    const load = vi.fn(async () => 'page')
    expect(await cached('k', load)).toBe('page')
    expect(await cached('k', load)).toBe('page')
    setStore(store) // the app opened again: memory gone, storage kept
    expect(await cached('k', load)).toBe('page')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('uses an old copy at once and refreshes it in the background', async () => {
    const store = memoryStore()
    setStore(store)
    await store.set('k', { at: 0, value: 'old' })
    const load = vi.fn(async () => 'new')
    expect(await cached('k', load, 1000, 5000)).toBe('old')
    await vi.waitFor(() => expect(store.map.get('k')).toMatchObject({ value: 'new' }))
  })

  it('keeps nothing from a failed load, so it can be tried again', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(cached('k', failing)).rejects.toThrow('offline')
    expect(await cached('k', async () => 'back')).toBe('back')
  })
})

describe('prune', () => {
  it('past the cap, keeps only the most recent, well under it', async () => {
    const store = memoryStore()
    setStore(store)
    for (let k = 0; k < MAX_KEPT + 20; k++) await store.set(`k${k}`, { at: k, value: k })
    await prune()
    expect(store.map.size).toBe(KEPT_AFTER_PRUNE)
    expect(store.map.has('k0')).toBe(false)
    expect(store.map.has(`k${MAX_KEPT + 19}`)).toBe(true)
  })

  it('under the cap, only counts the keys: it never reads what’s kept', async () => {
    const store = memoryStore()
    setStore(store)
    for (let k = 0; k < MAX_KEPT; k++) await store.set(`k${k}`, { at: k, value: k })
    const entries = vi.spyOn(store, 'entries')
    await prune()
    expect(entries).not.toHaveBeenCalled()
    expect(store.map.size).toBe(MAX_KEPT)
  })
})

describe('loadResults', () => {
  it('fetches only the page asked for, and keeps it for a day', async () => {
    const store = memoryStore()
    setStore(store)
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => new Response(results([['a/b', ['fiction']]])))
    const page = await loadResults({ sort: 'popularity' }, fetcher)
    expect(page.books.map((b) => b.id)).toEqual(['a/b'])
    expect(fetcher).toHaveBeenCalledTimes(1)
    setStore(store)
    await loadResults({ sort: 'popularity' }, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [key, kept] = [...store.map.entries()][0] as [string, { at: number }]
    expect(key).toMatch(/^results:https:\/\/standardebooks\.org\/ebooks\?/)
    expect(Date.now() - kept.at).toBeLessThan(RESULTS_MAX_AGE_MS)
  })

  it('keeps a search’s results for this visit only, so they don’t push out what’s been read', async () => {
    const store = memoryStore()
    setStore(store)
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => new Response(results([['a/b', ['fiction']]])))
    await loadResults({ query: 'b' }, fetcher)
    await loadResults({ query: 'b' }, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(store.map.size).toBe(0)
  })

  it('keeps to the subject, should the site ever ignore it', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => new Response(results([['a/b', ['fiction']], ['c/d', ['adventure', 'fiction']]])))
    const page = await loadResults({ subject: 'adventure' }, fetcher)
    expect(page.books.map((b) => b.id)).toEqual(['c/d'])
    expect(String(fetcher.mock.calls[0][0])).toContain('tags%5B%5D=adventure&tags%5B%5D=adventure')
  })
})

describe('loadIndex', () => {
  /** The whole catalog, 48 a page: `count` books. */
  function catalog(count: number) {
    const requests: URL[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      requests.push(url)
      const page = Number(url.searchParams.get('page') ?? 1)
      const last = Math.ceil(count / 48)
      const ids = Array.from({ length: count }, (_, k) => `a/b${k}`).slice((page - 1) * 48, page * 48)
      const links = Array.from({ length: last }, (_, k) => `<a href="/ebooks?page=${k + 1}">${k + 1}</a>`).join('')
      return new Response(`${results(ids.map((id) => [id, ['fiction']]))}<nav class="pagination">${links}</nav>`)
    })
    return { fetcher, requests }
  }

  it('fetches every page once, keeps the list compactly, and reads it back', async () => {
    const store = memoryStore()
    setStore(store)
    const { fetcher, requests } = catalog(130)
    const books = await loadIndex(fetcher)
    expect(books).toHaveLength(130)
    expect(books[0]).toMatchObject({ id: 'a/b0', popular: 0, tags: ['fiction'] })
    expect(books[129].popular).toBe(129)
    expect(requests.map((u) => u.searchParams.get('page') ?? '1').sort()).toEqual(['1', '2', '3'])
    expect(requests.every((u) => u.searchParams.get('per-page') === '48' && !u.search.includes('tags'))).toBe(true)
    // Kept as rows, not whole books.
    expect((store.map.get('index') as { value: unknown[] }).value[0]).toEqual(['a/b0', 'a/b0', '', null, null, 'fiction'])
    setStore(store)
    expect(await loadIndex(catalog(130).fetcher)).toHaveLength(130)
  })

  it('picks up where it stopped when a page fails, rather than fetching every page again', async () => {
    const { fetcher, requests } = catalog(200)
    let fail = true
    const flaky = vi.fn(async (input: RequestInfo | URL) => {
      // Page 3 fails every try, the first time round.
      if (fail && new URL(String(input)).searchParams.get('page') === '3') throw new TypeError('Failed to fetch')
      return fetcher(input)
    })
    vi.useFakeTimers()
    const first = loadIndex(flaky).catch((e) => e)
    await vi.runAllTimersAsync()
    expect(await first).toBeInstanceOf(Error)
    vi.useRealTimers()
    const before = requests.length
    fail = false
    expect(await loadIndex(flaky)).toHaveLength(200)
    // Only the page that failed is fetched again.
    expect(requests.slice(before).map((u) => u.searchParams.get('page'))).toEqual(['3'])
  })

  it('isn’t counted against the cap on what’s kept', async () => {
    const store = memoryStore()
    setStore(store)
    await store.set('index', { at: 0, value: [] })
    for (let k = 0; k < MAX_KEPT + 5; k++) await store.set(`k${k}`, { at: k + 1, value: k })
    await prune()
    expect(store.map.has('index')).toBe(true)
  })
})
