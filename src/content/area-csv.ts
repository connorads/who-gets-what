/** The rows of an area page's "every figure" tables, for its CSV download. */
import {
  factRows,
  findMetric,
  type AreaDossier,
  type Catalogue,
  type GbValues,
} from '#/domain/contract.ts'
import type { Basis } from '#/domain/measure.ts'
import type { FigureRow } from './csv.ts'
import { factorsOf, inBases } from './figures.ts'

/** Every published figure of one area, the rows of its "every figure" tables, in `basis`. */
export function areaRows(
  dossier: Pick<AreaDossier, 'level' | 'area' | 'facts'>,
  gb: GbValues,
  catalogue: Catalogue,
  basis: Basis,
): readonly FigureRow[] {
  const factors = factorsOf(catalogue)
  return factRows(dossier.facts, gb).flatMap((fact) => {
    const metric = findMetric(catalogue, fact.metric)
    if (metric === undefined) return []
    const convert = (value: number | null) =>
      value === null ? null : inBases(value, metric, fact.period, factors)[basis]
    return [
      {
        level: dossier.level,
        code: dossier.area.code,
        name: dossier.area.name,
        metric,
        denominator: fact.denominator,
        period: fact.period,
        value: convert(fact.value),
        rank: fact.rank,
        rankOf: fact.rankOf,
        gbValue: convert(fact.gbValue),
        flags: fact.flags,
      },
    ]
  })
}
