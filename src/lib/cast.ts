import type { NameInfo } from './names'

/**
 * The people and places a reader has met so far: only names whose first
 * appearance is at or before `position`, counted up to there, so the list
 * never gives away who turns up later.
 */
export interface CastMember {
  name: string
  /** Mentions so far. */
  count: number
  first: number
  /** The latest mention at or before the reading position. */
  latest: number
}

export function castSoFar(names: NameInfo[], position: number, limit = 24): CastMember[] {
  const cast: CastMember[] = []
  for (const n of names) {
    if (n.indices[0] > position) continue
    let count = 0
    while (count < n.indices.length && n.indices[count] <= position) count++
    cast.push({ name: n.name, count, first: n.indices[0], latest: n.indices[count - 1] })
  }
  return cast.sort((a, b) => b.count - a.count || a.first - b.first).slice(0, limit)
}

/**
 * Join names that almost always appear side by side ("Van" + "Hopper",
 * "Monte" + "Carlo") into one, so the list reads like people and places
 * rather than fragments. For the list only; pacing keeps the single words.
 */
export function joinCompoundNames(names: NameInfo[], share = 0.8): NameInfo[] {
  const byStart = new Map<number, number>()
  names.forEach((n, k) => n.indices.forEach((i) => byStart.set(i, k)))
  const absorbed = new Set<number>()
  const joined: NameInfo[] = []
  names.forEach((a, k) => {
    if (absorbed.has(k)) return
    // The name that most often comes right after this one.
    const next = new Map<number, number>()
    for (const i of a.indices) {
      const b = byStart.get(i + 1)
      if (b !== undefined && b !== k) next.set(b, (next.get(b) ?? 0) + 1)
    }
    let best = -1
    let together = 0
    for (const [b, n] of next) if (n > together) [best, together] = [b, n]
    const b = names[best]
    if (b && !absorbed.has(best) && together >= a.indices.length * share && together >= b.indices.length * share) {
      absorbed.add(best)
      joined.push({ name: `${a.name} ${b.name}`, indices: a.indices.filter((i) => byStart.get(i + 1) === best) })
    } else {
      joined.push(a)
    }
  })
  return joined.filter((n) => n.indices.length > 0)
}
