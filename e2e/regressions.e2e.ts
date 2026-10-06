import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { chapterTwo, clock, LISTEN_BOOK, longAudiobook, mockArchive, SECOND, upload } from './helpers.ts'

/*
 * Bugs that were fixed and must stay fixed. Each test names the bug as it
 * was reported and the pull request that fixed it, and was checked to fail
 * with that fix undone. Bugs fixed later get their test here too (see
 * CLAUDE.md, "Bug fixes").
 */

const openSettings = (page: Page) => page.getByRole('button', { name: 'Reading settings', exact: true }).click()
const closeSettings = async (page: Page) => {
  await page.locator('.popover-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(page.locator('.popover')).toBeHidden()
}

/**
 * Fixed layers with any colour that touch the top edge of the page. Safari
 * colours its top bar from such a layer and keeps that colour after it
 * changes, which left the bar in the wrong theme.
 */
const colouredLayersAtTop = (page: Page) =>
  page.evaluate(`(() => {
    const found = []
    for (const x of [8, innerWidth / 2, innerWidth - 8]) {
      for (const el of document.elementsFromPoint(x, 1)) {
        const style = getComputedStyle(el)
        const colour = style.backgroundColor.match(/[\\d.]+/g)?.map(Number) ?? []
        const opaque = colour.length === 4 ? colour[3] > 0 : colour.length === 3
        if ((style.position === 'fixed' || style.position === 'sticky') && opaque) found.push(el.className || el.tagName)
      }
    }
    return [...new Set(found)]
  })()`)

/** A CSS colour resolved by the browser, to compare with what's painted. */
const resolve = (page: Page, css: string) =>
  page.evaluate(`(() => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = '${css}'
    document.body.append(probe)
    const colour = getComputedStyle(probe).backgroundColor
    probe.remove()
    return colour
  })()`)

const pageColour = (page: Page) => page.evaluate(`getComputedStyle(document.documentElement).backgroundColor`)

for (const mode of ['Word', 'Page'] as const) {
  test(`${mode} mode: Safari's top bar follows the theme and dims with the Aa sheet (#36, #48)`, async ({ page }, testInfo) => {
    // Reported: "When changing theme on mobile, top still shows old theme",
    // twice. Safari takes its top bar colour from a coloured fixed layer at
    // the top (once the settings backdrop, later a fixed reader) and keeps it.
    await page.goto('./')
    await upload(page)
    if (mode === 'Page') {
      await openSettings(page)
      await page.getByRole('radio', { name: 'Page' }).click()
      await closeSettings(page)
    }
    expect(await colouredLayersAtTop(page)).toEqual([])

    await openSettings(page)
    expect(await colouredLayersAtTop(page)).toEqual([])
    await page.getByRole('radio', { name: 'Dark' }).click()
    expect(await colouredLayersAtTop(page)).toEqual([])
    if (testInfo.project.name === 'phone') {
      // Behind the sheet, the page itself is the dimmed colour of the theme
      // just picked: that's what Safari's bar shows.
      await expect.poll(() => pageColour(page)).toBe(await resolve(page, 'var(--page-dimmed)'))
    }
    await closeSettings(page)
    expect(await colouredLayersAtTop(page)).toEqual([])
    await expect.poll(() => pageColour(page)).not.toBe(await resolve(page, 'var(--page-dimmed)'))
    expect(await page.evaluate(`getComputedStyle(document.body).backgroundColor`)).toBe(await resolve(page, 'var(--bg)'))
  })
}

test('the page behind the reader never scrolls or bounces (#44, #48)', async ({ page }, testInfo) => {
  // Reported: in Safari (not the home screen app) page mode could be
  // scrolled, which slid the reader and left a gap. Chromium wouldn't
  // scroll an exactly-fitting page anyway, so this also checks the page is
  // set not to scroll or bounce at all.
  await page.goto('./')
  await upload(page)
  for (const mode of ['Word', 'Page'] as const) {
    if (mode === 'Page') {
      await openSettings(page)
      await page.getByRole('radio', { name: 'Page' }).click()
      await closeSettings(page)
    }
    for (const el of ['documentElement', 'body']) {
      const style = await page.evaluate(`(() => { const s = getComputedStyle(document.${el}); return s.overflowY + ' ' + s.overscrollBehaviorY })()`)
      expect(style, `${mode} mode, ${el}`).toBe('hidden none')
    }
    const box = (await page.locator('.stage').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 600)
    await page.mouse.wheel(0, -1200)
    if (testInfo.project.name === 'phone') {
      const cdp = await page.context().newCDPSession(page)
      const drag = async (from: number, to: number) => {
        const x = box.x + box.width / 2
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] })
        for (let i = 1; i <= 6; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + ((to - from) * i) / 6 }] })
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      }
      await drag(box.y + box.height - 20, box.y + 20)
      await drag(box.y + 20, box.y + box.height - 20)
    }
    await page.waitForTimeout(300)
    expect(await page.evaluate('document.scrollingElement.scrollTop'), mode).toBe(0)
    expect(await page.evaluate(`document.querySelector('.reader').getBoundingClientRect().top`), mode).toBe(0)
  }
})

for (const mode of ['Word', 'Page'] as const) {
  test(`${mode} mode: holding to read never selects text (#33)`, async ({ page }, testInfo) => {
    // Reported: "make it so hold doesn't select words". With Hold to read, a
    // long press reads; it must not start selecting or bring up the menu.
    await page.goto('./')
    await upload(page)
    await openSettings(page)
    if (mode === 'Page') await page.getByRole('radio', { name: 'Page' }).click()
    await page.getByRole('button', { name: 'More settings' }).click()
    await page.getByRole('radio', { name: 'Hold', exact: true }).click()
    await closeSettings(page)
    await page.waitForFunction('document.getAnimations().length === 0')
    const target = page.locator(mode === 'Page' ? '.page > .page-text [data-i]' : '.context [data-i]').nth(2)
    const box = (await target.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const selected = () => page.evaluate('String(window.getSelection())')

    // With a mouse: hold, drift across the text, let go.
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.move(x + 120, y, { steps: 6 })
    expect(await selected()).toBe('')
    await page.mouse.up()
    expect(await selected()).toBe('')

    // With a finger: a long press.
    if (testInfo.project.name === 'phone') {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await page.waitForTimeout(900)
      expect(await selected()).toBe('')
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(200)
      expect(await selected()).toBe('')
    }
  })
}

test('Escape closes any sheet or panel, wherever the focus is, and never the book (#39)', async ({ page }) => {
  // Reported with the definition sheet: Escape only worked with the focus
  // inside it. Here with focus moved away, Escape would otherwise reach the
  // reader and close the book.
  await page.goto('./')
  await upload(page)
  const blur = () => page.evaluate('document.activeElement?.blur()')
  const panels: [string, () => Promise<void>, string][] = [
    ['settings', () => openSettings(page), '.settings-menu'],
    ['bookmarks', () => page.getByRole('button', { name: 'Bookmarks', exact: true }).click(), '.search-panel'],
    ['search', () => page.getByRole('button', { name: 'Search', exact: true }).click(), '.search-panel'],
    ['read for', () => page.locator('.session-open').click(), '.session-menu'],
  ]
  for (const [name, open, selector] of panels) {
    await open()
    await expect(page.locator(selector), name).toBeVisible()
    await blur()
    await page.keyboard.press('Escape')
    await expect(page.locator(selector), name).toBeHidden()
    await expect(page.locator('.reader'), `${name}: still in the book`).toBeVisible()
  }
})

test("the ring around a tapped day in the stats calendar isn't clipped (#52)", async ({ page }) => {
  await page.goto('./')
  await page.evaluate(`new Promise((done) => {
    const pad = (n) => String(n).padStart(2, '0')
    const d = new Date()
    const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    const req = indexedDB.open('rsvp-reader')
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite')
      tx.objectStore('kv').put({ days: { [key]: { ms: 20 * 60000, words: 5000 } } }, 'stats')
      tx.oncomplete = () => done()
    }
  })`)
  await page.reload()
  await page.locator('.stats-toggle').click()
  const cells = page.locator('.stats-grid .stats-cell')
  // The last Saturday shown (bottom row) and today (last week).
  const today = new Date().getDay()
  for (const index of [(await cells.count()) - today - 2, (await cells.count()) - 1]) {
    await cells.nth(index).click()
    const fits = await page.evaluate(`(() => {
      const cell = document.querySelectorAll('.stats-grid .stats-cell')[${index}]
      const box = document.querySelector('.stats-scroll').getBoundingClientRect()
      const r = cell.getBoundingClientRect()
      const style = getComputedStyle(cell)
      const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
      return r.left - ring >= box.left && r.right + ring <= box.right && r.top - ring >= box.top && r.bottom + ring <= box.bottom
    })()`)
    expect(fits, `square ${index}`).toBe(true)
  }
})

test('page numbers and running headers from a printed book stay out of the text (#55)', async ({ page }) => {
  // Reported with an EPUB made from a printed book: a page number ("18")
  // showed up mid-sentence, and the sentence was split into two paragraphs
  // where the printed page ended.
  // Each printed page is a few hundred words; the number and the header
  // come at its end.
  const printed = 'The boards were wet and the sea was grey under the morning sky. '.repeat(10)
  const paragraphs = [
    `${printed}Eddie ran across the pier, the way children do, hoping running will turn to 17`,
    `flying. ${printed}It might have seemed ridiculous to anyone watching, this white-haired 18`,
    'THE FIVE PEOPLE YOU MEET IN HEAVEN',
    `maintenance worker, all alone, making like an airplane. ${printed}But the running boy is inside 19`,
    'THE FIVE PEOPLE YOU MEET IN HEAVEN',
    `every man, no matter how old he gets. ${printed}And then Eddie stopped running. He heard a voice, as if coming 20`,
    'THE FIVE PEOPLE YOU MEET IN HEAVEN',
    'through a megaphone.',
  ]
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  zip.file(
    'content.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Pier</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
  )
  zip.file(
    'c1.xhtml',
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>The End</h1>${paragraphs.map((p) => `<p>${p}</p>`).join('')}</body></html>`,
  )
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  await page.goto('./')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'pier.epub', mimeType: 'application/epub+zip', buffer })
  await expect(page.locator('.reader')).toBeVisible()

  const book = await page.evaluate(`new Promise((done) => {
    const req = indexedDB.open('rsvp-reader')
    req.onsuccess = () => {
      const all = req.result.transaction('kv').objectStore('kv').getAll()
      all.onsuccess = () => done(all.result.find((v) => v && Array.isArray(v.words)))
    }
  })`) as { words: string[]; paragraphEnds: number[] }
  const { words, paragraphEnds } = book
  const at = words.indexOf('white-haired')
  // The sentence carries straight on, in the same paragraph.
  expect(words.slice(at, at + 3)).toEqual(['white-haired', 'maintenance', 'worker,'])
  // Two paragraphs: the chapter's heading, and the text in one piece.
  expect(paragraphEnds).toEqual([1, words.length - 1])
  expect(words.filter((w) => /^\d+$/.test(w) || w === 'FIVE')).toEqual([])
})

test('a PDF keeps just its text, without its running header and page numbers (#55)', async ({ page, context }) => {
  // PDFs often draw the header and page number after the text, so they're
  // found by where they sit on the page, not where they come in the file.
  const sentences = Array.from({ length: 160 }, (_, i) => `Sentence number ${['one', 'two', 'three', 'four'][i % 4]} of the story goes on a while.`)
  const paragraphs = Array.from({ length: 20 }, (_, i) => sentences.slice(i * 8, i * 8 + 8).join(' '))
  const printer = await context.newPage()
  await printer.setContent(`<body style="margin: 0; font: 13pt serif">${paragraphs.map((p) => `<p>${p}</p>`).join('')}</body>`)
  const buffer = await printer.pdf({
    width: '4in',
    height: '6in',
    margin: { top: '0.7in', bottom: '0.7in', left: '0.5in', right: '0.5in' },
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size: 9px; width: 100%; text-align: center">THE LONG STORY</div>',
    footerTemplate: '<div style="font-size: 9px; width: 100%; text-align: center"><span class="pageNumber"></span></div>',
  })
  await printer.close()

  await page.goto('./')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'story.pdf', mimeType: 'application/pdf', buffer })
  await expect(page.locator('.reader')).toBeVisible()
  const book = (await page.evaluate(`new Promise((done) => {
    const req = indexedDB.open('rsvp-reader')
    req.onsuccess = () => {
      const all = req.result.transaction('kv').objectStore('kv').getAll()
      all.onsuccess = () => done(all.result.find((v) => v && Array.isArray(v.words)))
    }
  })`)) as { words: string[]; chapters: unknown[] }
  expect(book.chapters.length).toBeGreaterThan(3)
  expect(book.words).toEqual(paragraphs.join(' ').split(' '))
})

test('pressing Listen in the middle of a chapter plays from the sentence being read (#56)', async ({ page }) => {
  // On a slow connection, the recording used to start from a guess straight
  // away, the book jumped to the chapter's start while the file loaded, and
  // then the recording moved to wherever the book had got to.
  const archive = await mockArchive(page, { delay: 1500 })
  await page.goto('./')
  await upload(page, 'story.txt', LISTEN_BOOK)
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await page.getByRole('button', { name: /Story A\. Writer · LibriVox/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.search-backdrop')).toBeHidden()

  // Partway into chapter 2, which hasn't been lined up yet.
  await page.getByLabel('Jump to chapter').selectOption({ label: 'Chapter 2' })
  await page.locator('.context [data-i]', { hasText: /^Lanterns\s*$/ }).click()
  await expect(page.locator('.word')).toHaveText('Lanterns')
  await page.getByRole('button', { name: 'Listen from here', exact: true }).click()

  // It lines the chapter up first, keeping the reader's place…
  await expect(page.getByRole('button', { name: 'Stop lining up' })).toBeVisible()
  await expect(page.locator('.word')).toHaveText('Lanterns')
  // …then plays from exactly where that sentence is read.
  await expect(page.getByRole('button', { name: 'Pause audiobook' })).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.listen-time')).toHaveText(new RegExp(`^${clock(20 + chapterTwo.starts[SECOND.findIndex((s) => s.startsWith('Lanterns'))])}`))
  await expect(page.locator('.word')).toHaveText('Lanterns')
  // The chapter downloaded for lining up is the one played: it isn't downloaded twice.
  expect(archive.downloads.filter((name) => name === 'story_02_64kb.mp3')).toHaveLength(1)
})

test('an excerpt of a chapter, like the demo’s, lines up with the full recording of it (#56)', async ({ page }) => {
  // The book has only the first four sentences of chapter 2; the recording
  // reads all nine. Assuming it read only the excerpt made the narrator
  // impossibly slow, and listening started minutes away from the text.
  await mockArchive(page)
  const excerpt = ['Chapter 1', '', 'The rabbit ran across the field. Alice followed it to a hole under the hedge.', '', 'Chapter 2', '', SECOND.slice(0, 4).join(' ')].join('\n')
  await page.goto('./')
  await upload(page, 'story.txt', excerpt)
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await page.getByRole('button', { name: /Story A\. Writer · LibriVox/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.search-backdrop')).toBeHidden()
  await page.getByLabel('Jump to chapter').selectOption({ label: 'Chapter 2' })
  await page.locator('.context [data-i]', { hasText: /^Marmalade\s*$/ }).click()
  await page.getByRole('button', { name: 'Listen from here', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause audiobook' })).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.listen-time')).toHaveText(new RegExp(`^${clock(20 + chapterTwo.starts[2])}`))
  await expect(page.locator('.word')).toHaveText('Marmalade')
})

test('a whole audiobook file of one’s own lines up wherever the reader is, however long it is (#56)', async ({ page }, testInfo) => {
  // A file over 60 MB (any audiobook of a few hours) was too big to line up,
  // so listening started from a guess, minutes away from the text.
  test.setTimeout(120000)
  const book = longAudiobook(33)
  // Far into the file: in its third ten-minute part, so the ones before it are lined up first.
  const target = book.sentences.findIndex((s) => s.start > 20 * 60)
  const marked = book.text.replace(book.sentences[target].text, `Xylophone ${book.sentences[target].text}`)
  const file = testInfo.outputPath('audiobook.wav')
  writeFileSync(file, book.audio)
  await page.route('https://archive.org/**', (route) => route.fulfill({ json: { response: { docs: [] } } }))
  // Where playback is sent to start, as the player seeks there (the time shown moves on as it plays).
  await page.addInitScript(`
    window.seeks = []
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if (!this.dataset.watched) {
        this.dataset.watched = '1'
        this.addEventListener('seeked', () => window.seeks.push(this.currentTime))
      }
      return play.call(this)
    }
  `)
  await page.goto('./')
  await upload(page, 'long.txt', marked)
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await page.locator('.audio-file input').setInputFiles(file)
  await expect(page.locator('.audio-source-name')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.search-backdrop')).toBeHidden()

  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByLabel('Search text').fill('Xylophone')
  await page.locator('.search-results button').first().click()
  await expect(page.locator('.word')).toHaveText('Xylophone')
  await page.getByRole('button', { name: 'Listen from here', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause audiobook' })).toBeVisible({ timeout: 90000 })
  // It starts where the sentence is read (the made-up narrator doesn't say the marker word), not from a guess.
  const start = book.sentences[target].start
  const seeked = await page.evaluate(() => (globalThis as unknown as { seeks: number[] }).seeks.at(-1))
  expect(Math.abs(seeked! - start)).toBeLessThan(1)
})

test('finding a recording leaves out other books of a similar name and flags a dramatization (#56)', async ({ page }) => {
  // For "Rebecca", the Archive offered "Rebecca of Sunnybrook Farm" (another
  // book) and an 84-minute radio play, neither of which can follow the text.
  await page.route('https://archive.org/advancedsearch.php**', (route) =>
    route.fulfill({
      json: {
        response: {
          docs: [
            { identifier: 'sunnybrook', title: 'Rebecca of Sunnybrook Farm', creator: 'Kate Douglas Wiggin' },
            { identifier: 'rebecca_radio', title: 'Rebecca', creator: 'Daphne du Maurier' },
          ],
        },
      },
    }),
  )
  await page.route('https://archive.org/metadata/rebecca_radio', (route) =>
    route.fulfill({ json: { files: [{ name: 'rebecca.mp3', format: 'VBR MP3', title: 'Rebecca', length: '84:00' }] } }),
  )
  // A full-length novel: far longer than 84 minutes to read aloud.
  const sentence = 'Last night I dreamt I went to Manderley again, and the drive wound away in front of me.'
  const text = ['Chapter 1', '', Array.from({ length: 1400 }, () => sentence).join(' ')].join('\n')
  await page.goto('./')
  await upload(page, 'Rebecca by Daphne du Maurier.txt', text)
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  const result = page.locator('.audio-results li')
  await expect(result).toHaveCount(1)
  await expect(result).toContainText('Daphne du Maurier')
  await expect(result).toContainText('abridged or dramatized')
  await expect(page.getByText('Rebecca of Sunnybrook Farm')).toHaveCount(0)
})

test('while listening, the guide’s pause stops only the text and the audio button stops only the recording (#56)', async ({ page }) => {
  // Both used to stop both, so there was no way to hold the text still while
  // the recording played on, or to read on while the recording was paused.
  await mockArchive(page)
  await page.goto('./')
  await upload(page, 'story.txt', LISTEN_BOOK)
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await page.getByRole('button', { name: /Story A\. Writer · LibriVox/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.search-backdrop')).toBeHidden()
  await page.getByLabel('Jump to chapter').selectOption({ label: 'Chapter 2' })
  await page.getByRole('button', { name: 'Listen from here', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause audiobook' })).toBeVisible({ timeout: 15000 })
  const word = () => page.locator('.word').textContent()
  const time = () => page.locator('.listen-time').textContent()

  // The guide's pause: the text holds still, the recording plays on.
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  const held = await word()
  const at = await time()
  await expect.poll(time, { timeout: 5000 }).not.toBe(at)
  expect(await word()).toBe(held)
  await expect(page.getByRole('button', { name: 'Pause audiobook' })).toBeVisible()

  // Play again: the text catches up with the recording and follows it.
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(word, { timeout: 5000 }).not.toBe(held)

  // The audio button: the recording stops, and the text reads on by itself.
  await page.getByRole('button', { name: 'Pause audiobook' }).click()
  await expect(page.getByRole('button', { name: 'Listen from here', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  const reading = await word()
  await expect.poll(word, { timeout: 5000 }).not.toBe(reading)
})

test('a linked YouTube video’s hidden player is clipped away, not just transparent (#56)', async ({ page }) => {
  // On iPhones video is drawn on a layer of its own that ignores opacity, so
  // the invisible player's dark gradients showed through as a shadow.
  await mockArchive(page)
  await page.route('https://www.youtube.com/**', (route) => route.abort())
  await page.goto('./')
  await upload(page, 'story.txt', LISTEN_BOOK)
  await page.getByRole('button', { name: 'Listen', exact: true }).click()
  await page.getByLabel('Audiobook link').fill('https://youtu.be/dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.keyboard.press('Escape')
  const host = page.locator('.audio-video')
  await expect(host).toHaveCount(1)
  // Still the size YouTube needs to play, but nothing of it can be drawn.
  await expect(host).toHaveCSS('width', '200px')
  await expect(host).toHaveCSS('clip-path', 'inset(50%)')
  await expect(host).toHaveCSS('overflow', 'hidden')
})

test('on a phone, bottom sheets cast no shadow below them (#61)', async ({ page }, testInfo) => {
  // Reported on iPhone with Read for, Search and Bookmarks: their drop shadow
  // fell below the sheet, into the strip above Safari's toolbar, as a smudge.
  // The page dimmed behind a sheet already sets it apart.
  test.skip(testInfo.project.name !== 'phone', 'Sheets are for phones')
  await page.goto('./')
  await upload(page)
  const sheets: [string, () => Promise<unknown>, string][] = [
    ['Read for', () => page.locator('.session-open').click(), '.session-menu'],
    ['Bookmarks', () => page.getByRole('button', { name: 'Bookmarks', exact: true }).click(), '[role=dialog][aria-label="Bookmarks"]'],
    ['Search', () => page.getByRole('button', { name: 'Search', exact: true }).click(), '[role=dialog][aria-label="Search in book"]'],
    ['Settings', () => openSettings(page), '.settings-menu'],
  ]
  for (const [name, open, selector] of sheets) {
    await open()
    await expect(page.locator(selector)).toBeVisible()
    // Each shadow layer that shows: how far it reaches below the sheet (its downward offset plus blur).
    const below = await page.evaluate(`(() => {
      const shadow = getComputedStyle(document.querySelector('${selector.replace(/'/g, "\\\\'")}')).boxShadow
      if (shadow === 'none') return []
      return shadow.split(/,(?![^(]*\\))/).filter((l) => !/rgba\\([^)]*,\\s*0\\)|transparent/.test(l)).map((layer) => {
        const n = layer.replace(/rgba?\\([^)]*\\)/, '').trim().split(/\\s+/).filter((p) => p !== 'inset').map(parseFloat)
        return (n[1] || 0) + (n[2] || 0)
      })
    })()`)
    expect(below, name).toEqual((below as number[]).map(() => 0))
    await page.keyboard.press('Escape')
    await expect(page.locator(selector)).toBeHidden()
  }
})

test("on a phone, Safari's status bar is the same grey as the page dimmed behind a sheet, in every theme (#61)", async ({ page }, testInfo) => {
  // Reported on iPhone: with Read for, Search or Bookmarks open, the status
  // bar was a darker grey than the dimmed page. Safari colours the bar by
  // laying the layer that dims the page over the page background, which was
  // already dimmed, so the bar came out dimmed twice. The background now
  // stays as it is under those sheets (the settings sheet, which dims the
  // page with a shadow instead, still dims it), and the layer is there at
  // once rather than fading in, so Safari sees it at full strength.
  test.skip(testInfo.project.name !== 'phone', 'Sheets are for phones')
  await page.goto('./')
  await upload(page)
  const sheets: [string, () => Promise<unknown>, string][] = [
    ['Read for', () => page.locator('.session-open').click(), '.session-menu'],
    ['Bookmarks', () => page.getByRole('button', { name: 'Bookmarks', exact: true }).click(), '[role=dialog][aria-label="Bookmarks"]'],
    ['Search', () => page.getByRole('button', { name: 'Search', exact: true }).click(), '[role=dialog][aria-label="Search in book"]'],
    ['Settings', () => openSettings(page), '.settings-menu'],
  ]
  for (const theme of ['Light', 'Sepia', 'Dark']) {
    await openSettings(page)
    const more = page.getByRole('button', { name: 'More settings' })
    if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click()
    await page.getByRole('radio', { name: theme, exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.settings-menu')).toBeHidden()
    for (const [name, open, selector] of sheets) {
      const where = `${theme}, ${name}`
      await open()
      // As it first appears: the layers at the top of the screen, and whether any is still fading in.
      const first = (await page.evaluate(`(() => {
        const sheet = document.querySelector('${selector.replace(/'/g, "\\\\'")}')
        const layers = document.elementsFromPoint(2, 2).filter((el) => !sheet.contains(el) && getComputedStyle(el).position === 'fixed')
        return layers.some((el) => el.getAnimations().some((a) => a.effect?.getKeyframes().some((k) => 'opacity' in k)))
      })()`)) as boolean
      expect(first, `${where}: the dimming layer fades in`).toBe(false)
      await page.waitForFunction(`document.getAnimations().every((a) => a.playState !== 'running')`)
      const bar = (await page.evaluate(`(() => {
        const sheet = document.querySelector('${selector.replace(/'/g, "\\\\'")}')
        const probe = document.createElement('div')
        document.body.append(probe)
        const rgba = (c) => {
          probe.style.color = c
          const v = getComputedStyle(probe).color
          const n = v.match(/[\\d.]+/g).map(Number)
          const srgb = v.startsWith('color(')
          const [r, g, b] = srgb ? n.slice(0, 3).map((x) => x * 255) : n.slice(0, 3)
          return [r, g, b, srgb ? (n[3] ?? 1) : (n[3] ?? 1)]
        }
        // What Safari shows: the page background, with any coloured fixed layer at the top laid over it.
        let [r, g, b] = rgba(getComputedStyle(document.documentElement).backgroundColor)
        const layers = document.elementsFromPoint(2, 2).filter((el) => !sheet.contains(el) && getComputedStyle(el).position === 'fixed').reverse()
        for (const el of layers) {
          const [lr, lg, lb, la] = rgba(getComputedStyle(el).backgroundColor)
          r = r * (1 - la) + lr * la
          g = g * (1 - la) + lg * la
          b = b * (1 - la) + lb * la
        }
        const [dr, dg, db] = rgba('var(--page-dimmed)')
        probe.remove()
        return { bar: [r, g, b].map(Math.round), dimmed: [dr, dg, db].map(Math.round) }
      })()`)) as { bar: number[]; dimmed: number[] }
      expect(bar.bar.every((v, k) => Math.abs(v - bar.dimmed[k]) <= 2), `${where}: the bar is rgb(${bar.bar}), the dimmed page rgb(${bar.dimmed})`).toBe(true)
      await page.keyboard.press('Escape')
      await expect(page.locator(selector)).toBeHidden()
    }
  }
})

test("on a phone, Safari's toolbar takes its colour from the sheet, not the dimmed page (#61)", async ({ page }, testInfo) => {
  // Reported on iPhone: under Bookmarks and Search, Safari's bottom toolbar
  // was the grey of the dimmed page, under Settings the sheet's colour.
  // Safari colours the toolbar from the fixed layer at the bottom edge of the
  // screen: the settings sheet is fixed itself, while Bookmarks and Search
  // sat inside the fixed, dimmed backdrop, so that was the layer it found.
  test.skip(testInfo.project.name !== 'phone', 'Sheets are for phones')
  await page.goto('./')
  await upload(page)
  const sheets: [string, () => Promise<unknown>, string][] = [
    ['Read for', () => page.locator('.session-open').click(), '.session-menu'],
    ['Bookmarks', () => page.getByRole('button', { name: 'Bookmarks', exact: true }).click(), '[role=dialog][aria-label="Bookmarks"]'],
    ['Search', () => page.getByRole('button', { name: 'Search', exact: true }).click(), '[role=dialog][aria-label="Search in book"]'],
    ['Settings', () => openSettings(page), '.settings-menu'],
  ]
  for (const [name, open, selector] of sheets) {
    await open()
    await expect(page.locator(selector)).toBeVisible()
    await page.waitForFunction(`document.getAnimations().every((a) => a.playState !== 'running')`)
    const bottom = await page.evaluate(`(() => {
      const fixed = document.elementsFromPoint(innerWidth / 2, innerHeight - 1).find((el) => getComputedStyle(el).position === 'fixed')
      return fixed === document.querySelector('${selector.replace(/'/g, "\\\\'")}') ? 'the sheet' : fixed?.className
    })()`)
    expect(bottom, `${name}: the fixed layer at the bottom of the screen`).toBe('the sheet')
    await page.keyboard.press('Escape')
    await expect(page.locator(selector)).toBeHidden()
  }
})

test('on a phone, with the keyboard up, the search sheet runs down to it (#61)', async ({ page }, testInfo) => {
  // Reported on iPhone: between the search sheet and the keyboard, around
  // Safari's floating address bar, a strip of dimmed page showed. The sheet
  // now carries on down behind it.
  test.skip(testInfo.project.name !== 'phone', 'Sheets are for phones')
  await page.goto('./')
  await upload(page)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const sheet = page.locator('[role=dialog][aria-label="Search in book"]')
  await expect(sheet).toBeVisible()
  const below = (await page.evaluate(`(() => {
    const el = document.querySelector('[role=dialog][aria-label="Search in book"]')
    const after = getComputedStyle(el, '::after')
    return { content: after.content, height: parseFloat(after.height), colour: after.backgroundColor, sheet: getComputedStyle(el).backgroundColor }
  })()`)) as { content: string; height: number; colour: string; sheet: string }
  expect(below.content).not.toBe('none')
  expect(below.height).toBeGreaterThan(0)
  expect(below.colour).toBe(below.sheet)
})
