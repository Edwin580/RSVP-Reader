// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INDEX_MAX_AGE_MS, INDEX_VERSION } from '../catalogIndex'
import { cached, crawl, ensureIndex, ensureNewest, indexState, memoryStore, setStore, subscribe } from '../catalogStore'

/** A list page in the catalog's markup: books `from`…`to`, page `page` of `last`. */
function listPage(page: number, last: number, ids: string[]) {
  const items = ids
    .map(
      (id) => `<li typeof="schema:Book" about="/ebooks/${id}"><p><a href="/ebooks/${id}"><span property="schema:name">${id}</span></a></p>
      <p class="author"><a href="/ebooks/x">X</a></p><div class="details"><p>1,000 words • 70 reading ease</p>
      <ul class="tags"><li><a href="/subjects/fiction">Fiction</a></li></ul></div></li>`,
    )
    .join('')
  const links = Array.from({ length: last }, (_, k) => `<li><a href="/ebooks?page=${k + 1}&amp;sort=popularity&amp;view=list">${k + 1}</a></li>`).join('')
  const next = page < last ? `<a href="/ebooks?page=${page + 1}" rel="next">Next</a>` : '<a aria-disabled="true">Next</a>'
  return `<ol>${items}</ol><nav class="pagination"><ol>${links}</ol>${next}</nav>`
}

/** A catalog of `count` books, 48 a page, popular order a/0, a/1…; newest order reversed. */
function fakeCatalog(count: number) {
  const ids = Array.from({ length: count }, (_, k) => `a/b${k}`)
  const last = Math.ceil(count / 48)
  const requests: URL[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    requests.push(url)
    const order = url.searchParams.get('sort') === 'newest' ? [...ids].reverse() : ids
    const page = Number(url.searchParams.get('page') ?? 1)
    return new Response(listPage(page, last, order.slice((page - 1) * 48, page * 48)))
  })
  return { fetcher, requests }
}

beforeEach(() => setStore(memoryStore()))

describe('crawl', () => {
  it('fetches every page, a few at a time, reporting each as it arrives', async () => {
    const { fetcher, requests } = fakeCatalog(200)
    const progress: [number, number, number][] = []
    const books = await crawl('popularity', (books, loaded, total) => progress.push([books.length, loaded, total]), fetcher)
    expect(books).toHaveLength(200)
    expect(books.map((b) => b.rank)).toEqual(Array.from({ length: 200 }, (_, k) => k))
    expect(requests.map((u) => u.searchParams.get('page') ?? '1').sort()).toEqual(['1', '2', '3', '4', '5'])
    expect(progress[0]).toEqual([48, 1, 5])
    expect(progress.at(-1)).toEqual([200, 5, 5])
    // Never filtered on the site.
    expect(requests.every((u) => !u.search.includes('tags'))).toBe(true)
  })

  it('tries a page again when it fails, so one bad moment doesn’t stop the catalog', async () => {
    const { fetcher } = fakeCatalog(150)
    let failures = 2
    const flaky = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('page=2') && failures-- > 0 ? new Response('', { status: 503 }) : fetcher(input),
    )
    expect(await crawl('popularity', undefined, flaky)).toHaveLength(150)
  })

  it('fails if a page can’t be had, after what arrived was reported', async () => {
    const { fetcher } = fakeCatalog(150)
    const failing = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('page=3') ? new Response('', { status: 500 }) : fetcher(input),
    )
    const seen: number[] = []
    await expect(crawl('popularity', (books) => seen.push(books.length), failing)).rejects.toThrow(/500/)
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(48)
  })
})

describe('the index', () => {
  it('is fetched the first time, filling in as it comes, then kept', async () => {
    const store = memoryStore()
    setStore(store)
    const { fetcher } = fakeCatalog(100)
    const sizes: number[] = []
    const stop = subscribe(() => sizes.push(indexState().books.length))
    const promise = ensureIndex(fetcher)
    expect(indexState().status).toBe('loading')
    await promise
    stop()
    expect(indexState().status).toBe('ready')
    expect(indexState().books).toHaveLength(100)
    expect(indexState().books[0]).toMatchObject({ id: 'a/b0', popular: 0, tags: ['fiction'] })
    expect(sizes.some((n) => n > 0 && n < 100)).toBe(true)
    expect(store.map.get('index')).toMatchObject({ version: INDEX_VERSION, hasNewest: false })
  })

  it('opens from what’s kept without fetching, while it’s fresh', async () => {
    const store = memoryStore()
    setStore(store)
    await ensureIndex(fakeCatalog(60).fetcher)
    setStore(store) // as if the app were opened again
    const again = fakeCatalog(60)
    await ensureIndex(again.fetcher)
    expect(indexState().books).toHaveLength(60)
    expect(again.requests).toHaveLength(0)
  })

  it('shows what’s kept at once when it’s old, and refreshes it in the background', async () => {
    const store = memoryStore()
    setStore(store)
    await ensureIndex(fakeCatalog(60).fetcher)
    setStore(store)
    const newer = fakeCatalog(70)
    await ensureIndex(newer.fetcher, Date.now() + INDEX_MAX_AGE_MS + 1)
    expect(indexState().books).toHaveLength(60)
    await vi.waitFor(() => expect(indexState().books).toHaveLength(70))
    expect(newer.requests.length).toBeGreaterThan(0)
  })

  it('fetches the newest-first order only when asked, and keeps it', async () => {
    const store = memoryStore()
    setStore(store)
    const { fetcher, requests } = fakeCatalog(100)
    await ensureIndex(fetcher)
    expect(requests.some((u) => u.searchParams.get('sort') === 'newest')).toBe(false)
    await ensureNewest(fetcher)
    expect(indexState().newest).toBe('ready')
    expect(indexState().books.find((b) => b.id === 'a/b99')?.newest).toBe(0)
    expect(store.map.get('index')).toMatchObject({ hasNewest: true })
  })
})

describe('cached', () => {
  it('loads once, then answers from memory and from storage', async () => {
    const store = memoryStore()
    setStore(store)
    const load = vi.fn(async () => 'page')
    expect(await cached('k', load)).toBe('page')
    expect(await cached('k', load)).toBe('page')
    setStore(store) // memory gone, storage kept
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
