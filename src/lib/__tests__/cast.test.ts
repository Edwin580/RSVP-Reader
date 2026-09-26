import { describe, expect, it } from 'vitest'
import { castSoFar, joinCompoundNames } from '../cast'

const names = [
  { name: 'Maxim', indices: [3, 10, 20, 40] },
  { name: 'Manderley', indices: [5, 30] },
  { name: 'Favell', indices: [100, 120] },
]

describe('castSoFar', () => {
  it('only lists names met so far, counted up to the reading position', () => {
    expect(castSoFar(names, 25)).toEqual([
      { name: 'Maxim', count: 3, first: 3, latest: 20 },
      { name: 'Manderley', count: 1, first: 5, latest: 5 },
    ])
  })

  it('never includes someone who appears later (no spoilers)', () => {
    expect(castSoFar(names, 99).map((c) => c.name)).not.toContain('Favell')
    expect(castSoFar(names, 100).map((c) => c.name)).toContain('Favell')
  })

  it('limits the list, most mentioned first', () => {
    expect(castSoFar(names, 200, 1)).toEqual([{ name: 'Maxim', count: 4, first: 3, latest: 40 }])
  })
})

describe('joinCompoundNames', () => {
  it('joins names that almost always appear side by side', () => {
    const joined = joinCompoundNames([
      { name: 'Van', indices: [10, 50, 90] },
      { name: 'Hopper', indices: [11, 51, 91] },
      { name: 'Maxim', indices: [20, 60] },
    ])
    expect(joined).toEqual([
      { name: 'Van Hopper', indices: [10, 50, 90] },
      { name: 'Maxim', indices: [20, 60] },
    ])
  })

  it('keeps names apart when they only sometimes meet', () => {
    const names = [
      { name: 'Frank', indices: [10, 30, 70, 90] },
      { name: 'Crawley', indices: [11, 200] },
    ]
    expect(joinCompoundNames(names)).toEqual(names)
  })
})
