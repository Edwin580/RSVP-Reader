import { describe, expect, it } from 'vitest'
import { Pagination } from '../pagination'

/** Ten words a page, counting from wherever the page starts, like a real layout. */
const tenAPage = () => {
  const measured: number[] = []
  const measure = (start: number, limit: number) => {
    measured.push(start)
    return Math.min(start + 9, limit)
  }
  return { measured, measure }
}

describe('Pagination', () => {
  it('splits each chapter into pages from its first word', () => {
    const { measure } = tenAPage()
    // Chapters at 0, 25 and 40; the book is 55 words.
    const p = new Pagination(55, [25, 40], measure)
    expect(p.pageAt(0)).toEqual({ start: 0, end: 9 })
    expect(p.pageAt(24)).toEqual({ start: 20, end: 24 }) // a short last page; chapter 2 starts fresh
    expect(p.pageAt(25)).toEqual({ start: 25, end: 34 })
    expect(p.pageAt(39)).toEqual({ start: 35, end: 39 })
    expect(p.pageAt(54)).toEqual({ start: 50, end: 54 })
  })

  it('gives the same page for a word however you get there', () => {
    const a = new Pagination(100, [], tenAPage().measure)
    const b = new Pagination(100, [], tenAPage().measure)
    // Straight to word 57, or paging through from the start.
    const jumped = a.pageAt(57)
    let paged = b.pageAt(0)
    while (paged.end < 57) paged = b.next(paged)!
    expect(jumped).toEqual(paged)
    expect(jumped).toEqual({ start: 50, end: 59 })
  })

  it('pages forward and back across chapters', () => {
    const p = new Pagination(55, [25, 40], tenAPage().measure)
    const first = p.pageAt(25)
    expect(p.previous(first)).toEqual({ start: 20, end: 24 })
    expect(p.next({ start: 20, end: 24 })).toEqual(first)
    expect(p.previous({ start: 0, end: 9 })).toBeNull()
    expect(p.next({ start: 50, end: 54 })).toBeNull()
  })

  it('only measures as far as needed, then the rest in the background', () => {
    const { measured, measure } = tenAPage()
    const p = new Pagination(100, [50], measure)
    p.pageAt(5)
    expect(measured).toEqual([0])
    expect(p.number({ start: 0, end: 9 })).toBeNull()

    // A little at a time: stop after two more pages.
    let budget = 2
    expect(p.work(() => budget-- <= 0)).toBe(false)
    expect(measured).toEqual([0, 10, 20])
    expect(p.work(() => false)).toBe(true)
    expect(p.complete).toBe(true)
    expect(p.number(p.pageAt(5))).toEqual({ page: 1, total: 10 })
    expect(p.number(p.pageAt(55))).toEqual({ page: 6, total: 10 })
  })

  it('always moves on, even if nothing fits', () => {
    const p = new Pagination(3, [], () => -1)
    expect(p.pageAt(0)).toEqual({ start: 0, end: 0 })
    expect(p.pageAt(2)).toEqual({ start: 2, end: 2 })
    expect(p.work(() => false)).toBe(true)
    expect(p.number({ start: 1, end: 1 })).toEqual({ page: 2, total: 3 })
  })
})
