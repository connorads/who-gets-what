/** Plain-English names for contract values, shared by pages, tables, share cards and the explorer. */
import type { GeoLevel, Nation } from '#/domain/geography.ts'
import type { Basis, ProvenanceKind } from '#/domain/measure.ts'

export const LEVEL_LABEL = {
  constituency: {
    one: 'constituency',
    many: 'constituencies',
    title: 'Constituency',
    titleMany: 'Constituencies',
  },
  'local-authority': {
    one: 'local authority',
    many: 'local authorities',
    title: 'Local authority',
    titleMany: 'Local authorities',
  },
} as const satisfies Record<
  GeoLevel,
  { one: string; many: string; title: string; titleMany: string }
>

export const NATION_LABEL = {
  england: 'England',
  wales: 'Wales',
  scotland: 'Scotland',
} as const satisfies Record<Nation, string>

export const BASES: readonly Basis[] = ['real-gdp', 'real-cpi', 'nominal']

/** The price basis beside every money figure; `priceBase` is the catalogue's year. */
export function basisLabel(basis: Basis, priceBase: string): string {
  if (basis === 'nominal') return 'cash terms, not adjusted for inflation'
  return basis === 'real-gdp' ? `${priceBase} prices` : `${priceBase} prices, using CPI inflation`
}

/** The price basis where a page or view first names it, with what the prices mean. */
export function basisExplained(basis: Basis, priceBase: string): string {
  if (basis === 'nominal') return basisLabel(basis, priceBase)
  return `${basisLabel(basis, priceBase)}, adjusted for inflation so that years can be compared`
}

export const BASIS_CHOICE = {
  'real-gdp': 'Adjusted for inflation (GDP deflator)',
  'real-cpi': 'Adjusted for inflation (CPI)',
  nominal: 'Cash, not adjusted',
} as const satisfies Record<Basis, string>

export const PROVENANCE_LABEL = {
  measured: 'Published',
  modelled: 'Estimated',
  apportioned: 'Shared out',
  survey: 'Survey estimate',
} as const satisfies Record<ProvenanceKind, string>

export const PROVENANCE_NOTE = {
  measured: 'Published for this area by the source.',
  modelled: 'Estimated, for example from the number of people claiming and their average payment.',
  apportioned: 'Shared out from a larger area by population.',
  survey: 'Estimated from a sample survey, so it has a margin of error.',
} as const satisfies Record<ProvenanceKind, string>

/** `/area/{level}/{code}-{slug}`. */
export function areaPath(level: GeoLevel, area: { code: string; slug: string }): string {
  return `/area/${level}/${area.code}-${area.slug}`
}

/** `/rank/{metric}/{denom}`, with the level as a search param when it is not the default. */
export function rankPath(metric: string, denominator: string, level?: GeoLevel): string {
  const base = `/rank/${metric}/${denominator}`
  return level === 'local-authority' ? `${base}?level=local-authority` : base
}
