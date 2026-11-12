/** Width of stored cover thumbnails; shelf covers are shown at ~56px, so this covers 3× screens. */
const THUMB_WIDTH = 180
/** Taller images are cropped to this aspect (height / width) rather than stored as a sliver. */
const MAX_ASPECT = 1.6

export interface ManifestItem {
  id: string
  href: string
  type: string
  properties: string
}

/**
 * The manifest item holding an EPUB's cover image: EPUB 3 marks it with
 * properties="cover-image", EPUB 2 names it in <meta name="cover">, and
 * failing both, an image whose id or file name says "cover" is a good bet.
 */
export function pickCoverItem(items: ManifestItem[], metaCoverId?: string | null): ManifestItem | undefined {
  const images = items.filter((i) => i.type.startsWith('image/'))
  return (
    images.find((i) => i.properties.split(/\s+/).includes('cover-image')) ??
    images.find((i) => metaCoverId && i.id === metaCoverId) ??
    images.find((i) => /cover/i.test(i.id) || /cover/i.test(i.href.split('/').pop() ?? ''))
  )
}

/**
 * The image on a book's cover page, as its address in the page: for EPUBs
 * that name no cover image, whose first page is the cover (an image and
 * little or no text). Undefined for a page that reads like text.
 */
export function coverPageImage(page: Document): string | undefined {
  const words = page.body?.textContent?.trim().split(/\s+/).filter(Boolean).length ?? 0
  if (words > 20) return undefined
  const image = page.querySelector('img[src], image')
  return image?.getAttribute('src') ?? image?.getAttribute('xlink:href') ?? image?.getAttribute('href') ?? undefined
}

/** A small JPEG data URL of an image, or undefined if it can't be decoded. */
export const thumbnail = async (image: Blob): Promise<string | undefined> => (await scaled(image, THUMB_WIDTH, MAX_ASPECT))?.src

/** Width of a stored picture from inside a book: sharp across a phone, light enough to keep a book's worth. */
const PICTURE_WIDTH = 900
/** Smaller than this either way is a spacer or a bullet, not a picture. */
const MIN_PICTURE = 24

/** A picture from inside a book, scaled for the screen, or undefined if it's too small to be one or can't be decoded. */
export async function picture(image: Blob): Promise<Scaled | undefined> {
  const scaledDown = await scaled(image, PICTURE_WIDTH)
  return scaledDown && Math.min(scaledDown.width, scaledDown.height) >= MIN_PICTURE ? scaledDown : undefined
}

interface Scaled {
  src: string
  width: number
  height: number
}

/** An image as a JPEG data URL no wider than `maxWidth`, cropped from the top if taller than `maxAspect` (height / width). */
async function scaled(image: Blob, maxWidth: number, maxAspect = Infinity): Promise<Scaled | undefined> {
  const draw = (source: CanvasImageSource, width: number, height: number) => {
    const canvas = drawScaled(source, width, height, maxWidth, maxAspect)
    return canvas && { src: canvas.toDataURL('image/jpeg', 0.82), width: canvas.width, height: canvas.height }
  }
  try {
    const bitmap = await createImageBitmap(image)
    const result = draw(bitmap, bitmap.width, bitmap.height)
    bitmap.close()
    return result
  } catch {
    // Not every browser decodes every image this way (an SVG, an older
    // Safari): an <img> reads anything the browser can show.
    const url = URL.createObjectURL(image)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return draw(img, img.naturalWidth, img.naturalHeight)
    } catch {
      return undefined
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/** Draw `source` into a canvas no wider than `maxWidth` (cropping very tall images from the top), on white: a JPEG has no see-through. */
export function drawScaled(source: CanvasImageSource, width: number, height: number, maxWidth = THUMB_WIDTH, maxAspect = MAX_ASPECT): HTMLCanvasElement | undefined {
  if (!width || !height) return undefined
  const scale = Math.min(1, maxWidth / width)
  const kept = Math.min(height, width * maxAspect)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(kept * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.fillStyle = 'white' // ui-allow: the paper a picture with a clear background was drawn for
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, 0, 0, width, kept, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Target width for rendering a PDF's first page as its cover. */
export const COVER_RENDER_WIDTH = THUMB_WIDTH
