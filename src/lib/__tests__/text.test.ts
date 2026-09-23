import { describe, expect, it } from 'vitest'
import { buildBook, isChapterHeading, splitMarkdownChapters, splitParagraphs, splitTextChapters, splitWords, stripMarkdown } from '../text'

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

describe('isChapterHeading', () => {
  it('recognises common heading styles', () => {
    for (const h of ['CHAPTER I.', 'Chapter 12', 'Chapter Three: The Storm', 'PART II', 'Book the First'.replace('the ', ''), 'Prologue', 'EPILOGUE', 'Chapter XIV — Home'])
      expect(isChapterHeading(h)).toBe(true)
  })

  it('ignores ordinary sentences that mention chapters', () => {
    for (const p of ['In this chapter we learn a lot about ships and storms and more.', 'Chapter did not end well', 'Part of me wanted to leave.', 'The introduction was long and dull and full of footnotes, far too many.'])
      expect(isChapterHeading(p)).toBe(false)
  })
})

describe('splitTextChapters', () => {
  it('splits at headings, keeps front matter, and picks up subtitles', () => {
    const sections = splitTextChapters([
      'A Novel',
      'CHAPTER I.',
      'Down the Rabbit-Hole',
      'Alice was beginning to get very tired.',
      'CHAPTER II.',
      'So she was considering.',
    ])
    expect(sections.map((s) => s.title)).toEqual(['Beginning', 'CHAPTER I: Down the Rabbit-Hole', 'CHAPTER II'])
    expect(sections[1].headings).toEqual([0, 1])
    expect(sections[2].headings).toEqual([0])
  })

  it('leaves text without clear chapters as one section', () => {
    expect(splitTextChapters(['Chapter 1', 'Just one heading here.'])).toEqual([{ paragraphs: ['Chapter 1', 'Just one heading here.'] }])
  })
})

describe('splitMarkdownChapters', () => {
  it('starts chapters at # and ## and keeps deeper headings inside', () => {
    const sections = splitMarkdownChapters('Intro text.\n\n# One\nFirst **bold** para.\n\n### Detail\n\nMore.\n\n## Two\n\nLast.')
    expect(sections.map((s) => s.title)).toEqual([undefined, 'One', 'Two'])
    expect(sections[1]).toEqual({ title: 'One', paragraphs: ['One', 'First bold para.', 'Detail', 'More.'], headings: [0, 2] })
  })
})

describe('buildBook headings', () => {
  it('records heading word ranges', () => {
    const book = buildBook('id', 'T', [{ title: 'Ch 1', paragraphs: ['Chapter One', 'Hello there.'], headings: [0] }])
    expect(book.headings).toEqual([{ start: 0, end: 1 }])
  })
})
