import { describe, expect, it } from 'vitest'
import { buildBook, pictureMark, isChapterHeading, splitMarkdownChapters, splitParagraphs, splitTextChapters, splitWords, stripMarkdown, decodeText } from '../text'
import { removePageArtifacts } from '../pageArtifacts'

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

describe('buildBook pictures', () => {
  it('places a picture before the paragraph it stood before, and leaves its mark out of the words', () => {
    const book = buildBook('id', 'T', [
      { title: 'One', paragraphs: [pictureMark(0), 'The map of the island.', pictureMark(1), 'They set sail.', pictureMark(2)] },
    ])
    expect(book.words).toEqual(['The', 'map', 'of', 'the', 'island.', 'They', 'set', 'sail.'])
    expect(book.paragraphEnds).toEqual([4, 7])
    expect(book.pictures).toEqual([
      { at: 0, id: 0 },
      { at: 5, id: 1 },
      { at: 8, id: 2 }, // after the last word
    ])
  })

  it('moves a picture caught up inside a paragraph to after it', () => {
    const book = buildBook('id', 'T', [{ paragraphs: [`The storm came ${pictureMark(3)} at dusk.`, 'Morning.'] }])
    expect(book.words.join(' ')).toBe('The storm came at dusk. Morning.')
    expect(book.pictures).toEqual([{ at: 5, id: 3 }])
  })

  it('keeps pictures through the clean-up of page numbers and broken paragraphs', () => {
    const sections = removePageArtifacts([
      { title: 'One', paragraphs: ['The ship left the harbour and', pictureMark(0), 'sailed west for a week.', pictureMark(1), 'Land.'] },
    ])
    const book = buildBook('id', 'T', sections)
    expect(book.words.join(' ')).toBe('The ship left the harbour and sailed west for a week. Land.')
    expect(book.pictures?.map((p) => p.id)).toEqual([0, 1])
    for (const p of book.pictures!) expect([0, ...book.paragraphEnds.map((e) => e + 1)]).toContain(p.at)
  })

  it('has no pictures field for a book without any', () => {
    expect(buildBook('id', 'T', [{ paragraphs: ['Words only.'] }]).pictures).toBeUndefined()
  })
})

describe('stripMarkdown underscores', () => {
  it('keeps underscores inside words and strips them around words', () => {
    expect(stripMarkdown('Call read_file_name here, _really_ and __truly__.')).toBe('Call read_file_name here, really and truly.')
    expect(stripMarkdown('_Start_ of a line')).toBe('Start of a line')
    expect(stripMarkdown('**bold with _em_ inside**')).toBe('bold with em inside')
  })
})

describe('decodeText', () => {
  const bytes = (...b: number[]) => new Uint8Array(b).buffer
  it('reads UTF-8, with or without a byte-order mark', () => {
    expect(decodeText(new TextEncoder().encode('café “quoted”').buffer as ArrayBuffer)).toBe('café “quoted”')
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x68, 0x69))).toBe('hi')
  })
  it('reads UTF-16 by its byte-order mark', () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00))).toBe('hé')
    expect(decodeText(bytes(0xfe, 0xff, 0x00, 0x68, 0x00, 0xe9))).toBe('hé')
  })
  it('reads Windows-1252 when the bytes are not UTF-8', () => {
    // "café" and curly quotes as an older Windows text file stores them.
    expect(decodeText(bytes(0x93, 0x63, 0x61, 0x66, 0xe9, 0x94))).toBe('“café”')
  })
  it('reads an empty file', () => {
    expect(decodeText(bytes())).toBe('')
  })
})
