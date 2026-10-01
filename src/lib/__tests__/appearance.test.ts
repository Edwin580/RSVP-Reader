import { describe, expect, it } from 'vitest'
import { toHex } from '../appearance'

describe('toHex', () => {
  it('turns resolved colours into #rrggbb for theme-color', () => {
    expect(toHex('rgb(251, 250, 247)')).toBe('#fbfaf7')
    expect(toHex('rgba(18, 18, 17, 1)')).toBe('#121211')
    expect(toHex('color(srgb 0.708 0.705 0.6984)')).toBe('#b5b4b2')
    expect(toHex('color(srgb 1 0 0.5 / 0.5)')).toBe('#ff0080')
  })

  it('leaves anything else alone', () => {
    expect(toHex('red')).toBe('red')
  })
})
