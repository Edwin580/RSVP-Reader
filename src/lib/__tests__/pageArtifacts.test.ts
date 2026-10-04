import { describe, expect, it } from 'vitest'
import { removePageArtifacts, stripPageEdges } from '../pageArtifacts'
import type { Section } from '../text'

const one = (paragraphs: string[], headings?: number[]): Section[] => [{ title: 'One', paragraphs, headings }]
const text = (sections: Section[]) => sections.flatMap((s) => s.paragraphs)
/** A page's worth of prose (printed pages are a few hundred words apart), ending mid-sentence. */
const prose = (n = 120) => Array.from({ length: n }, (_, i) => ['the', 'pier', 'was', 'quiet', 'and', 'grey'][i % 6]).join(' ')

describe('removePageArtifacts', () => {
  it('takes out a page number stuck to a paragraph and rejoins the sentence it cut (as reported)', () => {
    const out = removePageArtifacts(
      one([
        `He ran the way children do, ${prose()} hoping running will turn to 17`,
        `flying. It might have seemed ridiculous to anyone watching, ${prose()} this white-haired 18`,
        `maintenance worker, all alone, making like an airplane. But the running boy ${prose()} is inside every man 19`,
        'no matter how old he gets.',
      ]),
    )
    expect(text(out)).toEqual([
      `He ran the way children do, ${prose()} hoping running will turn to flying. It might have seemed ridiculous to anyone watching, ${prose()} this white-haired maintenance worker, all alone, making like an airplane. But the running boy ${prose()} is inside every man no matter how old he gets.`,
    ])
  })

  it('takes out a page number after a finished sentence, or at the start of a paragraph', () => {
    const out = removePageArtifacts(one([`${prose()} he gets. 19`, `20 ${prose()}.`, `${prose()} ends. 21`, 'Fin.']))
    expect(text(out)).toEqual([`${prose()} he gets.`, `${prose()}.`, `${prose()} ends.`, 'Fin.'])
  })

  it('removes page numbers on their own, in any of the usual forms', () => {
    const out = removePageArtifacts(one([`${prose()}.`, '12', `${prose()}.`, '- 13 -', `${prose()}.`, 'Page 14', 'The end.']))
    expect(text(out)).toEqual([`${prose()}.`, `${prose()}.`, `${prose()}.`, 'The end.'])
  })

  it('leaves numbers alone that don’t run like page numbers', () => {
    const paragraphs = [`They met in 1945`, `and married in 1950.`, `She was 30`, 'He had 3 dogs.', '7']
    expect(text(removePageArtifacts(one(paragraphs)))).toEqual([
      'They met in 1945 and married in 1950.',
      'She was 30',
      'He had 3 dogs.',
      '7',
    ])
  })

  it('keeps numbers that come too close together to be page numbers, like a table’s', () => {
    const paragraphs = ['Scores by round.', '12', '15', '18', '20', '24', 'That was the season.']
    expect(text(removePageArtifacts(one(paragraphs)))).toEqual(paragraphs)
  })

  it('keeps chapter numbers that open each section, without joining them to the text', () => {
    const sections = [1, 2, 3, 4].map((n) => ({ title: `Chapter ${n}`, paragraphs: [String(n), `${prose()}.`] }))
    expect(text(removePageArtifacts(sections))).toEqual(sections.flatMap((s) => s.paragraphs))
  })

  it('removes a running header that keeps cutting into sentences', () => {
    const header = 'THE FIVE PEOPLE YOU MEET IN HEAVEN'
    const out = removePageArtifacts(
      one([`${prose()} that`, header, `morning. ${prose()} past the`, header, `carousel. ${prose()}.`, header, 'It was his birthday.']),
    )
    expect(text(out)).toEqual([`${prose()} that morning. ${prose()} past the carousel. ${prose()}.`, 'It was his birthday.'])
  })

  it('keeps repeated lines that sit between whole sentences, like the speakers in a play, without joining them', () => {
    const paragraphs = ['HAMLET', `${prose()}.`, 'OPHELIA', `${prose()}.`, 'HAMLET', `${prose()}.`, 'OPHELIA', 'My lord.']
    expect(text(removePageArtifacts(one(paragraphs)))).toEqual(paragraphs)
  })

  it('keeps a refrain, which repeats closer together than pages', () => {
    const verse = ['When I find myself in times of trouble', 'Mother Mary comes to me', 'Let it be']
    const paragraphs = [...verse, ...verse, ...verse, ...verse]
    expect(text(removePageArtifacts(one(paragraphs)))).toEqual(paragraphs)
  })

  it('rejoins a word hyphenated across a page break, and a dash', () => {
    expect(text(removePageArtifacts(one(['He was the mainte-', 'nance man.'])))).toEqual(['He was the maintenance man.'])
    expect(text(removePageArtifacts(one(['He was—', 'and then he left.'])))).toEqual(['He was—and then he left.'])
  })

  it('finishes a sentence cut off across sections, like the pages of a PDF without bookmarks', () => {
    const out = removePageArtifacts([
      { title: 'Page 1', paragraphs: ['It was a dark and stormy'] },
      { title: 'Page 2', paragraphs: ['night. The rain fell.', 'Then it stopped.'] },
      { title: 'Page 3', paragraphs: ['It rained all day, and all'] },
      { title: 'Page 4', paragraphs: ['night, without end'] },
      { title: 'Page 5', paragraphs: ['until the morning came. Then the sun.'] },
    ])
    // Each page keeps what it started with, past the end of the sentence.
    expect(out.map((s) => s.paragraphs)).toEqual([
      ['It was a dark and stormy night.'],
      ['The rain fell.', 'Then it stopped.'],
      ['It rained all day, and all night, without end until the morning came.'],
      [],
      ['Then the sun.'],
    ])
  })

  it('doesn’t join paragraphs that end a sentence, or into headings', () => {
    const out = removePageArtifacts(one(['Chapter 2', 'it was late.', 'He left.', 'then she did.'], [0]))
    expect(out[0].paragraphs).toEqual(['Chapter 2', 'it was late.', 'He left.', 'then she did.'])
    expect(out[0].headings).toEqual([0])
  })

  it('leaves a caption that interrupts a sentence alone', () => {
    const paragraphs = ['He said he was', '[Illustration: “He never read novels”]', 'going to London.']
    expect(text(removePageArtifacts(one(paragraphs)))).toEqual(paragraphs)
  })

  it('keeps headings pointing at the right paragraphs after removing some', () => {
    const p = `${prose()}.`
    const out = removePageArtifacts(one(['Part One', p, '4', 'Chapter 1', p, '5', 'Chapter 2', p, '6', 'Fin.'], [0, 3, 6]))
    expect(out[0].paragraphs).toEqual(['Part One', p, 'Chapter 1', p, 'Chapter 2', p, 'Fin.'])
    expect(out[0].headings).toEqual([0, 2, 4])
  })
})

describe('stripPageEdges', () => {
  /**
   * A PDF page laid out like a printed one: header lines in the top margin,
   * the text in lines 14 apart, footer lines in the bottom margin.
   */
  const sheet = (top: string[], body: string[], bottom: string[]) => [
    ...top.map((text, i) => ({ text, y: 560 - i * 12 })),
    ...body.map((text, i) => ({ text, y: 500 - i * 14 })),
    ...bottom.map((text, i) => ({ text, y: 500 - body.length * 14 - 30 - i * 12 })),
  ]
  const body = (n: number) => [`Text on page ${n} starts`, 'and carries on over', 'a few lines until it', 'ends here.']

  it('drops running headers, footers and page numbers in the margins of PDF pages', () => {
    const numbers = [5, 6, 7, 8, 9, 10, 11, 12]
    const pages = numbers.map((n) => sheet([n % 2 ? 'The Five People You Meet in Heaven' : 'Mitch Albom'], body(n), [String(n)]))
    expect(stripPageEdges(pages)).toEqual(numbers.map(body))
  })

  it('finds them by where they sit, though they’re drawn after the text', () => {
    // As Chromium prints a page: the text, then the header (top), then the number (bottom).
    const pages = [2, 3, 4, 5].map((n) => {
      const [header, ...rest] = sheet(['PRIDE AND PREJUDICE'], body(n), [String(n)])
      return [...rest.slice(0, -1), header, rest[rest.length - 1]]
    })
    expect(stripPageEdges(pages)).toEqual([2, 3, 4, 5].map(body))
  })

  it('drops a header that carries the page number, or sits with it', () => {
    const numbers = [20, 21, 22, 23]
    expect(stripPageEdges(numbers.map((n) => sheet([`${n} THE FIVE PEOPLE`], body(n), [])))).toEqual(numbers.map(body))
    expect(stripPageEdges(numbers.map((n) => sheet([String(n), 'THE FIVE PEOPLE'], body(n), [])))).toEqual(numbers.map(body))
  })

  it('drops a running header that names the chapter, on that chapter’s pages only', () => {
    const chapters = ['The Storm', 'Ruby', 'The Pier']
    const pages = chapters.flatMap((name, c) => [0, 1, 2, 3, 4, 5].map((k) => sheet([k % 2 ? name : 'Mitch Albom'], body(c * 6 + k), [])))
    expect(stripPageEdges(pages)).toEqual(chapters.flatMap((_, c) => [0, 1, 2, 3, 4, 5].map((k) => body(c * 6 + k))))
  })

  it('drops them on a short last page too', () => {
    const pages = [1, 2, 3, 4].map((n) => sheet(['THE LONG STORY'], n === 4 ? ['The end.'] : body(n), [String(n)]))
    expect(stripPageEdges(pages)).toEqual([body(1), body(2), body(3), ['The end.']])
  })

  it('keeps text that repeats at the top of pages but isn’t set apart in the margin', () => {
    const pages = [1, 2, 3, 4].map(() => sheet([], ['Sentence number one of', 'the story goes on a', 'while longer.'], []))
    expect(stripPageEdges(pages)).toEqual(pages.map((p) => p.map((l) => l.text)))
  })

  it('keeps chapter headings and lines that are just text, even in the margin', () => {
    const pages = [1, 2, 3].map((n) => sheet([`Chapter ${n}`], body(n), ['The end of the page.']))
    expect(stripPageEdges(pages)).toEqual(pages.map((p) => p.map((l) => l.text)))
  })
})
