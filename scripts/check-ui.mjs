// Checks the code against the UI rules (docs/ui-rules.md) that can be read
// from the source: colours from the theme, the shared shadows and corners,
// and pop-ups that drag away on phones. The browser tests in
// e2e/ui-rules.e2e.ts check the rest in the running app.
//
// Run with `npm run check:ui`; CI runs it on every pull request.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const problems = []
const report = (file, line, message) => problems.push(`${file}:${line}  ${message}`)
const lineAt = (text, index) => text.slice(0, index).split('\n').length

// A raw colour: #abc, #aabbcc(dd), rgb()/rgba()/hsl()/hsla().
const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i
// A line that may break a rule, with the reason given after it.
const ALLOWED = /ui-allow:/

// ——— CSS ———
for (const file of ['src/index.css']) {
  const source = readFileSync(file, 'utf8')
  // Blank out comments, keeping line numbers.
  const css = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
  const lines = source.split('\n')
  for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/gi)) {
    const [, property, raw] = m
    const value = raw.trim()
    const line = lineAt(css, m.index)
    if (ALLOWED.test(lines[line - 1] ?? '')) continue
    // Tokens are defined with raw values; everything else uses them (rule 1).
    if (property.startsWith('--')) continue
    // Masks are alpha, not colour.
    if (RAW_COLOR.test(value) && !/^(-webkit-)?mask/.test(property)) {
      report(file, line, `${property}: a raw colour (${value}); use a theme token (rule 1)`)
    }
    // Shadows: none, or made of tokens (rule 2).
    if (property === 'box-shadow' && !/^(none|var\(--[\w-]+\)(\s*,\s*var\(--[\w-]+\))*)$/.test(value)) {
      report(file, line, `box-shadow: ${value}; use --shadow, --ring or another shadow token (rule 2)`)
    }
    if ((property === 'text-shadow' || (property === 'filter' && /drop-shadow/.test(value))) && value !== 'none') {
      report(file, line, `${property}: ${value}; no other shadows (rule 2)`)
    }
    // Corners: tokens, 0, circles or pills (rule 3).
    if (property.endsWith('radius')) {
      const ok = value.split(/\s+/).every((part) => /^(0|50%|999px|var\(--radius[\w-]*\))$/.test(part))
      if (!ok) report(file, line, `${property}: ${value}; use a --radius token, 0, 50% or 999px (rule 3)`)
    }
  }
}

// ——— Components ———
const components = 'src/components'
for (const name of readdirSync(components).filter((f) => f.endsWith('.tsx'))) {
  const file = join(components, name)
  const source = readFileSync(file, 'utf8')
  source.split('\n').forEach((text, k) => {
    // Colours belong in the theme (rule 1); a few fixed ones are marked.
    const code = text.replace(/\/\/.*$/, '')
    if (RAW_COLOR.test(code) && !ALLOWED.test(text)) report(file, k + 1, 'a raw colour; use a theme token (rule 1)')
  })
  // Every pop-up drags away on a phone, by a grab handle (rule 4).
  if (/role="dialog"/.test(source)) {
    if (!/useSheetDrag\(/.test(source)) report(file, lineAt(source, source.search(/role="dialog"/)), 'a pop-up without useSheetDrag (rule 4)')
    if (!/sheet-handle/.test(source)) report(file, lineAt(source, source.search(/role="dialog"/)), 'a pop-up without a sheet-handle (rule 4)')
  }
}

if (problems.length) {
  console.error(`UI rules (docs/ui-rules.md): ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log('UI rules: all good')
