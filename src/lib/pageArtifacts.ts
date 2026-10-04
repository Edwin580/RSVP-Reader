import type { Section } from './text'

/**
 * Books converted from print (scanned or exported PDFs, EPUBs made from them)
 * often carry the printed page into the text: page numbers, running headers
 * ("THE FIVE PEOPLE YOU MEET IN HEAVEN"), and paragraphs broken where the
 * page ended. This takes them back out.
 */

/** A paragraph that's only a page number: "18", "- 18 -", "Page 18". */
const PAGE_NUMBER = /^(?:page\s+)?[-–—]?\s*(\d{1,4})\s*[-–—]?$/i
/** A page number stuck to the end or start of a paragraph. */
const TRAILING_NUMBER = /^(.*\p{L}[,;:—–-]?)\s+(\d{1,4})$/su
const LEADING_NUMBER = /^(\d{1,4})\s+(\p{Ll}.*)$/su
/** Ends like a finished sentence (or a quote that finishes one). */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/u
/** Stops mid-sentence: on a word, a comma or a dash (not a bracketed caption, say). */
const CUT_OFF = /[\p{L}\p{N},;:—–-]$/u
/** Page numbers further apart than this (pages without one, like chapter openings) don't count as a run. */
const MAX_PAGE_GAP = 8
/** A short unpunctuated line seen at least this often is a running header. */
const MIN_HEADER_REPEATS = 3
const MAX_HEADER_WORDS = 10

interface Para {
  text: string
  heading: boolean
  /** First paragraph of its section, where a bare number is a chapter number, not a page's. */
  first: boolean
}

interface Candidate {
  section: number
  index: number
  value: number
  kind: 'alone' | 'end' | 'start'
  /** A bare number opening a section, which could be a chapter number. */
  opening: boolean
}

export function removePageArtifacts(sections: Section[]): Section[] {
  const paras = sections.map((s) => {
    const headings = new Set(s.headings)
    return s.paragraphs.map((text, i): Para => ({ text, heading: headings.has(i), first: i === 0 }))
  })
  stripPageNumbers(paras)
  stripRunningHeaders(paras)
  return sections.map((section, s) => {
    const joined = joinBrokenParagraphs(paras[s].filter((p) => p.text))
    const headings = joined.flatMap((p, i) => (p.heading ? [i] : []))
    return {
      ...section,
      paragraphs: joined.map((p) => p.text),
      ...(section.headings && { headings }),
    }
  })
}

/** Remove numbers that run in sequence like page numbers do, leaving other numbers alone. */
function stripPageNumbers(paras: Para[][]) {
  const candidates: Candidate[] = []
  paras.forEach((list, section) =>
    list.forEach((p, index) => {
      if (p.heading) return
      const opening = p.first
      const alone = p.text.match(PAGE_NUMBER)
      const end = !alone && p.text.match(TRAILING_NUMBER)
      const start = !alone && !end && p.text.match(LEADING_NUMBER)
      if (alone) candidates.push({ section, index, value: Number(alone[1]), kind: 'alone', opening })
      else if (end && !SENTENCE_END.test(end[1])) candidates.push({ section, index, value: Number(end[2]), kind: 'end', opening: false })
      else if (start) candidates.push({ section, index, value: Number(start[1]), kind: 'start', opening: false })
    }),
  )
  // A page number has a neighbouring candidate a page or a few on either side.
  // Numbers opening sections run in sequence too when they're chapter
  // numbers, so for those the neighbour has to be from inside a section.
  const fits = (a: Candidate | undefined, b: Candidate | undefined) =>
    !!a && !!b && !(a.opening && b.opening) && b.value > a.value && b.value - a.value <= MAX_PAGE_GAP
  const pages = candidates.filter(
    (c, k) => [1, 2, 3].some((d) => fits(candidates[k - d], c) || fits(c, candidates[k + d])),
  )
  // A couple of coincidences aren't a book's page numbers.
  if (pages.length < 3) return
  for (const c of pages) {
    const p = paras[c.section][c.index]
    if (c.kind === 'alone') p.text = ''
    else if (c.kind === 'end') p.text = p.text.match(TRAILING_NUMBER)![1]
    else p.text = p.text.match(LEADING_NUMBER)![2]
  }
}

/**
 * Remove short unpunctuated lines that keep repeating and often cut into a
 * sentence: a page's running header or footer. (Repeating lines that sit
 * between whole sentences, like the speakers' names in a play, stay.)
 */
function stripRunningHeaders(paras: Para[][]) {
  const key = (text: string) => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
  const looksLikeHeader = (p: Para) =>
    !p.heading &&
    !p.first &&
    /\p{L}/u.test(p.text) &&
    !/[.!?,;:…"“”]/.test(p.text) &&
    p.text.split(/\s+/).length <= MAX_HEADER_WORDS
  const seen = new Map<string, { count: number; cutting: number }>()
  for (const list of paras) {
    list.forEach((p, i) => {
      if (!looksLikeHeader(p)) return
      const before = neighbour(list, i, -1)
      const after = neighbour(list, i, 1)
      const cuts = (!!before && !SENTENCE_END.test(before.text)) || (!!after && /^\p{Ll}/u.test(after.text))
      const s = seen.get(key(p.text)) ?? { count: 0, cutting: 0 }
      seen.set(key(p.text), { count: s.count + 1, cutting: s.cutting + (cuts ? 1 : 0) })
    })
  }
  const isHeader = (text: string) => {
    const s = seen.get(key(text))
    return !!s && s.count >= MIN_HEADER_REPEATS && s.cutting * 3 >= s.count
  }
  for (const list of paras) for (const p of list) if (looksLikeHeader(p) && isHeader(p.text)) p.text = ''
}

/** The nearest paragraph before (-1) or after (1) that wasn't removed. */
function neighbour(list: Para[], i: number, step: 1 | -1): Para | undefined {
  for (let j = i + step; j >= 0 && j < list.length; j += step) if (list[j].text) return list[j]
  return undefined
}

/** Join a paragraph to the next when a page break cut it mid-sentence. */
function joinBrokenParagraphs(list: Para[]): Para[] {
  const out: Para[] = []
  for (const p of list) {
    const prev = out[out.length - 1]
    if (prev && !prev.heading && !p.heading && CUT_OFF.test(prev.text) && /^\p{Ll}/u.test(p.text)) {
      // A word hyphenated across the break ("mainte-" + "nance") is one word again.
      prev.text = /\p{Ll}-$/u.test(prev.text) ? prev.text.slice(0, -1) + p.text : `${prev.text} ${p.text}`
    } else {
      out.push({ ...p })
    }
  }
  return out
}

/**
 * PDF pages as lines: drop the first or last line of a page when it's a page
 * number or repeats from page to page (a running header or footer).
 */
export function stripPageEdges(pages: string[][]): string[][] {
  const key = (line: string) => line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
  const edges = new Map<string, number>()
  for (const lines of pages) {
    for (const line of new Set([lines[0], lines[lines.length - 1]])) {
      if (line) edges.set(key(line), (edges.get(key(line)) ?? 0) + 1)
    }
  }
  const repeats = Math.max(MIN_HEADER_REPEATS, Math.ceil(pages.length * 0.2))
  const isEdge = (line: string | undefined) =>
    !!line && (PAGE_NUMBER.test(line.trim()) || ((edges.get(key(line)) ?? 0) >= repeats && line.split(/\s+/).length <= 14))
  return pages.map((lines) => {
    let from = 0
    let to = lines.length
    // A header and a page number can both sit at the top, so up to two lines each end.
    for (let k = 0; k < 2 && from < to && isEdge(lines[from]); k++) from++
    for (let k = 0; k < 2 && to > from && isEdge(lines[to - 1]); k++) to--
    return lines.slice(from, to)
  })
}
