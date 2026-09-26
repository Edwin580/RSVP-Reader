import { findNames, type NameInfo } from './names'
import { smartExtras } from './pacing'

/**
 * What Chapter works out about a book's text: its people and places, and the
 * extra time smart pacing gives each word. Computed in the search worker
 * (it already has the words) so opening a book never waits for it.
 */
export interface BookAnalysis {
  names: NameInfo[]
  /** For each word, the index into `names`, or -1. */
  nameOf: Int32Array
  /** Smart pacing's extra weight per word. */
  extras: Float32Array
}

export function analyzeBook(words: string[]): BookAnalysis {
  const found = findNames(words)
  return { names: found.names, nameOf: found.nameOf, extras: smartExtras(words, found) }
}
