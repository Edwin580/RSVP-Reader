import { useEffect } from 'react'

export interface ToastMessage {
  text: string
  tone: 'ok' | 'error'
  /** Distinguishes repeats of the same text, so each one restarts the timer. */
  id: number
}

const SHOW_MS = 4000
const ERROR_MS = 7000

/** A short message that slides up at the bottom of the screen and goes away by itself (or when tapped). */
export function Toast({ message, onDone }: { message: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(onDone, message.tone === 'error' ? ERROR_MS : SHOW_MS)
    return () => window.clearTimeout(timer)
  }, [message, onDone])

  if (!message) return null
  return (
    <div
      key={message.id}
      className={`toast${message.tone === 'error' ? ' is-error' : ''}`}
      role={message.tone === 'error' ? 'alert' : 'status'}
      onClick={onDone}
    >
      {message.text}
    </div>
  )
}
