import { useEffect, useState } from 'react'

/**
 * The part of the screen actually visible, which on phones shrinks when the
 * keyboard opens. iOS keeps the page's full height and scrolls it instead,
 * so a panel sized to 100% drifts and scrolls behind the keyboard; sizing it
 * to the visible area keeps it put.
 */
export function useVisualViewport(): { top: number; height: number } | null {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setBox({ top: vv.offsetTop, height: vv.height })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return box
}
