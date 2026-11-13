import { describe, expect, it } from 'vitest'
import { backupFileName, createBackup, mergeBackup, parseBackup, restoreSummary } from '../backup'

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

  it('gives a book here the backup\'s cover when it has none, and keeps its own otherwise', () => {
    const current = new Map<string, unknown>([['library', [meta('a'), { ...meta('b'), cover: 'mine' }]]])
    const backup = createBackup([['library', [{ ...meta('a'), cover: 'theirs' }, { ...meta('b'), cover: 'theirs' }]]])
    const library = new Map(mergeBackup(current, backup).writes).get('library') as { cover?: string }[]
    expect(library.map((b) => b.cover)).toEqual(['theirs', 'mine'])
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

describe('mergeBackup, bookmarks and statistics', () => {
  it('keeps bookmarks from both, in reading order', () => {
    const current = new Map<string, unknown>([['bookmarks:a', [{ index: 50, createdAt: 2 }]]])
    const backup = createBackup([
      ['bookmarks:a', [{ index: 10, createdAt: 1 }, { index: 50, createdAt: 9 }]],
      ['bookmarks:b', [{ index: 7, createdAt: 1 }]],
    ])
    const out = new Map(mergeBackup(current, backup).writes)
    expect(out.get('bookmarks:a')).toEqual([{ index: 10, createdAt: 1 }, { index: 50, createdAt: 2 }])
    expect(out.get('bookmarks:b')).toEqual([{ index: 7, createdAt: 1 }])
  })

  it('keeps the longer reading for each day, and never adds a day twice', () => {
    const current = new Map<string, unknown>([
      ['stats', { days: { '2026-01-01': { ms: 600, words: 30 }, '2026-01-02': { ms: 100, words: 5 } } }],
    ])
    const backup = createBackup([
      ['stats', { days: { '2026-01-02': { ms: 900, words: 40 }, '2026-01-03': { ms: 50, words: 2 } } }],
    ])
    const { writes } = mergeBackup(current, backup)
    const merged = new Map(writes).get('stats')
    expect(merged).toEqual({
      days: { '2026-01-01': { ms: 600, words: 30 }, '2026-01-02': { ms: 900, words: 40 }, '2026-01-03': { ms: 50, words: 2 } },
    })
    // Restoring the same backup again changes nothing.
    expect(mergeBackup(new Map([['stats', merged]]), backup).writes).toEqual([])
  })

  it('keeps a book marked as read on either device', () => {
    const current = new Map<string, unknown>([['library', [meta('a', 5)]]])
    const backup = createBackup([['library', [{ ...meta('a', 5), readAt: 77 }]]])
    expect(new Map(mergeBackup(current, backup).writes).get('library')).toEqual([{ ...meta('a', 5), readAt: 77 }])
  })
})

describe('restoreSummary', () => {
  it('says what changed', () => {
    expect(restoreSummary(2, 0)).toBe('Restored 2 books.')
    expect(restoreSummary(1, 3)).toBe('Restored 1 book and updated 3 reading positions.')
    expect(restoreSummary(0, 1)).toBe('Updated 1 reading position from the backup.')
    expect(restoreSummary(0, 0)).toBe('Everything in this backup is already here.')
  })

  it('counts reading positions moved forward for books already here', () => {
    const current = new Map<string, unknown>([['progress:a', { index: 1, updatedAt: 1 }]])
    const backup = createBackup([
      ['progress:a', { index: 9, updatedAt: 5 }],
      ['progress:b', { index: 2, updatedAt: 5 }],
    ])
    expect(mergeBackup(current, backup).updated).toBe(1)
  })
})

describe('backupFileName', () => {
  it('uses the local date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 30))).toBe('chapter-backup-2026-01-05.json')
  })
})
