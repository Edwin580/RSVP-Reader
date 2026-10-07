// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_KEPT, RESULTS_MAX_AGE_MS, cached, loadResults, memoryStore, prune, setStore } from '../catalogStore'

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
  it('keeps only the most recent entries', async () => {
    const store = memoryStore()
    setStore(store)
    for (let k = 0; k < MAX_KEPT + 20; k++) await store.set(`k${k}`, { at: k, value: k })
    await prune()
    expect(store.map.size).toBe(MAX_KEPT)
    expect(store.map.has('k0')).toBe(false)
    expect(store.map.has(`k${MAX_KEPT + 19}`)).toBe(true)
  })
})

describe('loadResults', () => {
  it('fetches only the page asked for, and keeps it for a day', async () => {
    const store = memoryStore()
    setStore(store)
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => new Response(results([['a/b', ['fiction']]])))
    const page = await loadResults({ query: 'b' }, fetcher)
    expect(page.books.map((b) => b.id)).toEqual(['a/b'])
    expect(fetcher).toHaveBeenCalledTimes(1)
    setStore(store)
    await loadResults({ query: 'b' }, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [key, kept] = [...store.map.entries()][0] as [string, { at: number }]
    expect(key).toMatch(/^results:https:\/\/standardebooks\.org\/ebooks\?/)
    expect(Date.now() - kept.at).toBeLessThan(RESULTS_MAX_AGE_MS)
  })

  it('keeps to the subject, should the site ever ignore it', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => new Response(results([['a/b', ['fiction']], ['c/d', ['adventure', 'fiction']]])))
    const page = await loadResults({ subject: 'adventure' }, fetcher)
    expect(page.books.map((b) => b.id)).toEqual(['c/d'])
    expect(String(fetcher.mock.calls[0][0])).toContain('tags%5B%5D=adventure&tags%5B%5D=adventure')
  })
})
