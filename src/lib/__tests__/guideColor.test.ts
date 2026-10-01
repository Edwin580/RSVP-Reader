import { describe, expect, it } from 'vitest'
import { guideColor } from '../guideColor'

describe('guideColor', () => {
  it('keeps six-digit hex colours, lowercased', () => {
    expect(guideColor('#FFD60A')).toBe('#ffd60a')
    expect(guideColor('#2f6fdf')).toBe('#2f6fdf')
  })

  it('falls back to auto for anything else', () => {
    for (const value of [undefined, null, 'auto', 'red', '#fff', '#12345g', 'url(x)', '#ffd60a; color: red', 3]) {
      expect(guideColor(value)).toBe('auto')
    }
  })
})
