import { Fragment } from 'react'
import { paragraphsBetween } from '../lib/pages'
import type { PictureImage } from '../lib/types'

/** A book's pictures by the word they come before (see `Picture.at`). */
export type PicturesAt = Map<number, PictureImage[]>

/**
 * A picture from the book, as it's set in the text. Its size comes from its
 * stored width and height, not the image, so a page is measured rightly
 * before the picture has loaded.
 */
export function BookPicture({ image }: { image: PictureImage }) {
  return (
    <figure className="page-picture">
      <img
        src={image.src}
        alt={image.alt ?? ''}
        draggable={false}
        style={{
          aspectRatio: `${image.width} / ${image.height}`,
          // As wide as it is, the column, or the tallest a picture may be (--picture-max) allows.
          width: `min(100%, ${image.width}px, calc(var(--picture-max) * ${(image.width / image.height).toFixed(4)}))`,
        }}
      />
    </figure>
  )
}

/**
 * Words `from` to `to` as the page and the scrolling column set them: a
 * paragraph or heading at a time, a span per word, and the book's pictures
 * where they stand.
 */
export function pageText(
  words: string[],
  ends: Set<number>,
  headingStarts: Set<number>,
  from: number,
  to: number,
  pictures?: PicturesAt,
) {
  const figures = (at: number) => pictures?.get(at)?.map((image, k) => <BookPicture key={`picture-${at}-${k}`} image={image} />)
  return [
    ...paragraphsBetween(ends, from, to).map((para) => {
      const Tag = headingStarts.has(para[0]) ? 'h2' : 'p'
      return (
        <Fragment key={para[0]}>
          {figures(para[0])}
          <Tag className={Tag === 'h2' ? 'page-heading' : undefined}>
            {para.map((i) => (
              <Fragment key={i}>
                <span data-i={i}>{words[i]}</span>{' '}
              </Fragment>
            ))}
          </Tag>
        </Fragment>
      )
    }),
    // Pictures after the book's last word.
    ...(to === words.length - 1 ? (figures(words.length) ?? []) : []),
  ]
}
