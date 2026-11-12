import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '../types'

// IndexedDB stood in for by a map. As in the real thing, every read and write
// takes a moment, and only `update` reads and writes in one step.
const { kv, tick } = vi.hoisted(() => ({ kv: new Map<string, unknown>(), tick: () => new Promise<void>((done) => setTimeout(done, 0)) }))
vi.mock('idb-keyval', () => ({
  createStore: () => ({}),
  get: async (key: string) => (await tick(), kv.get(key)),
  set: async (key: string, value: unknown) => (await tick(), void kv.set(key, value)),
  del: async (key: string) => (await tick(), void kv.delete(key)),
  update: async (key: string, change: (value: unknown) => unknown) => (await tick(), void kv.set(key, change(kv.get(key)))),
  entries: async () => [...kv.entries()],
  setMany: async (writes: [string, unknown][]) => writes.forEach(([k, v]) => kv.set(k, v)),
}))

const { deleteBook, listBooks, saveBook, setRead } = await import('../storage')

const book = (id: string, cover?: string): Book => ({ id, title: id, words: ['one', 'two'], paragraphEnds: [], chapters: [], ...(cover && { cover }) })

beforeEach(() => kv.clear())

describe('the library list', () => {
  it('keeps a book\'s cover when it\'s added again and no cover is found', async () => {
    await saveBook(book('a', 'data:image/jpeg;base64,AAAA'), 'a.epub')
    await saveBook(book('a'), 'a.epub')
    expect((await listBooks())[0].cover).toBe('data:image/jpeg;base64,AAAA')
  })

  it('takes a new cover over the old one', async () => {
    await saveBook(book('a', 'old'), 'a.epub')
    await saveBook(book('a', 'new'), 'a.epub')
    expect((await listBooks())[0].cover).toBe('new')
  })

  it('loses nothing when changes land at the same time', async () => {
    await saveBook(book('a', 'cover-a'), 'a.epub')
    await Promise.all([saveBook(book('b', 'cover-b'), 'b.epub'), setRead('a', true), saveBook(book('c'), 'c.txt')])
    const library = await listBooks()
    expect(library.map((b) => b.id).sort()).toEqual(['a', 'b', 'c'])
    expect(library.find((b) => b.id === 'a')).toMatchObject({ cover: 'cover-a', readAt: expect.any(Number) })
    await Promise.all([deleteBook('c'), setRead('a', false)])
    expect((await listBooks()).map((b) => [b.id, b.readAt]).sort()).toEqual([['a', undefined], ['b', undefined]])
  })
})
