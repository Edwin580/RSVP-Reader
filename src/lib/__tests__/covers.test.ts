// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { coverPageImage, pickCoverItem, type ManifestItem } from '../covers'

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

describe('coverPageImage', () => {
  const page = (body: string) => new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html')

  it('finds the picture on a cover page, as an image or inside an SVG', () => {
    expect(coverPageImage(page('<div><img src="../images/front.jpg" alt="Cover"/></div>'))).toBe('../images/front.jpg')
    expect(coverPageImage(page('<svg><image xlink:href="front.png"/></svg>'))).toBe('front.png')
  })

  it('leaves a page of text alone, even with a picture in it', () => {
    const text = 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief.'
    expect(coverPageImage(page(`<img src="map.jpg"/><p>${text}</p>`))).toBeUndefined()
    expect(coverPageImage(page('<h1>Title</h1>'))).toBeUndefined()
  })
})
