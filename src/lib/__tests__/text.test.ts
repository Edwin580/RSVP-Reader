import { describe, expect, it } from 'vitest'
import { buildBook, splitParagraphs, splitWords, stripMarkdown } from '../text'

describe('splitWords', () => {
  it('splits on whitespace and em dashes between words', () => {
    expect(splitWords('  this—that and  more ')).toEqual(['this—', 'that', 'and', 'more'])
  })
})

describe('splitParagraphs', () => {
  it('splits on blank lines and unwraps hard-wrapped text', () => {
    const text = 'First line\nwrapped here and hyphen-\nated.\r\n\r\nSecond para.\n\n\n'
    expect(splitParagraphs(text)).toEqual(['First line wrapped here and hyphenated.', 'Second para.'])
  })
})

describe('stripMarkdown', () => {
  it('removes common syntax but keeps text', () => {
    const md = '# Title\n\nSome **bold** and _em_ with a [link](http://x).\n\n- item\n\n```\ncode\n```'
    expect(splitParagraphs(stripMarkdown(md))).toEqual(['Title', 'Some bold and em with a link.', 'item'])
  })
})

describe('buildBook', () => {
  it('tracks paragraph ends and chapter starts, skipping empty sections', () => {
    const book = buildBook('id', 'T', [
      { title: 'One', paragraphs: ['a b', 'c'] },
      { title: 'Empty', paragraphs: [] },
      { paragraphs: ['d e'] },
    ])
    expect(book.words).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(book.paragraphEnds).toEqual([1, 2, 4])
    expect(book.chapters).toEqual([
      { title: 'One', start: 0 },
      { title: 'Section 3', start: 3 },
    ])
  })
})
