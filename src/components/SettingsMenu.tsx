import { useEffect } from 'react'
import type { WordTiming } from '../lib/rsvp'
import type { Accent, ReadingFont, ReadingMode, Settings, Theme } from '../lib/storage'

interface Props {
  settings: Settings
  onSettings: (settings: Settings) => void
  /** Animating out; the reader unmounts it shortly after. */
  closing?: boolean
  onClose: () => void
}

const MIN_SCALE = 0.6
const MAX_SCALE = 1.6
const SCALE_STEP = 0.1

const TIMINGS: { value: WordTiming; label: string; hint: string }[] = [
  { value: 'natural', label: 'Natural', hint: 'Longer words stay a little longer' },
  { value: 'even', label: 'Even', hint: 'Every word gets the same time' },
]

const MODES: { value: ReadingMode; label: string; hint: string }[] = [
  { value: 'word', label: 'Word', hint: 'One word at a time in a fixed spot' },
  { value: 'page', label: 'Page', hint: 'Full pages with a marker that follows along' },
]

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Dark' },
]

const FONT_OPTIONS: { value: ReadingFont; label: string }[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
]

/** Swatch colours; the CSS (data-accent) holds the light and dark shades used in the reader. */
const ACCENT_OPTIONS: { value: Accent; label: string; color: string }[] = [
  { value: 'red', label: 'Red', color: '#c23b25' },
  { value: 'blue', label: 'Blue', color: '#2d5bb5' },
  { value: 'green', label: 'Green', color: '#2f7a45' },
  { value: 'purple', label: 'Purple', color: '#7a45b8' },
]

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← →', 'Word'],
  ['⇧ ← →', 'Sentence'],
  ['↑ ↓', 'Speed'],
  ['/', 'Search'],
  ['B', 'Bookmark this spot'],
  ['M', 'Word / page mode'],
  ['PgUp PgDn', 'Page (page mode)'],
  ['Esc', 'Library'],
]

export function SettingsMenu({ settings, onSettings, closing, onClose }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const setScale = (textScale: number) =>
    onSettings({ ...settings, textScale: Math.round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, textScale)) * 10) / 10 })
  const timingHint = TIMINGS.find((t) => t.value === settings.wordTiming)?.hint

  return (
    <>
      {/* Catches the tap that closes the menu, so it can't also reach the
          reader underneath (where a tap plays, pauses or jumps to a word). */}
      <div className={`popover-backdrop${closing ? ' is-closing' : ''}`} aria-hidden="true" onClick={onClose} />
      <div className={`popover${closing ? ' is-closing' : ''}`} role="dialog" aria-label="Reading settings">
        <div className="setting setting-stack">
          <span className="setting-name">Reading mode</span>
          <div className="segmented" role="radiogroup" aria-label="Reading mode">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={settings.mode === m.value}
                onClick={() => onSettings({ ...settings, mode: m.value })}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="hint">{MODES.find((m) => m.value === settings.mode)?.hint}</span>
        </div>

        {settings.mode === 'page' && (
          <div className="setting-group">
            <label className="switch-row">
              <span>Highlight the current word</span>
              <input
                type="checkbox"
                role="switch"
                checked={settings.pageHighlight}
                onChange={(e) => onSettings({ ...settings, pageHighlight: e.target.checked })}
              />
            </label>
            <label className="switch-row">
              <span>Pacer line</span>
              <input
                type="checkbox"
                role="switch"
                checked={settings.pacer}
                onChange={(e) => onSettings({ ...settings, pacer: e.target.checked })}
              />
            </label>
            {!settings.pageHighlight && !settings.pacer && (
              <span className="hint">Pages still turn on their own at your speed.</span>
            )}
          </div>
        )}

        <div className="setting">
          <span className="setting-name">Text size</span>
          <div className="stepper">
            <button type="button" className="icon-button" onClick={() => setScale(settings.textScale - SCALE_STEP)} aria-label="Smaller text">
              <span style={{ fontSize: '0.8em' }}>A</span>
            </button>
            <span className="stepper-value">{Math.round(settings.textScale * 100)}%</span>
            <button type="button" className="icon-button" onClick={() => setScale(settings.textScale + SCALE_STEP)} aria-label="Larger text">
              <span style={{ fontSize: '1.2em' }}>A</span>
            </button>
          </div>
        </div>

        <div className="setting setting-stack">
          <span className="setting-name">Word timing</span>
          <div className="segmented" role="radiogroup" aria-label="Word timing">
            {TIMINGS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={settings.wordTiming === t.value}
                onClick={() => onSettings({ ...settings, wordTiming: t.value })}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="hint">{timingHint}</span>
        </div>

        <div className="setting setting-stack">
          <span className="setting-name">Theme</span>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={settings.theme === t.value}
                onClick={() => onSettings({ ...settings, theme: t.value })}
              >
                {t.label}
              </button>
            ))}
          </div>
          {settings.theme === 'system' && <span className="hint">Follows your device’s light or dark setting</span>}
        </div>

        <div className="setting">
          <span className="setting-name">Font</span>
          <div className="segmented" role="radiogroup" aria-label="Font">
            {FONT_OPTIONS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                className={f.value === 'serif' ? 'serif' : undefined}
                aria-checked={settings.font === f.value}
                onClick={() => onSettings({ ...settings, font: f.value })}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <span className="setting-name">Focus color</span>
          <div className="swatches" role="radiogroup" aria-label="Focus color">
            {ACCENT_OPTIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                role="radio"
                className="swatch"
                aria-checked={settings.accent === a.value}
                aria-label={a.label}
                title={a.label}
                style={{ '--swatch': a.color } as React.CSSProperties}
                onClick={() => onSettings({ ...settings, accent: a.value })}
              />
            ))}
          </div>
        </div>

        <dl className="shortcuts">
          {SHORTCUTS.map(([key, action]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  )
}
