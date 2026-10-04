/** Reads one page (1-based) from a copy of a document. */
export type PageReader<T> = (n: number) => Promise<T>

/** Pages asked for at once from each reader, so its worker is never left waiting. */
const PAGES_IN_FLIGHT = 4

/**
 * Every page of a document, in order, read by `first` and, once it's ready,
 * `second` (a second copy of the document in its own worker), each taking
 * the next page left. If the second copy fails, the first reads its pages.
 */
export async function readPages<T>(
  count: number,
  first: PageReader<T>,
  second?: Promise<PageReader<T>>,
  onProgress?: (fraction: number) => void,
): Promise<T[]> {
  const pages: T[] = new Array(count)
  const left = Array.from({ length: count }, (_, i) => i + 1)
  let done = 0
  const take = async (read: PageReader<T>, fallible: boolean) => {
    for (let n = left.shift(); n !== undefined; n = left.shift()) {
      try {
        pages[n - 1] = await read(n)
      } catch (error) {
        if (!fallible) throw error
        left.push(n)
        return
      }
      onProgress?.(++done / count)
    }
  }
  const readers = (read: PageReader<T>, fallible: boolean) =>
    Array.from({ length: PAGES_IN_FLIGHT }, () => take(read, fallible))
  await Promise.all([
    ...readers(first, false),
    second?.then((read) => Promise.all(readers(read, true))).catch(() => {}),
  ])
  // Pages the second copy handed back after the first had finished.
  await Promise.all(readers(first, false))
  return pages
}
