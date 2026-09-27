import { describe, expect, it } from 'vitest'
import { cleanWord, define, fromFreeDictionary, fromWiktionary, lookupForms, stripHtml, type Lookup } from '../dictionary'

describe('lookupForms', () => {
  it('cleans punctuation, quotes and possessives', () => {
    expect(cleanWord('“Windscreen,”')).toBe('windscreen')
    expect(cleanWord("Maxim's")).toBe('maxim')
    expect(cleanWord('Manderley’s')).toBe('manderley')
    expect(cleanWord('—')).toBe('')
  })

  it('tries the word first, then likely base forms', () => {
    expect(lookupForms('flies')[0]).toBe('flies')
    expect(lookupForms('flies')).toContain('fly')
    expect(lookupForms('running')).toContain('run')
    expect(lookupForms('hoped')).toContain('hope')
    expect(lookupForms('happily')).toContain('happy')
    expect(lookupForms('boxes')).toContain('box')
    expect(lookupForms('cat')).toEqual(['cat'])
    expect(lookupForms('...')).toEqual([])
  })

  it('never tries more than four forms', () => {
    expect(lookupForms('stopping').length).toBeLessThanOrEqual(4)
  })
})

describe('parsing', () => {
  it('reads the Free Dictionary, one sense per part of speech first', () => {
    const def = fromFreeDictionary([
      {
        word: 'run',
        phonetics: [{}, { text: '/ɹʌn/' }],
        meanings: [
          { partOfSpeech: 'verb', definitions: [{ definition: 'To move swiftly.', example: 'She ran home.' }, { definition: 'To flow.' }] },
          { partOfSpeech: 'noun', definitions: [{ definition: 'An act of running.' }] },
        ],
      },
    ])!
    expect(def.word).toBe('run')
    expect(def.phonetic).toBe('/ɹʌn/')
    expect(def.senses.map((s) => s.partOfSpeech)).toEqual(['verb', 'noun', 'verb'])
    expect(def.senses[0]).toEqual({ partOfSpeech: 'verb', text: 'To move swiftly.', example: 'She ran home.' })
    expect(def.source).toBe('Free Dictionary')
  })

  it('reads Wiktionary, stripping its HTML', () => {
    const def = fromWiktionary('windscreen', {
      en: [{ partOfSpeech: 'Noun', definitions: [{ definition: '(<i>UK</i>) The <a href="/wiki/window">window</a> at the front of a car.' }] }],
    })!
    expect(def.senses[0]).toEqual({ partOfSpeech: 'noun', text: '(UK) The window at the front of a car.' })
    expect(stripHtml('Tom &amp; Jerry&#39;s')).toBe("Tom & Jerry's")
  })

  it('treats empty answers as nothing found', () => {
    expect(fromFreeDictionary([])).toBeNull()
    expect(fromWiktionary('x', {})).toBeNull()
  })
})

describe('define', () => {
  const memory = () => {
    const saved = new Map<string, Lookup>()
    return { saved, get: async (k: string) => saved.get(k), set: async (k: string, v: Lookup) => void saved.set(k, v) }
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const entry = (word: string) => [{ word, meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: `To ${word}.` }] }] }]

  it('falls back to a base form and saves the answer', async () => {
    const cache = memory()
    const asked: string[] = []
    const fetcher = async (url: string) => {
      asked.push(url)
      if (url.includes('dictionaryapi') && url.endsWith('/hope')) return json(entry('hope'))
      return json({}, 404)
    }
    const result = await define('Hoped,', cache, fetcher)
    expect(result.status).toBe('found')
    expect(result.status === 'found' && result.definition.word).toBe('hope')
    expect(cache.saved.get('hoped')).toEqual(result)
    // Asked again: straight from the saved answer.
    const again = await define('hoped', cache, async () => {
      throw new Error('should not fetch')
    })
    expect(again).toEqual(result)
    expect(asked[0]).toContain('/hoped')
  })

  it('says offline when nothing can be reached, and saves nothing', async () => {
    const cache = memory()
    const result = await define('windscreen', cache, async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(result).toEqual({ status: 'offline' })
    expect(cache.saved.size).toBe(0)
  })

  it('remembers words that have no definition', async () => {
    const cache = memory()
    const result = await define('qwzxv', cache, async () => json({}, 404))
    expect(result).toEqual({ status: 'not-found' })
    expect(cache.saved.get('qwzxv')).toEqual({ status: 'not-found' })
  })
})
