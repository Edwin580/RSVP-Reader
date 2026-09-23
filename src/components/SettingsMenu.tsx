import { useEffect, useRef } from 'react'
import type { WordTiming } from '../lib/rsvp'
import type { Settings } from '../lib/storage'

interface Props {
  settings: Settings
  onSettings: (settings: Settings) => void
  onClose: () => void
}

const MIN_FONT = 28
const MAX_FONT = 112
const FONT_STEP = 4

const TIMINGS: { value: WordTiming; label: string; hint: string }[] = [
  { value: 'natural', label: 'Natural', hint: 'Longer words stay a little longer' },
  { value: 'even', label: 'Even', hint: 'Every word gets the same time' },
]

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['← →', 'Word'],
  ['⇧ ← →', 'Sentence'],
  ['↑ ↓', 'Speed'],
  ['/', 'Search'],
  ['Esc', 'Library'],
]

export function SettingsMenu({ settings, onSettings, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const target = e.target as Element
      if (!ref.current?.contains(target) && !target.closest?.('.aa')) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])

  const setFont = (fontSize: number) =>
    onSettings({ ...settings, fontSize: Math.max(MIN_FONT, Math.min(MAX_FONT, fontSize)) })
  const timingHint = TIMINGS.find((t) => t.value === settings.wordTiming)?.hint

  return (
    <div className="popover" ref={ref} role="dialog" aria-label="Reading settings">
      <div className="setting">
        <span className="label muted">Text size</span>
        <div className="stepper">
          <button type="button" className="icon-button" onClick={() => setFont(settings.fontSize - FONT_STEP)} aria-label="Smaller text">
            <span style={{ fontSize: '0.8em' }}>A</span>
          </button>
          <span className="stepper-value">{settings.fontSize}</span>
          <button type="button" className="icon-button" onClick={() => setFont(settings.fontSize + FONT_STEP)} aria-label="Larger text">
            <span style={{ fontSize: '1.2em' }}>A</span>
          </button>
        </div>
      </div>

      <div className="setting setting-stack">
        <span className="label muted">Word timing</span>
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
  )
}
