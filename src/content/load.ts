/**
 * Reads what one area's views need through the `SiteData` port, and resolves
 * a `{code}-{slug}` URL segment to its canonical form.
 */
import type { SiteData } from '#/data/site-data.ts'
import { periodSlice } from '#/domain/bundle.ts'
import type { AreaMeta } from '#/domain/contract.ts'
import { GeoLevel, parseAreaCode, type AreaCode } from '#/domain/geography.ts'
import { MetricId } from '#/domain/measure.ts'
import { buildAreaView, type AreaView } from './area.ts'

const SPEND_TOTAL = MetricId.parse('spend-total')

export type AreaLookup =
  | {
      readonly kind: 'found'
      readonly level: GeoLevel
      readonly area: AreaMeta
      readonly canonical: boolean
    }
  | { readonly kind: 'not-found' }

/**
 * Find the area a URL segment names by its code. The slug is cosmetic:
 * `canonical` is false when it or the code's case differs, and the route redirects.
 */
export async function lookupArea(
  data: SiteData,
  levelParam: string,
  segment: string,
): Promise<AreaLookup> {
  const level = GeoLevel.safeParse(levelParam)
  if (!level.success) return { kind: 'not-found' }
  const dash = segment.indexOf('-')
  const code = parseAreaCode(
    (dash === -1 ? segment : segment.slice(0, dash)).toUpperCase(),
    level.data,
  )
  if (!code.ok) return { kind: 'not-found' }
  const { areas } = await data.areas(level.data)
  const area = areas.find((entry) => entry.code === code.value)
  if (area === undefined) return { kind: 'not-found' }
  return {
    kind: 'found',
    level: level.data,
    area,
    canonical: segment === `${area.code}-${area.slug}`,
  }
}

export async function loadAreaView(
  data: SiteData,
  level: GeoLevel,
  code: AreaCode,
): Promise<AreaView | undefined> {
  const [catalogue, gb, areas, dossier, spend, spread] = await Promise.all([
    data.catalogue(),
    data.gb(level),
    data.areas(level),
    data.dossier(level, code),
    data.series(level, SPEND_TOTAL, 'per-resident'),
    modelSpread(data, level),
  ])
  if (!dossier.ok) return undefined
  if (!spend.ok) throw new Error(`Release has no spend-total per-resident bundle for ${level}`)
  return buildAreaView({
    dossier: dossier.value,
    catalogue,
    gb,
    areas,
    spendPerResident: spend.value,
    modelSpread: spread,
  })
}

/**
 * For each modelled comparison, the 98th percentile of the size of the
 * differences across the level, so a chart's edge reads against other areas
 * and one outlier does not shrink every bar.
 */
export async function modelSpread(
  data: SiteData,
  level: GeoLevel,
): Promise<ReadonlyMap<string, number>> {
  const catalogue = await data.catalogue()
  const entries = await Promise.all(
    catalogue.models.expected.fits.map(async (fit) => {
      const bundle = await data.series(level, fit.metric, fit.denominator)
      if (!bundle.ok) return [] as const
      const sizes = Array.from(
        periodSlice(bundle.value, bundle.value.header.periods.length - 1).values,
      )
        .filter((value) => !Number.isNaN(value))
        .map(Math.abs)
        .toSorted((a, b) => a - b)
      const at = sizes[Math.floor(0.98 * (sizes.length - 1))]
      return at === undefined ? [] : [[fit.metric, at] as const]
    }),
  )
  return new Map(entries.flat())
}
