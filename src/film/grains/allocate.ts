/**
 * Turn one year of spending into grains. Each benefit family gets
 * round(total / unit) grains, shared between constituencies by the largest
 * remainder method, so every grain belongs to one family and one area and the
 * counts add up exactly. Grains are stored in wall order: by group, then by
 * family (largest first within its group), then by area.
 */
import type { FilmData } from '../data.ts'
import type { GroupId } from '../script.ts'
import { random, seedOf } from './random.ts'

export interface GrainSet {
  /** Real pounds per grain at the film's price base. */
  readonly unit: number
  readonly count: number
  /** Index into `FilmData.families`, per grain. */
  readonly family: Uint8Array
  /** Area index in the level's order, per grain. */
  readonly area: Uint16Array
  /** A fixed random key per grain, 0 to 65535: fall order and guess layers. */
  readonly key: Uint16Array
  /** Family indices in wall order, and each one's first grain and grain count. */
  readonly blocks: readonly GrainBlock[]
}

export interface GrainBlock {
  readonly family: number
  readonly group: GroupId
  readonly start: number
  readonly count: number
}

/** Share `count` whole units in proportion to `weights` (largest remainder; ties go to the lower index). */
export function apportion(weights: ArrayLike<number>, count: number): Uint32Array {
  const n = weights.length
  const out = new Uint32Array(n)
  let total = 0
  for (let i = 0; i < n; i++) {
    const w = weights[i] ?? 0
    if (Number.isFinite(w) && w > 0) total += w
  }
  if (total === 0 || count === 0) return out
  const remainders: { readonly i: number; readonly r: number }[] = []
  let given = 0
  for (let i = 0; i < n; i++) {
    const w = weights[i] ?? 0
    const quota = Number.isFinite(w) && w > 0 ? (w / total) * count : 0
    const whole = Math.floor(quota)
    out[i] = whole
    given += whole
    remainders.push({ i, r: quota - whole })
  }
  remainders.sort((a, b) => b.r - a.r || a.i - b.i)
  for (let k = 0; k < count - given; k++) {
    const entry = remainders[k % n]
    if (entry !== undefined) out[entry.i] = (out[entry.i] ?? 0) + 1
  }
  return out
}

const GROUP_ORDER: readonly GroupId[] = ['pensioners', 'disability-carers', 'working-age-housing']

export function allocateGrains(data: FilmData, unit: number, seed = 'where-it-lands'): GrainSet {
  const n = data.areas.length
  const families = data.families.map((_, f) => {
    const real = Float64Array.from(data.familySpend.subarray(f * n, (f + 1) * n), (value) =>
      Number.isFinite(value) ? value * data.realFactor : 0,
    )
    const total = real.reduce((sum, value) => sum + value, 0)
    return { f, real, total, group: data.familyGroup[f] ?? 'working-age-housing' }
  })
  const ordered = families.toSorted(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || b.total - a.total || a.f - b.f,
  )
  const perArea = ordered.map((family) => apportion(family.real, Math.round(family.total / unit)))
  const count = perArea.reduce((sum, counts) => sum + counts.reduce((s, c) => s + c, 0), 0)
  const family = new Uint8Array(count)
  const area = new Uint16Array(count)
  const blocks: GrainBlock[] = []
  let at = 0
  ordered.forEach((entry, k) => {
    const counts = perArea[k] ?? new Uint32Array(n)
    const start = at
    for (let i = 0; i < n; i++) {
      const c = counts[i] ?? 0
      family.fill(entry.f, at, at + c)
      area.fill(i, at, at + c)
      at += c
    }
    blocks.push({ family: entry.f, group: entry.group, start, count: at - start })
  })
  const next = random(seedOf(`${seed}|${unit}`))
  const key = Uint16Array.from({ length: count }, () => Math.floor(next() * 65_536))
  return { unit, count, family, area, key, blocks }
}

/** Grains per group, in group order. */
export function groupCounts(grains: GrainSet): ReadonlyMap<GroupId, number> {
  const counts = new Map<GroupId, number>()
  for (const block of grains.blocks)
    counts.set(block.group, (counts.get(block.group) ?? 0) + block.count)
  return counts
}
