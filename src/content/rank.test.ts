import { describe, expect, it } from 'vitest'
import { hasPulledRelease, pulledSiteData } from '#/data/testing/file-source.ts'
import { findMetric } from '#/domain/contract.ts'
import type { GeoLevel } from '#/domain/geography.ts'
import { buildRankView } from './rank.ts'

describe.runIf(hasPulledRelease)('rank tables over the pulled release', () => {
  const data = pulledSiteData()

  async function view(
    metricId: string,
    denominator: 'total' | 'per-resident' | 'per-aged-66-plus',
  ) {
    const catalogue = await data.catalogue()
    const metric = findMetric(catalogue, metricId)
    if (metric === undefined) throw new Error(metricId)
    const levels = await Promise.all(
      (['constituency', 'local-authority'] as const).map(async (level) => {
        const bundle = await data.series(level, metric.id, denominator)
        if (!bundle.ok) throw new Error('no bundle')
        return { areas: await data.areas(level), gb: await data.gb(level), bundle: bundle.value }
      }),
    )
    return buildRankView(catalogue, metric, denominator, levels)
  }

  async function dossierRanks(level: GeoLevel, metric: string, denominator: string) {
    const { areas } = await data.areas(level)
    const dossiers = await Promise.all(areas.map((area) => data.dossier(level, area.code)))
    return new Map(
      dossiers.flatMap((read) => {
        if (!read.ok) return []
        const facts = read.value.facts.find((entry) => entry.metric === metric)
        const j = facts?.denominators.findIndex((entry) => entry === denominator) ?? -1
        return [[read.value.area.code, j < 0 ? null : (facts?.ranks[j] ?? null)] as const]
      }),
    )
  }

  it.each([
    ['spend-total', 'per-resident'],
    ['spend-pensioner', 'per-aged-66-plus'],
    ['claimants-pension-credit', 'per-aged-66-plus'],
    ['income-tax', 'total'],
  ] as const)(
    'agrees with every dossier rank for %s %s',
    { timeout: 30_000 },
    async (metric, denominator) => {
      const ranking = await view(metric, denominator)
      const expected = await Promise.all(
        ranking.tables.map((table) => dossierRanks(table.level, metric, denominator)),
      )

      expect(
        ranking.tables.map((table) => new Map(table.rows.map((row) => [row.code, row.rank]))),
      ).toEqual(expected)
    },
  )

  it('marks the ten highest and lowest ranks and keeps unranked rows last', async () => {
    const ranking = await view('spend-total', 'per-resident')
    const table = ranking.tables[0]

    expect(table?.rows.filter((row) => row.band === 'highest')).toHaveLength(10)
    expect(table?.rows.filter((row) => row.band === 'lowest')).toHaveLength(10)
    expect(table?.rows.at(-1)?.rank ?? null).toBeNull()
  })

  it('names no denominator for a ratio, which divides by nothing', async () => {
    const ratio = await view('spend-to-income-tax', 'total')
    const money = await view('income-tax', 'total')

    expect(ratio.title).toBe(ratio.metric.shortLabel)
    expect(ratio.denominatorText).toBe('')
    expect(money.title).toBe('Income tax, total')
  })
})
