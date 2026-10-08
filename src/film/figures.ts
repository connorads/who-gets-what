/**
 * Every number the film states, computed from `FilmData`. Narration quotes
 * some of them as words, so `figureValue` resolves a beat's `checks` and a
 * test compares the two; on-screen figures are formatted from here directly.
 */
import type { BenefitFamily } from '#/domain/benefit.ts'
import type { FilmData } from './data.ts'
import type { GroupId } from './script.ts'

export interface FilmFigures {
  /** Real pounds at the price base, summed over every area. */
  readonly total: number
  readonly byFamily: ReadonlyMap<BenefitFamily, number>
  readonly byGroup: ReadonlyMap<GroupId, number>
  /** Real pounds per area, every family. */
  readonly byArea: Float64Array
  readonly areaCount: number
  /** Pearson correlation of spending per resident with latitude and with the 66+ share. */
  readonly correlationLatitude: number
  readonly correlationAged66Plus: number
  /** Areas in the top ten of both skylines. */
  readonly skylineTop10Overlap: number
}

/** Pearson's r over the pairs where both values are finite. */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const pairs: [number, number][] = []
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? Number.NaN
    const y = b[i] ?? Number.NaN
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y])
  }
  if (pairs.length < 2) return Number.NaN
  const mean = (k: 0 | 1) => pairs.reduce((sum, pair) => sum + pair[k], 0) / pairs.length
  const mx = mean(0)
  const my = mean(1)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}

/** Indices of the `k` highest finite values, highest first; ties keep area order. */
export function topIndices(values: ArrayLike<number>, k: number): readonly number[] {
  return Array.from({ length: values.length }, (_, i) => i)
    .filter((i) => Number.isFinite(values[i] ?? Number.NaN))
    .toSorted((a, b) => (values[b] ?? 0) - (values[a] ?? 0) || a - b)
    .slice(0, k)
}

export function filmFigures(data: FilmData): FilmFigures {
  const n = data.areas.length
  const byFamily = new Map<BenefitFamily, number>()
  const byGroup = new Map<GroupId, number>()
  const byArea = new Float64Array(n)
  data.families.forEach((family, f) => {
    let sum = 0
    for (let i = 0; i < n; i++) {
      const value = data.familySpend[f * n + i] ?? Number.NaN
      if (!Number.isFinite(value)) continue
      const real = value * data.realFactor
      sum += real
      byArea[i] = (byArea[i] ?? 0) + real
    }
    byFamily.set(family, sum)
    const group = data.familyGroup[f]
    if (group !== undefined) byGroup.set(group, (byGroup.get(group) ?? 0) + sum)
  })
  const total = [...byFamily.values()].reduce((sum, value) => sum + value, 0)
  const pensionerTop = new Set(topIndices(data.pensionerPerAged66Plus, 10))
  return {
    total,
    byFamily,
    byGroup,
    byArea,
    areaCount: n,
    correlationLatitude: correlation(
      data.perResident,
      data.areas.map((area) => area.lat),
    ),
    correlationAged66Plus: correlation(data.perResident, data.shareAged66Plus),
    skylineTop10Overlap: topIndices(data.workingAgePerAged16To64, 10).filter((i) =>
      pensionerTop.has(i),
    ).length,
  }
}

/** A group's share of the total, 0 to 1. */
export function groupShare(figures: FilmFigures, group: GroupId): number {
  return (figures.byGroup.get(group) ?? 0) / figures.total
}

/**
 * The value a script check names, in the units the narration speaks:
 * billions of pounds, percentages, counts or correlations.
 */
export function figureValue(figures: FilmFigures, id: string): number | undefined {
  const [kind = '', key = ''] = id.split(':')
  const find = <K, V>(map: ReadonlyMap<K, V>): V | undefined =>
    [...map].find(([k]) => String(k) === key)?.[1]
  const resolvers: Readonly<Record<string, () => number | undefined>> = {
    'total-real-billions': () => figures.total / 1e9,
    'family-real-billions': () => {
      const value = find(figures.byFamily)
      return value === undefined ? undefined : value / 1e9
    },
    'group-share-percent': () => {
      const value = find(figures.byGroup)
      return value === undefined ? undefined : (value / figures.total) * 100
    },
    'constituency-count': () => figures.areaCount,
    correlation: () =>
      key === 'latitude'
        ? figures.correlationLatitude
        : key === 'aged-66-plus'
          ? figures.correlationAged66Plus
          : undefined,
    'skyline-top10-overlap': () => figures.skylineTop10Overlap,
  }
  return resolvers[kind]?.()
}

/** Decimal places a narrated number was written with, so a check rounds the same way. */
export function decimalsOf(value: number): number {
  const text = String(value)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}
