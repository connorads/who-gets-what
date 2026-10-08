import { describe, expect, it } from 'vitest'
import { ValueFlag } from './measure.ts'
import { rankedAreas, rankValues } from './rank.ts'

describe('rankValues', () => {
  it('ranks highest first, shares ties and leaves small populations unranked', () => {
    const values = [5, 9, Number.NaN, 9, 1, 7]
    const flags = [0, 0, 0, 0, ValueFlag.smallPopulation, 0]
    const ranking = rankValues(values, flags)

    expect(Array.from(ranking.ranks)).toEqual([4, 1, 0, 1, 0, 3])
    expect(ranking.rankOf).toBe(4)
    expect(rankedAreas(ranking)).toEqual([1, 3, 5, 0])
  })

  it('leaves partial-coverage and suppressed values unranked, as the dossiers do', () => {
    const ranking = rankValues(
      [5, 9, 7, 3],
      [0, ValueFlag.partialCoverage | ValueFlag.harmonised, ValueFlag.suppressed, 0],
    )

    expect(Array.from(ranking.ranks)).toEqual([1, 0, 0, 2])
    expect(ranking.rankOf).toBe(2)
  })
})
