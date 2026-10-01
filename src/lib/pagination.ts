/**
 * The book's pages, like an e-reader: every chapter is split into pages
 * from its first word, so a word is always on the same page however you got
 * there (reading on, paging back, or jumping), and pages can be numbered.
 *
 * Pages are found by `measure(start, limit)`, which lays out text from
 * `start` and returns the last word that fits on the page (never past
 * `limit`, the end of the chapter). Chapters are paginated as far as needed
 * to show a word; `work` paginates the rest a little at a time, so the page
 * count and numbers become known shortly after opening.
 */
export interface Page {
  start: number
  end: number
}

export class Pagination {
  /** First word of each section: the book's opening and every chapter. */
  private readonly sections: number[]
  /** Page starts found so far in each section, in order from its first word. */
  private readonly starts: number[][]
  private readonly done: boolean[]
  private readonly ends = new Map<number, number>()
  private readonly length: number
  private readonly measure: (start: number, limit: number) => number

  constructor(length: number, chapterStarts: number[], measure: (start: number, limit: number) => number) {
    this.length = length
    this.measure = measure
    this.sections = [...new Set([0, ...chapterStarts.filter((s) => s > 0 && s < length)])].sort((a, b) => a - b)
    this.starts = this.sections.map(() => [])
    this.done = this.sections.map(() => length === 0)
  }

  /** The page that shows word `index`. */
  pageAt(index: number): Page {
    const i = Math.min(Math.max(index, 0), Math.max(this.length - 1, 0))
    const k = this.sectionOf(i)
    const starts = this.starts[k]
    for (;;) {
      // Pages are found in order, so the last start at or before `i` is the candidate.
      let lo = 0
      let hi = starts.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (starts[mid] <= i) {
          found = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      if (found !== -1) {
        const start = starts[found]
        const end = this.ends.get(start)!
        if (end >= i) return { start, end }
      }
      if (!this.extend(k)) return { start: i, end: i } // can't happen with a sane measure
    }
  }

  /** The page after `page`, or null at the end of the book. */
  next(page: Page): Page | null {
    return page.end + 1 < this.length ? this.pageAt(page.end + 1) : null
  }

  /** The page before `page`, or null on the first page. */
  previous(page: Page): Page | null {
    return page.start > 0 ? this.pageAt(page.start - 1) : null
  }

  /** Whether every page in the book has been found. */
  get complete(): boolean {
    return this.done.every(Boolean)
  }

  /** Page `page` of `total`, counted through the whole book; null until every page is known. */
  number(page: Page): { page: number; total: number } | null {
    if (!this.complete) return null
    const k = this.sectionOf(page.start)
    const before = this.starts.slice(0, k).reduce((sum, s) => sum + s.length, 0)
    const total = this.starts.reduce((sum, s) => sum + s.length, 0)
    return { page: before + this.starts[k].indexOf(page.start) + 1, total }
  }

  /** Find more pages until `stop()` says to, or until all are known. Returns `complete`. */
  work(stop: () => boolean): boolean {
    for (let k = 0; k < this.sections.length; k++) {
      while (!this.done[k]) {
        if (stop()) return false
        this.extend(k)
      }
    }
    return true
  }

  private sectionOf(index: number): number {
    let lo = 0
    let hi = this.sections.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.sections[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Measure the next page of section `k`; false if it has no more. */
  private extend(k: number): boolean {
    if (this.done[k]) return false
    const starts = this.starts[k]
    const limit = (this.sections[k + 1] ?? this.length) - 1
    const start = starts.length ? this.ends.get(starts[starts.length - 1])! + 1 : this.sections[k]
    if (start > limit) {
      this.done[k] = true
      return false
    }
    // At least one word per page, never past the chapter.
    const end = Math.min(Math.max(this.measure(start, limit), start), limit)
    starts.push(start)
    this.ends.set(start, end)
    if (end >= limit) this.done[k] = true
    return true
  }
}
