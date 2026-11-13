export interface Chapter {
  title: string
  /** Index of the first word of this chapter. */
  start: number
}

/** A parsed, ready-to-read document. */
export interface Book {
  id: string
  title: string
  words: string[]
  /** Indices of words that end a paragraph (used for longer pauses). */
  paragraphEnds: number[]
  chapters: Chapter[]
  /** Word ranges (inclusive) that are chapter or section headings. Absent in books saved before headings were detected. */
  headings?: { start: number; end: number }[]
  /** Cover thumbnail (data URL) found while parsing; saved with the library entry, not the book. */
  cover?: string
  /** Where the book's pictures go. Absent in books without any, or saved before pictures were kept. */
  pictures?: Picture[]
  /** The pictures themselves, by `Picture.id`; saved beside the book, not in it, so the book stays light. */
  images?: PictureImage[]
}

/** A picture in the text (an illustration, a map), shown before the paragraph that starts at word `at`. */
export interface Picture {
  /** The first word of the paragraph after it (the book's length for one at the very end). */
  at: number
  /** Its place in the book's `images`. */
  id: number
}

export interface PictureImage {
  /** A data URL, scaled down to suit a screen. */
  src: string
  width: number
  height: number
  alt?: string
}

export interface BookMeta {
  id: string
  title: string
  fileName: string
  wordCount: number
  addedAt: number
  /** Cover thumbnail as a data URL, for EPUBs with a cover image and PDFs (first page). */
  cover?: string
  /** When the reader marked it as read, so it's on the Read shelf wherever they stopped. */
  readAt?: number
}

export interface Progress {
  index: number
  updatedAt: number
}

/** A saved spot in a book: the start of the sentence that was showing. */
export interface Bookmark {
  /** First word: the start of a sentence, or of a highlight. */
  index: number
  createdAt: number
  /** A highlight: the last word of the text picked out. Plain bookmarks have none. */
  end?: number
}
