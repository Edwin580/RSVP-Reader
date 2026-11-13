import type { ReadingStats } from './stats'
import type { BookMeta, Bookmark, Progress } from './types'

/**
 * A backup is every stored entry (library list, books, progress, …) as
 * key/value pairs, so anything added to storage later is backed up too.
 */
// From the app's old name; kept so older backup files still restore.
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
const STATS_KEY = 'stats'
const isStats = (value: unknown): value is ReadingStats =>
  typeof value === 'object' && value !== null && typeof (value as ReadingStats).days === 'object' && (value as ReadingStats).days !== null

/**
 * Work out what to write when restoring `backup` on top of what's stored.
 * Nothing on this device is lost: books missing here are added to the
 * library, a book here without a cover takes the backup's, the most recently
 * updated reading position wins, bookmarks and reading statistics from both
 * are kept, and anything else is only written where nothing is stored yet.
 * Restoring the same backup twice changes nothing the second time.
 */
export function mergeBackup(
  current: Map<string, unknown>,
  backup: Backup,
): { writes: [string, unknown][]; added: number; updated: number } {
  const writes: [string, unknown][] = []
  let added = 0
  /** Reading positions moved forward to the backup's (for books already here). */
  let updated = 0
  for (const [key, value] of backup.entries) {
    const existing = current.get(key)
    if (key === LIBRARY_KEY) {
      const mine = Array.isArray(existing) ? (existing as BookMeta[]) : []
      const theirs = Array.isArray(value) ? (value as BookMeta[]) : []
      const ids = new Set(mine.map((b) => b.id))
      const merged = mine.map((b) => {
        const other = theirs.find((t) => t.id === b.id)
        if (!other) return b
        // Marked as read on either device is read.
        const readAt = b.readAt ?? other.readAt
        return {
          ...b,
          addedAt: Math.min(b.addedAt, other.addedAt),
          ...(!b.cover && other.cover && { cover: other.cover }),
          ...(readAt !== undefined && { readAt }),
        }
      })
      const fresh = theirs.filter((b) => !ids.has(b.id))
      added = fresh.length
      writes.push([key, [...merged, ...fresh]])
    } else if (key.startsWith('progress:')) {
      const mine = existing as Progress | undefined
      const theirs = value as Progress
      if (!mine || (theirs?.updatedAt ?? 0) > mine.updatedAt) {
        writes.push([key, value])
        if (mine) updated++
      }
    } else if (key.startsWith('bookmarks:') && Array.isArray(existing) && Array.isArray(value)) {
      const mine = existing as Bookmark[]
      const spots = new Set(mine.map((b) => b.index))
      const fresh = (value as Bookmark[]).filter((b) => typeof b?.index === 'number' && !spots.has(b.index))
      if (fresh.length) writes.push([key, [...mine, ...fresh].sort((a, b) => a.index - b.index)])
    } else if (key === STATS_KEY && isStats(existing) && isStats(value)) {
      // The same day on both is the same reading (a backup of this device)
      // or another device's; the longer one is kept, never the sum, so
      // restoring twice doesn't count anything twice.
      const days = { ...existing.days }
      let changed = false
      for (const [day, theirs] of Object.entries(value.days)) {
        if ((theirs?.ms ?? 0) > (days[day]?.ms ?? 0)) {
          days[day] = theirs
          changed = true
        }
      }
      if (changed) writes.push([key, { ...existing, days }])
    } else if (existing === undefined) {
      writes.push([key, value])
    }
  }
  return { writes, added, updated }
}

/** File name for a backup made on `date`, e.g. chapter-backup-2026-09-25.json. */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `chapter-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
}

/** A short summary of what a restore did, for the confirmation message. */
export function restoreSummary(added: number, updated: number): string {
  const books = added === 1 ? '1 book' : `${added} books`
  const places = updated === 1 ? '1 reading position' : `${updated} reading positions`
  if (added && updated) return `Restored ${books} and updated ${places}.`
  if (added) return `Restored ${books}.`
  if (updated) return `Updated ${places} from the backup.`
  return 'Everything in this backup is already here.'
}
