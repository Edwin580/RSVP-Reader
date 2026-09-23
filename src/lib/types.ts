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
