import { describe, expect, it } from 'vitest'
import { findNames } from '../names'
import { DIALOGUE, EARLY_MENTION, FIRST_MENTION, NUMBER, RARE_WORD, smartExtras } from '../pacing'

const text =
  'Maxim came home. We walked to Manderley with Maxim, and Maxim smiled. ' +
  'I told Mrs Danvers that Manderley was cold. Then Danvers left. ' +
  'The house was quiet. She said the house was old.'
const words = text.split(' ')

describe('findNames', () => {
  it('finds words capitalised mid-sentence, in order of first appearance', () => {
    const { names } = findNames(words)
    expect(names.map((n) => n.name)).toEqual(['Maxim', 'Manderley', 'Danvers'])
    expect(names[0].indices).toEqual([0, 8, 10])
  })

  it('ignores sentence starts, pronouns, titles and words that also appear lowercase', () => {
    const { names } = findNames(words)
    const found = names.map((n) => n.name)
    for (const w of ['The', 'She', 'Then', 'I', 'Mrs', 'We']) expect(found).not.toContain(w)
  })

  it('maps each word to its name', () => {
    const { nameOf } = findNames(words)
    expect(nameOf[0]).toBe(0) // Maxim
    expect(nameOf[1]).toBe(-1) // came
  })
})

describe('smartExtras', () => {
  it('gives new names, rare words, numbers and dialogue a little more time', () => {
    const w = 'Maxim met Maxim and Maxim and Maxim at 10 near extraordinary “Hello there'.split(' ')
    const extras = smartExtras(w, findNames([...w, 'then', 'we', 'saw', 'Maxim']))
    expect(extras[0]).toBeCloseTo(FIRST_MENTION)
    expect(extras[2]).toBeCloseTo(EARLY_MENTION)
    expect(extras[4]).toBeCloseTo(EARLY_MENTION)
    expect(extras[6]).toBe(0) // fourth mention: familiar now
    expect(extras[8]).toBeCloseTo(NUMBER)
    expect(extras[10]).toBeCloseTo(RARE_WORD)
    expect(extras[11]).toBeCloseTo(DIALOGUE)
    expect(extras[1]).toBe(0)
  })
})
