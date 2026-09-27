/**
 * Word definitions for double-tap-to-define.
 *
 * Definitions come from two free dictionaries that need no key: the Free
 * Dictionary API (dictionaryapi.dev), then Wiktionary if that has nothing.
 * Only the word being looked up is sent. Every answer, including "not found",
 * is kept on this device, so a word looked up once works offline after.
 */

export interface Sense {
  partOfSpeech: string
  text: string
  example?: string
}

export interface Definition {
  /** The dictionary headword, which may be a base form ("run" for "running"). */
  word: string
  phonetic?: string
  senses: Sense[]
  source: 'Free Dictionary' | 'Wiktionary'
  /** Where to read the full entry. */
  url: string
}

export type Lookup = { status: 'found'; definition: Definition } | { status: 'not-found' } | { status: 'offline' }

/** Senses shown, so the card stays a glance rather than a page. */
const MAX_SENSES = 4

/** The word as written in the book, minus punctuation, quotes and a possessive 's. */
export function cleanWord(raw: string): string {
  return raw
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/['’](s)?$/iu, '')
    .toLowerCase()
}

/**
 * Forms to try, most likely first: the word itself, then the base forms a
 * dictionary lists it under (flies → fly, running → run, hoped → hope,
 * happily → happy). Some guesses aren't words; the lookup skips those.
 */
export function lookupForms(raw: string): string[] {
  const w = cleanWord(raw)
  if (!w) return []
  const forms = [w]
  const add = (f: string) => f.length > 1 && !forms.includes(f) && forms.push(f)
  const undouble = (s: string) => (/([^aeiouls])\1$/.test(s) ? s.slice(0, -1) : s)
  if (w.length > 3) {
    if (w.endsWith('ies')) add(w.slice(0, -3) + 'y')
    else if (/(?:ch|sh|x|z|ss)es$/.test(w)) add(w.slice(0, -2))
    else if (w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) add(w.slice(0, -1))
    if (w.endsWith('ied')) add(w.slice(0, -3) + 'y')
    else if (w.endsWith('ed')) {
      const stem = w.slice(0, -2)
      add(undouble(stem))
      add(w.slice(0, -1))
      add(stem)
    }
    if (w.endsWith('ing') && w.length > 4) {
      const stem = w.slice(0, -3)
      add(undouble(stem))
      add(stem + 'e')
      add(stem)
    }
    if (w.endsWith('ily')) add(w.slice(0, -3) + 'y')
    else if (w.endsWith('ly')) add(w.slice(0, -2))
  }
  return forms.slice(0, 4)
}

type Fetch = (url: string) => Promise<Response>

class Offline extends Error {}

async function getJson(fetcher: Fetch, url: string): Promise<unknown | null> {
  let response: Response
  try {
    response = await fetcher(url)
  } catch {
    throw new Offline()
  }
  if (response.status === 404) return null
  if (!response.ok) throw new Offline()
  return response.json()
}

interface FreeDictionaryEntry {
  word: string
  phonetic?: string
  phonetics?: { text?: string }[]
  meanings?: { partOfSpeech?: string; definitions?: { definition?: string; example?: string }[] }[]
}

export function fromFreeDictionary(data: unknown): Definition | null {
  if (!Array.isArray(data) || data.length === 0) return null
  const entries = data as FreeDictionaryEntry[]
  const senses: Sense[] = []
  for (const entry of entries) {
    for (const meaning of entry.meanings ?? []) {
      // One sense per part of speech first, so a word that's both a noun and a verb shows both.
      const first = meaning.definitions?.find((d) => d.definition)
      if (first?.definition) senses.push(sense(meaning.partOfSpeech, first.definition, first.example))
    }
  }
  for (const entry of entries) {
    for (const meaning of entry.meanings ?? []) {
      for (const d of meaning.definitions?.slice(1) ?? []) {
        if (d.definition) senses.push(sense(meaning.partOfSpeech, d.definition, d.example))
      }
    }
  }
  if (senses.length === 0) return null
  const word = entries[0].word
  const phonetic = entries.map((e) => e.phonetic ?? e.phonetics?.find((p) => p.text)?.text).find(Boolean)
  return {
    word,
    ...(phonetic && { phonetic }),
    senses: senses.slice(0, MAX_SENSES),
    source: 'Free Dictionary',
    url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
  }
}

interface WiktionaryResponse {
  en?: { partOfSpeech?: string; definitions?: { definition?: string; examples?: string[] }[] }[]
}

export function fromWiktionary(word: string, data: unknown): Definition | null {
  const english = (data as WiktionaryResponse | null)?.en
  if (!Array.isArray(english)) return null
  const senses: Sense[] = []
  for (const group of english) {
    for (const d of group.definitions ?? []) {
      const text = stripHtml(d.definition ?? '')
      if (text) senses.push(sense(group.partOfSpeech, text, d.examples?.[0] && stripHtml(d.examples[0])))
    }
  }
  if (senses.length === 0) return null
  return { word, senses: senses.slice(0, MAX_SENSES), source: 'Wiktionary', url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}` }
}

function sense(partOfSpeech: string | undefined, text: string, example?: string): Sense {
  return { partOfSpeech: (partOfSpeech ?? '').toLowerCase(), text: text.trim(), ...(example && { example: example.trim() }) }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** Wiktionary's definitions are small HTML snippets (links, italics); keep just the text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#?\w+);/g, (m, name: string) => ENTITIES[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Look a word up: the saved answer if there is one, otherwise each likely form
 * in each dictionary until one has it. "Offline" only when nothing could be
 * reached and nothing was saved.
 */
export async function define(
  raw: string,
  cache: { get: (key: string) => Promise<Lookup | undefined>; set: (key: string, value: Lookup) => Promise<void> },
  fetcher: Fetch = (url) => fetch(url),
): Promise<Lookup> {
  const forms = lookupForms(raw)
  if (forms.length === 0) return { status: 'not-found' }
  const key = forms[0]
  const saved = await cache.get(key).catch(() => undefined)
  if (saved) return saved

  let reached = false
  let result: Lookup = { status: 'not-found' }
  search: for (const form of forms) {
    for (const source of ['free', 'wiktionary'] as const) {
      try {
        const definition =
          source === 'free'
            ? fromFreeDictionary(await getJson(fetcher, `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(form)}`))
            : fromWiktionary(form, await getJson(fetcher, `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(form)}`))
        reached = true
        if (definition) {
          result = { status: 'found', definition }
          break search
        }
      } catch (e) {
        if (!(e instanceof Offline)) throw e
      }
    }
  }
  if (!reached) return { status: 'offline' }
  await cache.set(key, result).catch(() => {})
  return result
}
