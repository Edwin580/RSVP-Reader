import { isChapterHeading, type Section } from './text'

/**
 * Books converted from print (scanned or exported PDFs, EPUBs made from them)
 * often carry the printed page into the text: page numbers, running headers
 * ("THE FIVE PEOPLE YOU MEET IN HEAVEN"), and paragraphs broken where the
 * page ended. This takes them back out.
 */

/** A paragraph that's only a page number: "18", "- 18 -", "Page 18". */
const PAGE_NUMBER = /^(?:page\s+)?[-–—]?\s*(\d{1,4})\s*[-–—]?$/i
/** A page number stuck to the end or start of a paragraph. */
const TRAILING_NUMBER = /^(.*[^\s\d])\s+(\d{1,4})$/su
const LEADING_NUMBER = /^(\d{1,4})\s+(\p{Ll}.*)$/su
/** Ends like a finished sentence (or a quote that finishes one). */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/u
/** Stops mid-sentence: on a word, a comma or a dash (not a bracketed caption, say). */
const CUT_OFF = /[\p{L}\p{N},;:—–-]$/u
/** Page numbers further apart than this (pages without one, like chapter openings) don't count as a run. */
const MAX_PAGE_GAP = 8
/**
 * Printed pages are a few hundred words apart, so page numbers and running
 * headers are at least this far apart (in words). Numbers in a table, or a
 * song's refrain, come much closer together.
 */
const MIN_PAGE_WORDS = 40
const MIN_HEADER_SPACING = 100
/** A short unpunctuated line seen at least this often is a running header. */
const MIN_HEADER_REPEATS = 3
const MAX_HEADER_WORDS = 10

interface Para {
  text: string
  /** Where it starts in the book, in words. */
  at: number
  heading: boolean
  /** First paragraph of its section, where a bare number is a chapter number, not a page's. */
  first: boolean
}

interface Candidate {
  section: number
  index: number
  at: number
  value: number
  kind: 'alone' | 'end' | 'start'
  /** A bare number opening a section, which could be a chapter number. */
  opening: boolean
}

export function removePageArtifacts(sections: Section[]): Section[] {
  let at = 0
  const paras = sections.map((s) => {
    const headings = new Set(s.headings)
    return s.paragraphs.map((text, i): Para => {
      const para = { text, at, heading: headings.has(i), first: i === 0 }
      at += text.split(/\s+/).length
      return para
    })
  })
  stripPageNumbers(paras)
  stripRunningHeaders(paras)
  const joined = paras.map((list) => joinBrokenParagraphs(list.filter((p) => p.text)))
  // A section can start mid-sentence too, as each page does in a PDF
  // without bookmarks. The words up to the end of that sentence go back to
  // finish it; the rest stays, so each section keeps its own text.
  let last: Para | undefined
  for (const list of joined) {
    const next = list[0]
    if (last && next && continues(last, next)) {
      const end = next.text.match(/[.!?…]["'”’)\]]*\s+/u)
      const cut = end ? end.index! + end[0].length : next.text.length
      last.text = join(last.text, next.text.slice(0, cut).trim())
      next.text = next.text.slice(cut).trim()
      if (!next.text) list.shift()
    }
    last = list[list.length - 1] ?? last
  }
  return sections.map((section, s) => ({
    ...section,
    paragraphs: joined[s].map((p) => p.text),
    ...(section.headings && { headings: joined[s].flatMap((p, i) => (p.heading ? [i] : [])) }),
  }))
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
      const at = p.at
      if (alone) candidates.push({ section, index, at, value: Number(alone[1]), kind: 'alone', opening })
      else if (end) candidates.push({ section, index, at, value: Number(end[2]), kind: 'end', opening: false })
      else if (start) candidates.push({ section, index, at, value: Number(start[1]), kind: 'start', opening: false })
    }),
  )
  // A page number has a neighbouring candidate a page or a few on either side.
  // Numbers opening sections run in sequence too when they're chapter
  // numbers, so for those the neighbour has to be from inside a section.
  const fits = (a: Candidate | undefined, b: Candidate | undefined) =>
    !!a &&
    !!b &&
    !(a.opening && b.opening) &&
    b.value > a.value &&
    b.value - a.value <= MAX_PAGE_GAP &&
    b.at - a.at >= MIN_PAGE_WORDS
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
 * Remove short unpunctuated lines that keep repeating about a page apart and
 * often cut into a sentence: a page's running header or footer. (Repeating
 * lines between whole sentences, like the speakers in a play, or close
 * together, like a refrain, stay.)
 */
function stripRunningHeaders(paras: Para[][]) {
  const key = (text: string) => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
  const looksLikeHeader = (p: Para) =>
    !p.heading &&
    !p.first &&
    /\p{L}/u.test(p.text) &&
    !/[.!?,;:…"“”]/.test(p.text) &&
    p.text.split(/\s+/).length <= MAX_HEADER_WORDS &&
    !isChapterHeading(p.text)
  const seen = new Map<string, { count: number; cutting: number; at: number[] }>()
  for (const list of paras) {
    list.forEach((p, i) => {
      if (!looksLikeHeader(p)) return
      const before = neighbour(list, i, -1)
      const after = neighbour(list, i, 1)
      const cuts = (!!before && !SENTENCE_END.test(before.text)) || (!!after && /^\p{Ll}/u.test(after.text))
      const s = seen.get(key(p.text)) ?? { count: 0, cutting: 0, at: [] }
      seen.set(key(p.text), { count: s.count + 1, cutting: s.cutting + (cuts ? 1 : 0), at: [...s.at, p.at] })
    })
  }
  const isHeader = (text: string) => {
    const s = seen.get(key(text))
    return !!s && s.count >= MIN_HEADER_REPEATS && s.cutting * 3 >= s.count && medianGap(s.at) >= MIN_HEADER_SPACING
  }
  for (const list of paras) for (const p of list) if (looksLikeHeader(p) && isHeader(p.text)) p.text = ''
}

/** The nearest paragraph before (-1) or after (1) that wasn't removed. */
function neighbour(list: Para[], i: number, step: 1 | -1): Para | undefined {
  for (let j = i + step; j >= 0 && j < list.length; j += step) if (list[j].text) return list[j]
  return undefined
}

function medianGap(at: number[]): number {
  const gaps = at.slice(1).map((a, i) => a - at[i]).sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)] ?? 0
}

/**
 * Whether `next` carries on a sentence a page break cut off at the end of
 * `prev`. A line without lowercase letters is a label (a chapter number, a
 * speaker's name), not a cut-off sentence.
 */
const continues = (prev: Para, next: Para) =>
  !prev.heading &&
  !next.heading &&
  CUT_OFF.test(prev.text) &&
  /\p{Ll}/u.test(prev.text) &&
  /^\p{Ll}/u.test(next.text)

function join(before: string, after: string): string {
  // A word hyphenated across the break ("mainte-" + "nance") is one word again.
  if (/\p{Ll}-$/u.test(before)) return before.slice(0, -1) + after
  // An interrupting dash runs straight on ("was—" + "and" → "was—and").
  if (/[—–]$/.test(before)) return before + after
  return `${before} ${after}`
}

/** Join a paragraph to the next when a page break cut it mid-sentence. */
function joinBrokenParagraphs(list: Para[]): Para[] {
  const out: Para[] = []
  for (const p of list) {
    const prev = out[out.length - 1]
    if (prev && continues(prev, p)) prev.text = join(prev.text, p.text)
    else out.push({ ...p })
  }
  return out
}

/** A line of a PDF page and how high up the page it sits (PDF units, higher is further up). */
export interface PageLine {
  text: string
  y: number
}

/**
 * PDF pages as lines: drop a page's header, footer and page number. They sit
 * in the margin, set apart from the text by more than the space between its
 * lines, and a header or footer repeats from page to page. "Top" and
 * "bottom" are by position, since PDFs often draw them after the text; the
 * text keeps the PDF's order, which follows its columns.
 */
export function stripPageEdges(pages: PageLine[][]): string[][] {
  const key = (line: string) => line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
  const downs = pages.map((lines) => [...lines].sort((a, b) => b.y - a.y))
  // The usual space between lines, over the whole document (a page's last
  // few lines aren't enough to tell).
  const gaps = downs
    .flatMap((down) => down.slice(1).map((l, i) => down[i].y - l.y))
    .filter((g) => g > 0)
    .sort((a, b) => a - b)
  const lineGap = gaps[Math.floor(gaps.length / 2)] ?? 0
  const margins = downs.map((down) => {
    // Up to two lines from an edge, if a gap wider than between lines follows them.
    const margin = (order: PageLine[]) => {
      for (let i = 0; i < 2 && i < order.length - 1; i++) {
        if (Math.abs(order[i].y - order[i + 1].y) > lineGap * 1.5) return order.slice(0, i + 1)
      }
      return []
    }
    return [...margin(down), ...margin([...down].reverse())]
  })
  const counts = new Map<string, number>()
  for (const lines of margins) {
    for (const k of new Set(lines.map((l) => key(l.text)))) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  // A running header can be the chapter's name, so it only repeats on that chapter's pages.
  const isArtifact = (line: PageLine) =>
    PAGE_NUMBER.test(line.text.trim()) ||
    ((counts.get(key(line.text)) ?? 0) >= MIN_HEADER_REPEATS &&
      !SENTENCE_END.test(line.text) &&
      line.text.split(/\s+/).length <= 14 &&
      !isChapterHeading(line.text))
  return pages.map((lines, p) => {
    const drop = new Set(margins[p].filter(isArtifact))
    return lines.filter((l) => !drop.has(l)).map((l) => l.text)
  })
}
