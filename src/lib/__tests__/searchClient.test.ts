import { describe, expect, it } from 'vitest'
import { BookSearch } from '../searchClient'

describe('BookSearch', () => {
  it('falls back to searching on the main thread when workers are unavailable', async () => {
    // The Node test environment has no Worker, which exercises the fallback path.
    const s = new BookSearch('id', 'One two, three. Two three!'.split(' '))
    expect(await s.query('two three')).toEqual({
      matches: [
        { start: 1, end: 2 },
        { start: 3, end: 4 },
      ],
      total: 2,
    })
    s.dispose()
  })
})
