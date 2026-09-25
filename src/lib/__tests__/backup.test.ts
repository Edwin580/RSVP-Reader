import { describe, expect, it } from 'vitest'
import { createBackup, mergeBackup, parseBackup } from '../backup'

const meta = (id: string, addedAt = 1) => ({ id, title: id, fileName: `${id}.txt`, wordCount: 10, addedAt })

describe('parseBackup', () => {
  it('round-trips a backup', () => {
    const backup = createBackup([['library', [meta('a')]], ['book:a', { id: 'a' }]], 5)
    expect(parseBackup(JSON.stringify(backup))).toEqual(backup)
  })

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('not json')).toThrow(/isn’t a backup/)
    expect(() => parseBackup('{"entries":[]}')).toThrow(/isn’t a backup/)
    expect(() => parseBackup(JSON.stringify({ ...createBackup([]), version: 2 }))).toThrow(/newer version/)
  })
})

describe('mergeBackup', () => {
  it('restores everything into an empty library', () => {
    const backup = createBackup([
      ['library', [meta('a'), meta('b')]],
      ['book:a', { id: 'a' }],
      ['progress:a', { index: 40, updatedAt: 10 }],
    ])
    const { writes, added } = mergeBackup(new Map(), backup)
    expect(added).toBe(2)
    expect(new Map(writes)).toEqual(new Map(backup.entries))
  })

  it('adds missing books without dropping the ones already here', () => {
    const current = new Map<string, unknown>([
      ['library', [meta('a', 5)]],
      ['book:a', { id: 'a', mine: true }],
    ])
    const backup = createBackup([
      ['library', [meta('b'), meta('a', 2)]],
      ['book:a', { id: 'a' }],
      ['book:b', { id: 'b' }],
    ])
    const { writes, added } = mergeBackup(current, backup)
    const out = new Map(writes)
    expect(added).toBe(1)
    expect(out.get('library')).toEqual([meta('a', 2), meta('b')])
    expect(out.has('book:a')).toBe(false) // already stored, left alone
    expect(out.get('book:b')).toEqual({ id: 'b' })
  })

  it('keeps whichever reading position was updated last', () => {
    const current = new Map<string, unknown>([
      ['progress:a', { index: 100, updatedAt: 20 }],
      ['progress:b', { index: 5, updatedAt: 1 }],
    ])
    const backup = createBackup([
      ['progress:a', { index: 50, updatedAt: 10 }],
      ['progress:b', { index: 80, updatedAt: 30 }],
    ])
    const out = new Map(mergeBackup(current, backup).writes)
    expect(out.has('progress:a')).toBe(false)
    expect(out.get('progress:b')).toEqual({ index: 80, updatedAt: 30 })
  })
})
