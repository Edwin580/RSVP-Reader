import { describe, expect, it } from 'vitest'
import { readPages, type PageReader } from '../readPages'

/** A copy of a document whose pages take a moment to read, noting which it read. */
const copy = (read: number[], failAt?: number): PageReader<string> => async (n) => {
  await new Promise((done) => setTimeout(done, 1 + (n % 3)))
  if (n === failAt) throw new Error('worker died')
  read.push(n)
  return `page ${n}`
}
const expected = (count: number) => Array.from({ length: count }, (_, i) => `page ${i + 1}`)

describe('readPages', () => {
  it('reads every page in order with one copy', async () => {
    const read: number[] = []
    expect(await readPages(30, copy(read))).toEqual(expected(30))
    expect(read.sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
  })

  it('shares the pages with a second copy, each read once, still in order', async () => {
    const a: number[] = []
    const b: number[] = []
    expect(await readPages(60, copy(a), Promise.resolve(copy(b)))).toEqual(expected(60))
    expect(b.length).toBeGreaterThan(10)
    expect([...a, ...b].sort((x, y) => x - y)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1))
  })

  it('reads the second copy’s pages itself if that copy fails part way', async () => {
    const a: number[] = []
    const b: number[] = []
    expect(await readPages(60, copy(a), Promise.resolve(copy(b, 20)))).toEqual(expected(60))
  })

  it('reads everything itself if the second copy never opens', async () => {
    const a: number[] = []
    expect(await readPages(20, copy(a), Promise.reject(new Error('no worker')))).toEqual(expected(20))
    expect(a).toHaveLength(20)
  })

  it('reports progress up to the whole document', async () => {
    const seen: number[] = []
    await readPages(10, copy([]), Promise.resolve(copy([])), (f) => seen.push(f))
    expect(seen).toHaveLength(10)
    expect(seen[seen.length - 1]).toBe(1)
  })

  it('fails if the first copy can’t read a page', async () => {
    await expect(readPages(10, copy([], 5))).rejects.toThrow('worker died')
  })
})
