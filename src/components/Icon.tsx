const PATHS = {
  play: 'M8 5.5v13a.5.5 0 0 0 .77.42l10-6.5a.5.5 0 0 0 0-.84l-10-6.5A.5.5 0 0 0 8 5.5Z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  back: 'M14.5 6 8.5 12l6 6',
  forward: 'M9.5 6l6 6-6 6',
  sentenceBack: 'M12 6 6 12l6 6M18 6l-6 6 6 6',
  sentenceForward: 'M6 6l6 6-6 6M12 6l6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronDown: 'M7 10l5 5 5-5',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM20 20l-4.8-4.8',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  upload: 'M12 16V4m-5 5 5-5 5 5M5 20h14',
  plus: 'M12 5v14M5 12h14',
  clock: 'M12 7.5V12l3 2M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z',
  bookmark: 'M7 4.5h10v15l-5-3.8-5 3.8z',
  bookmarkFilled: 'M7 4.5h10v15l-5-3.8-5 3.8z',
} as const

export type IconName = keyof typeof PATHS

const FILLED = new Set<IconName>(['play', 'pause', 'bookmarkFilled'])

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const filled = FILLED.has(name)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      // Filled shapes get a matching stroke too, so their corners are as round as the outlined icons'.
      stroke={filled && name !== 'bookmarkFilled' ? 'none' : 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
