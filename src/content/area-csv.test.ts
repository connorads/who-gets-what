import { describe, expect, it } from 'vitest'
import { hasPulledRelease, pulledSiteData } from '#/data/testing/file-source.ts'
import { factRows } from '#/domain/contract.ts'
import { AreaCode } from '#/domain/geography.ts'
import { areaRows } from './area-csv.ts'

const data = pulledSiteData()
const ALDERSHOT = AreaCode.parse('E14001063')

async function inputs() {
  const [catalogue, read, gb] = await Promise.all([
    data.catalogue(),
    data.dossier('constituency', ALDERSHOT),
    data.gb('constituency'),
  ])
  if (!read.ok) throw new Error('no Aldershot dossier')
  return { catalogue, dossier: read.value, gb }
}

describe.runIf(hasPulledRelease)('area CSV rows over the pulled release', () => {
  it('has one row per published figure, with its rank and flags', async () => {
    const { catalogue, dossier, gb } = await inputs()
    const facts = factRows(dossier.facts, gb)
    const rows = areaRows(dossier, gb, catalogue, 'nominal')

    expect(rows).toHaveLength(facts.length)
    expect(rows.every((row) => row.code === 'E14001063' && row.name === 'Aldershot')).toBe(true)
    expect(rows.map((row) => [row.rank, row.flags])).toEqual(
      facts.map((fact) => [fact.rank, fact.flags]),
    )
    expect(rows.map((row) => row.value)).toEqual(facts.map((fact) => fact.value))
  })

  it('converts money to the chosen basis and leaves counts alone', async () => {
    const { catalogue, dossier, gb } = await inputs()
    const cash = areaRows(dossier, gb, catalogue, 'nominal')
    const real = areaRows(dossier, gb, catalogue, 'real-gdp')
    const factor = catalogue.fiscalYears.find((year) => year.id === '2024-25')?.realGdp

    const money = real.findIndex((row) => row.metric.unit === 'gbp' && row.period === '2024-25')
    expect(real[money]?.value).toBeCloseTo((cash[money]?.value ?? 0) * (factor ?? 0), 6)
    const count = real.findIndex((row) => row.metric.unit === 'people')
    expect(real[count]?.value).toBe(cash[count]?.value)
  })
})
