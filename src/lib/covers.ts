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
export async function thumbnail(image: Blob): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(image)
    const canvas = drawScaled(bitmap, bitmap.width, bitmap.height)
    bitmap.close()
    return canvas?.toDataURL('image/jpeg', 0.82)
  } catch {
    // Not every browser decodes every image this way (an SVG cover, an older
    // Safari): an <img> reads anything the browser can show.
    return viaImage(image)
  }
}

async function viaImage(image: Blob): Promise<string | undefined> {
  const url = URL.createObjectURL(image)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return drawScaled(img, img.naturalWidth, img.naturalHeight)?.toDataURL('image/jpeg', 0.82)
  } catch {
    return undefined
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Draw `source` into a thumbnail-sized canvas (cropping very tall images from the top). */
export function drawScaled(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement | undefined {
  if (!width || !height) return undefined
  const scale = Math.min(1, THUMB_WIDTH / width)
  const w = Math.round(width * scale)
  const h = Math.round(Math.min(height, width * MAX_ASPECT) * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.drawImage(source, 0, 0, width, Math.min(height, width * MAX_ASPECT), 0, 0, w, h)
  return canvas
}

/** Target width for rendering a PDF's first page as its cover. */
export const COVER_RENDER_WIDTH = THUMB_WIDTH
