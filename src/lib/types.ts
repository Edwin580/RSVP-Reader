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
}

export interface BookMeta {
  id: string
  title: string
  fileName: string
  wordCount: number
  addedAt: number
}

export interface Progress {
  index: number
  updatedAt: number
}

/** A saved spot in a book: the start of the sentence that was showing. */
export interface Bookmark {
  index: number
  createdAt: number
}
