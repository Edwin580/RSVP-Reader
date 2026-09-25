import { describe, expect, it } from 'vitest'
import { pickCoverItem, type ManifestItem } from '../covers'

const item = (id: string, href: string, type = 'image/jpeg', properties = ''): ManifestItem => ({ id, href, type, properties })

describe('pickCoverItem', () => {
  const images = [item('img1', 'images/map.jpg'), item('front', 'images/front.jpg'), item('ch1', 'ch1.xhtml', 'application/xhtml+xml')]

  it('prefers the EPUB 3 cover-image property', () => {
    const items = [...images, item('c', 'images/c.png', 'image/png', 'cover-image')]
    expect(pickCoverItem(items, 'front')?.id).toBe('c')
  })

  it('uses the EPUB 2 <meta name="cover"> id', () => {
    expect(pickCoverItem(images, 'front')?.id).toBe('front')
  })

  it('falls back to an image named like a cover', () => {
    expect(pickCoverItem([...images, item('x', 'Images/Cover.jpeg')])?.id).toBe('x')
  })

  it('never picks a non-image or guesses when nothing looks like a cover', () => {
    expect(pickCoverItem([item('cover', 'cover.xhtml', 'application/xhtml+xml')])).toBeUndefined()
    expect(pickCoverItem(images)).toBeUndefined()
  })
})
