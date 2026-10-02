import { describe, expect, it } from 'vitest'
import { atEnd, fractionRead, isRead, readToEnd } from './shelf'
import type { BookMeta } from './types'

const book = (extra: Partial<BookMeta> = {}): BookMeta => ({
  id: 'b',
  title: 'Book',
  fileName: 'book.txt',
  wordCount: 1001,
  addedAt: 0,
  ...extra,
})
const at = (index: number) => ({ index, updatedAt: 0 })

describe('shelf', () => {
  it('measures how far through a book the reader is', () => {
    expect(fractionRead(book(), undefined)).toBe(0)
    expect(fractionRead(book(), at(500))).toBe(0.5)
    expect(fractionRead(book(), at(1000))).toBe(1)
    expect(fractionRead(book({ wordCount: 1 }), at(0))).toBe(0)
  })

  it('counts a book as read to the end once it shows 100%', () => {
    expect(readToEnd(book(), at(994))).toBe(false)
    expect(readToEnd(book(), at(995))).toBe(true)
    expect(readToEnd(book(), at(1000))).toBe(true)
    expect(atEnd(1001, 994)).toBe(false)
    expect(atEnd(1001, 995)).toBe(true)
  })

  it('puts a book on the Read shelf when finished or marked as read', () => {
    expect(isRead(book(), at(10))).toBe(false)
    expect(isRead(book(), at(1000))).toBe(true)
    expect(isRead(book({ readAt: 5 }), at(10))).toBe(true)
    expect(isRead(book({ readAt: 5 }), undefined)).toBe(true)
  })
})
