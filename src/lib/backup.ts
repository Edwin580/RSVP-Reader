import type { BookMeta, Progress } from './types'

/**
 * A backup is every stored entry (library list, books, progress, …) as
 * key/value pairs, so anything added to storage later is backed up too.
 */
export const BACKUP_FORMAT = 'rsvp-reader-backup'

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: 1
  exportedAt: number
  entries: [string, unknown][]
}

export function createBackup(entries: [string, unknown][], now = Date.now()): Backup {
  return { format: BACKUP_FORMAT, version: 1, exportedAt: now, entries }
}

export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file isn’t a backup from this app.')
  }
  const backup = data as Partial<Backup> | null
  if (backup?.format !== BACKUP_FORMAT || !Array.isArray(backup.entries)) {
    throw new Error('This file isn’t a backup from this app.')
  }
  if (backup.version !== 1) throw new Error('This backup was made by a newer version of the app. Reload and try again.')
  const entries = backup.entries.filter((e): e is [string, unknown] => Array.isArray(e) && typeof e[0] === 'string')
  return { ...(backup as Backup), entries }
}

const LIBRARY_KEY = 'library'

/**
 * Work out what to write when restoring `backup` on top of what's stored.
 * Nothing on this device is lost: books missing here are added to the
 * library, the most recently updated reading position wins, and anything
 * else is only written where nothing is stored yet.
 */
export function mergeBackup(current: Map<string, unknown>, backup: Backup): { writes: [string, unknown][]; added: number } {
  const writes: [string, unknown][] = []
  let added = 0
  for (const [key, value] of backup.entries) {
    const existing = current.get(key)
    if (key === LIBRARY_KEY) {
      const mine = Array.isArray(existing) ? (existing as BookMeta[]) : []
      const theirs = Array.isArray(value) ? (value as BookMeta[]) : []
      const ids = new Set(mine.map((b) => b.id))
      const merged = mine.map((b) => {
        const other = theirs.find((t) => t.id === b.id)
        return other ? { ...b, addedAt: Math.min(b.addedAt, other.addedAt) } : b
      })
      const fresh = theirs.filter((b) => !ids.has(b.id))
      added = fresh.length
      writes.push([key, [...merged, ...fresh]])
    } else if (key.startsWith('progress:')) {
      const mine = existing as Progress | undefined
      const theirs = value as Progress
      if (!mine || (theirs?.updatedAt ?? 0) > mine.updatedAt) writes.push([key, value])
    } else if (existing === undefined) {
      writes.push([key, value])
    }
  }
  return { writes, added }
}
