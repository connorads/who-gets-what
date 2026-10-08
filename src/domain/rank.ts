/**
 * Ranks as the dossiers publish them: 1 is the highest value in Great Britain,
 * equal values share a rank, and an area with no value or an `UNRANKED` flag
 * (small population, partial coverage, suppressed) is not ranked.
 */
import { UNRANKED } from './measure.ts'

export interface Ranking {
  /** Rank per area in area order; 0 means not ranked. */
  readonly ranks: Int32Array
  /** Number of areas ranked. */
  readonly rankOf: number
}

export function isRankable(value: number, flags: number): boolean {
  return Number.isFinite(value) && (flags & UNRANKED) === 0
}

export function rankValues(values: ArrayLike<number>, flags: ArrayLike<number>): Ranking {
  const ranked: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (isRankable(values[i] ?? Number.NaN, flags[i] ?? 0)) ranked.push(i)
  }
  ranked.sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0) || a - b)
  const ranks = new Int32Array(values.length)
  ranked.forEach((area, position) => {
    const previous = ranked[position - 1]
    ranks[area] =
      previous !== undefined && values[previous] === values[area]
        ? (ranks[previous] ?? position + 1)
        : position + 1
  })
  return { ranks, rankOf: ranked.length }
}

/** Area indices of the ranked areas, highest first. */
export function rankedAreas(ranking: Ranking): readonly number[] {
  return Array.from(ranking.ranks.keys())
    .filter((area) => (ranking.ranks[area] ?? 0) > 0)
    .toSorted((a, b) => (ranking.ranks[a] ?? 0) - (ranking.ranks[b] ?? 0) || a - b)
}
