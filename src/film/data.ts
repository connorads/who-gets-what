/**
 * The release data the film draws from, read through `SiteData`: one value
 * per constituency for each benefit family and each per-person measure the
 * film shows, for one fiscal year. The server renders stills from it and the
 * browser bakes grain buffers from it, so both show the same numbers.
 */
import { BenefitFamily } from '#/domain/benefit.ts'
import { dataPath, priceFactors } from '#/domain/contract.ts'
import { MetricId, type Denominator } from '#/domain/measure.ts'
import { FiscalYear } from '#/domain/period.ts'
import type { SiteData } from '#/data/site-data.ts'
import type { Bounds } from '#/viz/layout/projection.ts'
import type { GroupId, Script } from './script.ts'

export interface FilmArea {
  readonly code: string
  readonly name: string
  readonly slug: string
  readonly nation: string
  readonly q: number
  readonly r: number
  readonly lon: number
  readonly lat: number
}

export interface FilmData {
  readonly period: FiscalYear
  readonly priceBase: string
  /** Nominal pounds in `period` to real pounds at `priceBase` prices (GDP deflator). */
  readonly realFactor: number
  readonly areas: readonly FilmArea[]
  /** The level's bounds, and the release's sprite with one path per area (`#a{index}`), for the map still. */
  readonly mapBounds: Bounds
  readonly mapSprite: string
  readonly families: readonly BenefitFamily[]
  /** Nominal spending, family-major: family `f`, area `i` at `f * areas + i`. NaN for none. */
  readonly familySpend: Float32Array
  /** Every benefit per resident, nominal. */
  readonly perResident: Float32Array
  readonly pensionerPerAged66Plus: Float32Array
  readonly workingAgePerAged16To64: Float32Array
  /** Share of residents aged 66 and over, 0 to 1. */
  readonly shareAged66Plus: Float32Array
  /** Group of each family, parallel to `families`. */
  readonly familyGroup: readonly GroupId[]
}

const LEVEL = 'constituency'

/** Read the film's data for the script's fiscal year. */
export async function loadFilmData(site: SiteData, script: Script): Promise<FilmData> {
  const period = FiscalYear.parse(script.period)
  const [catalogue, areasMeta] = await Promise.all([site.catalogue(), site.areas(LEVEL)])
  const factor = priceFactors(catalogue).get(period)?.realGdp
  if (factor === undefined) throw new Error(`No price factor for ${period}`)
  const n = areasMeta.areas.length
  const column = async (metric: string, denominator: Denominator): Promise<Float32Array> => {
    const read = await site.series(LEVEL, MetricId.parse(metric), denominator)
    if (!read.ok) throw new Error(`Film needs ${metric}/${denominator}: ${read.error.path}`)
    const index = read.value.header.periods.indexOf(period)
    if (index < 0) throw new Error(`${metric}/${denominator} has no ${period}`)
    return read.value.values.slice(index * n, (index + 1) * n)
  }
  const families = BenefitFamily.options
  const [familyColumns, perResident, pensionerPerResident, pensionerPer66, workingAge] =
    await Promise.all([
      Promise.all(families.map((family) => column(`spend-${family}`, 'total'))),
      column('spend-total', 'per-resident'),
      column('spend-pensioner', 'per-resident'),
      column('spend-pensioner', 'per-aged-66-plus'),
      column('spend-working-age', 'per-aged-16-64'),
    ])
  const familySpend = new Float32Array(families.length * n)
  familyColumns.forEach((values, f) => familySpend.set(values, f * n))
  // Pensioner spending per resident over per person aged 66+ is the 66+ share of residents.
  const shareAged66Plus = Float32Array.from(
    pensionerPerResident,
    (value, i) => value / (pensionerPer66[i] ?? Number.NaN),
  )
  const groupOf = new Map(
    script.groups.flatMap((group) => group.families.map((family) => [family, group.id] as const)),
  )
  return {
    period,
    priceBase: catalogue.priceBase,
    realFactor: factor,
    areas: areasMeta.areas.map((area) => ({
      code: area.code,
      name: area.name,
      slug: area.slug,
      nation: area.nation,
      q: area.hex.q,
      r: area.hex.r,
      lon: area.centroid[0],
      lat: area.centroid[1],
    })),
    mapBounds: areasMeta.bounds,
    mapSprite: dataPath.mapSprite(areasMeta.release, LEVEL),
    families,
    familySpend,
    perResident,
    pensionerPerAged66Plus: pensionerPer66,
    workingAgePerAged16To64: workingAge,
    shareAged66Plus,
    familyGroup: families.map((family) => {
      const group = groupOf.get(family)
      if (group === undefined) throw new Error(`${family} is in no film group`)
      return group
    }),
  }
}
