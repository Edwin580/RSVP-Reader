/** The page highlight's or the line's colour: 'auto' follows the focus colour. */
export type GuideColor = 'auto' | `#${string}`

/** A saved guide colour, or 'auto' for anything that isn't a plain six-digit hex. */
export function guideColor(value: unknown): GuideColor {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? (value.toLowerCase() as GuideColor) : 'auto'
}
