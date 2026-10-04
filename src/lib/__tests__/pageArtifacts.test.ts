import { describe, expect, it } from 'vitest'
import { removePageArtifacts, stripPageEdges } from '../pageArtifacts'
import type { Section } from '../text'

const one = (paragraphs: string[], headings?: number[]): Section[] => [{ title: 'One', paragraphs, headings }]
const text = (sections: Section[]) => sections.flatMap((s) => s.paragraphs)

describe('removePageArtifacts', () => {
  it('takes out a page number stuck to a paragraph and rejoins the sentence it cut (as reported)', () => {
    const out = removePageArtifacts(
      one([
        'Eddie ran across the pier.',
        'He ran the way children do, hoping running will turn to 17',
        'flying. It might have seemed ridiculous to anyone watching, this white-haired 18',
        'maintenance worker, all alone, making like an airplane.',
        'But the running boy is inside every man 19',
        'no matter how old he gets.',
      ]),
    )
    expect(text(out)).toEqual([
      'Eddie ran across the pier.',
      'He ran the way children do, hoping running will turn to flying. It might have seemed ridiculous to anyone watching, this white-haired maintenance worker, all alone, making like an airplane.',
      'But the running boy is inside every man no matter how old he gets.',
    ])
  })

  it('removes page numbers on their own, in any of the usual forms', () => {
    const out = removePageArtifacts(
      one(['It began at dawn.', '12', 'The sun rose.', '- 13 -', 'Birds sang.', 'Page 14', 'Then it was noon.']),
    )
    expect(text(out)).toEqual(['It began at dawn.', 'The sun rose.', 'Birds sang.', 'Then it was noon.'])
  })

  it('leaves numbers alone that don’t run like page numbers', () => {
    const paragraphs = ['They met in 1945', 'and married in 1950.', 'She was 30', 'He had 3 dogs.', '7']
    expect(text(removePageArtifacts(one(paragraphs)))).toEqual([
      'They met in 1945 and married in 1950.',
      'She was 30',
      'He had 3 dogs.',
      '7',
    ])
  })

  it('keeps chapter numbers that open each section', () => {
    const sections = [1, 2, 3, 4].map((n) => ({ title: `Chapter ${n}`, paragraphs: [String(n), 'Something happened.'] }))
    expect(text(removePageArtifacts(sections))).toEqual(sections.flatMap((s) => s.paragraphs))
  })

  it('removes a running header that keeps cutting into sentences', () => {
    const out = removePageArtifacts(
      one([
        'The pier was quiet that',
        'THE FIVE PEOPLE YOU MEET IN HEAVEN',
        'morning. Eddie checked the rides.',
        'He walked past the',
        'THE FIVE PEOPLE YOU MEET IN HEAVEN',
        'carousel and the Ferris wheel.',
        'The sea was grey.',
        'THE FIVE PEOPLE YOU MEET IN HEAVEN',
        'It was his birthday.',
      ]),
    )
    expect(text(out)).toEqual([
      'The pier was quiet that morning. Eddie checked the rides.',
      'He walked past the carousel and the Ferris wheel.',
      'The sea was grey.',
      'It was his birthday.',
    ])
  })

  it('keeps repeated lines that sit between whole sentences, like the speakers in a play', () => {
    const paragraphs = ['HAMLET', 'To be, or not to be.', 'OPHELIA', 'Good my lord.', 'HAMLET', 'I humbly thank you.', 'OPHELIA', 'My lord.']
    expect(text(removePageArtifacts(one(paragraphs)))).toEqual(paragraphs)
  })

  it('rejoins a word hyphenated across a page break', () => {
    expect(text(removePageArtifacts(one(['He was the mainte-', 'nance man.'])))).toEqual(['He was the maintenance man.'])
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
    const out = removePageArtifacts(
      one(['Part One', 'It began.', '4', 'Chapter 1', 'It went on.', '5', 'Chapter 2', 'It ended.', '6', 'Fin.'], [0, 3, 6]),
    )
    expect(out[0].paragraphs).toEqual(['Part One', 'It began.', 'Chapter 1', 'It went on.', 'Chapter 2', 'It ended.', 'Fin.'])
    expect(out[0].headings).toEqual([0, 2, 4])
  })
})

describe('stripPageEdges', () => {
  it('drops running headers, footers and page numbers at the edges of PDF pages', () => {
    const numbers = [5, 6, 7, 8, 9, 10, 11, 12]
    const pages = numbers.map((n) => [
      n % 2 ? 'The Five People You Meet in Heaven' : 'Mitch Albom',
      `Text on page ${n} goes here`,
      `and ends here.`,
      String(n),
    ])
    expect(stripPageEdges(pages)).toEqual(numbers.map((n) => [`Text on page ${n} goes here`, 'and ends here.']))
  })

  it('drops a header that carries the page number', () => {
    const body = ['He woke early.', 'The pier was empty.', 'Gulls circled.', 'It was his birthday.']
    const pages = body.map((line, i) => [`${20 + i} THE FIVE PEOPLE YOU MEET IN HEAVEN`, line])
    expect(stripPageEdges(pages)).toEqual(body.map((line) => [line]))
  })

  it('keeps edge lines that are just text', () => {
    const pages = [['Once upon a time', 'there was a fox.'], ['The fox ran', 'into the woods.'], ['It never', 'came back.']]
    expect(stripPageEdges(pages)).toEqual(pages)
  })
})
