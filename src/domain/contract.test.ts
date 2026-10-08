import { describe, expect, it } from 'vitest'
import {
  AreaDossier,
  AreasMeta,
  CaveatId,
  Catalogue,
  GbValues,
  Manifest,
  factRows,
  parseAreaDossier,
  parseAreasMeta,
  parseCatalogue,
  parseGbValues,
  parseManifest,
  seriesPoints,
  type ContractViolation,
  type MetricDefinition,
} from './contract.ts'
import { AreaCode } from './geography.ts'
import { FiscalYear } from './period.ts'
import type { Result } from './result.ts'
import { readFixture } from './testing/fixtures.ts'

const catalogue = Catalogue.parse(readFixture('catalogue.json'))
const areas = AreasMeta.parse(readFixture('areas-constituency.json'))
const dossier = AreaDossier.parse(readFixture('area-constituency-S14000021.json'))
const manifest = Manifest.parse(readFixture('manifest.json'))
const gb = GbValues.parse(readFixture('gb-constituency.json'))

const problemsOf = (result: Result<unknown, ContractViolation>): readonly string[] =>
  result.ok ? [] : result.error.problems

const withMetric = (index: number, patch: Partial<MetricDefinition>): Catalogue => ({
  ...catalogue,
  metrics: catalogue.metrics.map((metric, i) => (i === index ? { ...metric, ...patch } : metric)),
})

describe('contract fixtures', () => {
  it('parse cleanly', () => {
    expect(problemsOf(parseManifest(readFixture('manifest.json')))).toEqual([])
    expect(problemsOf(parseCatalogue(readFixture('catalogue.json')))).toEqual([])
    expect(problemsOf(parseAreasMeta(readFixture('areas-constituency.json')))).toEqual([])
    expect(problemsOf(parseAreaDossier(readFixture('area-constituency-S14000021.json')))).toEqual(
      [],
    )
  })

  it('reject unknown keys, so a renamed field cannot vanish silently', () => {
    expect(parseAreaDossier({ ...dossier, netContributor: true }).ok).toBe(false)
  })
})

describe('parseCatalogue', () => {
  it('requires price factors for every fiscal year of a money metric', () => {
    const problems = problemsOf(parseCatalogue(withMetric(0, { periods: ['2022-23', '2023-24'] })))

    expect(problems).toContain('metrics.spend-pensioner.periods: no price factors for 2022-23')
  })

  it('requires the price base year to have factors of exactly 1', () => {
    const problems = problemsOf(
      parseCatalogue({ ...catalogue, priceBase: FiscalYear.parse('2024-25') }),
    )

    expect(problems).toContain('fiscalYears: priceBase year must have factors of exactly 1')
  })

  it('rejects per-head denominators on a ratio', () => {
    const problems = problemsOf(parseCatalogue(withMetric(0, { unit: 'ratio' })))

    expect(problems).toContain(
      'metrics.spend-pensioner.denominators: a ratio takes no per-head denominator',
    )
  })

  it('rejects periods of the wrong kind', () => {
    const problems = problemsOf(parseCatalogue(withMetric(1, { periods: ['2025-26'] })))

    expect(problems).toContain('metrics.claimants-pension-credit.periods: not all month periods')
  })

  it('rejects references to undeclared caveats', () => {
    const problems = problemsOf(
      parseCatalogue(withMetric(0, { caveats: [CaveatId.parse('no-such-caveat')] })),
    )

    expect(problems).toContain('metrics.spend-pensioner.caveats: unknown no-such-caveat')
  })
})

describe('catalogue decomposition', () => {
  const [family] = catalogue.decomposition.families
  const withFamily = (patch: object): unknown => ({
    ...catalogue,
    decomposition: {
      ...catalogue.decomposition,
      families: family === undefined ? [] : [{ ...family, ...patch }],
    },
  })

  it('requires from to precede to', () => {
    expect(problemsOf(parseCatalogue(withFamily({ from: '2026-05' })))).toContain(
      'decomposition.state-pension: from must precede to',
    )
  })

  it('requires price factors for both months', () => {
    expect(problemsOf(parseCatalogue(withFamily({ from: '2020-05' })))).toContain(
      'decomposition.state-pension: no price factors for 2020-05',
    )
  })
})

describe('catalogue models', () => {
  const [fit] = catalogue.models.expected.fits

  it('requires each fit to publish a modelled metric', () => {
    const fits =
      fit === undefined ? [] : [{ ...fit, metric: catalogue.metrics[0]?.id ?? fit.metric }]
    const broken = {
      ...catalogue,
      models: { ...catalogue.models, expected: { ...catalogue.models.expected, fits } },
    }

    expect(problemsOf(parseCatalogue(broken))).toContain(
      'models.expected.spend-pensioner: not a modelled metric',
    )
  })

  it('requires the actual metric to offer the modelled denominator', () => {
    const fits = fit === undefined ? [] : [{ ...fit, denominator: 'per-aged-0-15' as const }]
    const broken = {
      ...catalogue,
      models: { ...catalogue.models, expected: { ...catalogue.models.expected, fits } },
    }

    expect(problemsOf(parseCatalogue(broken))).toContain(
      'models.expected.spend-pensioner-vs-model.actualMetric: does not offer per-aged-0-15',
    )
  })
})

describe('dossier neighbours', () => {
  const [first, second] = dossier.neighbours.areas

  it('reject the area itself, the other level and a list not nearest first', () => {
    if (first === undefined || second === undefined) throw new Error('fixture needs two neighbours')
    const broken = {
      ...dossier,
      neighbours: {
        missingInputs: [],
        areas: [
          second,
          first,
          { ...first, code: dossier.area.code },
          { ...first, code: AreaCode.parse('S12000011'), distance: 2 },
        ],
      },
    }

    expect(problemsOf(parseAreaDossier(broken))).toEqual([
      'neighbours: an area is not its own neighbour',
      'neighbours: areas must be the same level',
      'neighbours: nearest first',
    ])
  })
})

describe('dossier expected values', () => {
  it('require the residual to be actual minus expected', () => {
    const broken = {
      ...dossier,
      expected: dossier.expected.map((entry) => Object.assign({}, entry, { residual: 1 })),
    }

    expect(problemsOf(parseAreaDossier(broken))).toEqual([
      'expected.spend-pensioner-vs-model: residual must be actual minus expected',
    ])
  })
})

describe('parseAreasMeta', () => {
  it('requires the published order to be ascending by code', () => {
    const problems = problemsOf(parseAreasMeta({ ...areas, areas: areas.areas.toReversed() }))

    expect(problems).toContain('areas: codes must be unique and ascending')
  })

  it('rejects an area code from the other level', () => {
    const [first, ...rest] = areas.areas
    const moved =
      first === undefined ? [] : [{ ...first, code: AreaCode.parse('E06000001') }, ...rest]

    expect(problemsOf(parseAreasMeta({ ...areas, areas: moved }))).toContain(
      'areas.0.code: not a constituency code',
    )
  })
})

describe('parseAreaDossier', () => {
  it('allows representation and election results on constituencies only', () => {
    const council = {
      ...dossier,
      level: 'local-authority' as const,
      area: { ...dossier.area, code: AreaCode.parse('S12000011') },
      overlaps: [],
      neighbours: { missingInputs: [], areas: [] },
    }

    expect(problemsOf(parseAreaDossier(council))).toEqual([
      'representation: constituencies only',
      'election: constituencies only',
    ])
  })

  it('lists election candidates by votes, most first', () => {
    const election = dossier.election
    if (election === null) throw new Error('fixture has no election')
    const reordered = {
      ...dossier,
      election: { ...election, candidates: election.candidates.toReversed() },
    }

    expect(problemsOf(parseAreaDossier(reordered))).toEqual([
      'election.candidates: most votes first',
    ])
  })

  it('keeps condition counts and flags parallel', () => {
    const broken = { ...dossier, conditions: { claimants: [10, null], flags: [0] } }

    expect(problemsOf(parseAreaDossier(broken))).toEqual(['conditions.flags: expected 2 entries'])
  })
})

describe('dossier facts and series', () => {
  it('reject parallel arrays of different lengths', () => {
    const [facts] = dossier.facts
    const [series] = dossier.series
    if (facts === undefined || series === undefined) throw new Error('fixture has no facts')
    const broken = {
      ...dossier,
      facts: [{ ...facts, ranks: [null] }],
      series: [{ ...series, flags: [0] }],
    }

    expect(problemsOf(parseAreaDossier(broken))).toEqual([
      'facts.spend-pensioner.ranks: expected 2 entries',
      'series.spend-pensioner.flags: expected 2 entries',
    ])
  })

  it('read back as rows and points', () => {
    expect(factRows(dossier.facts, gb)[1]).toEqual({
      metric: 'spend-pensioner',
      denominator: 'per-aged-66-plus',
      period: '2024-25',
      value: 12000,
      flags: 33,
      rank: 2,
      rankOf: 3,
      gbValue: 11500,
    })
    const [series] = dossier.series
    expect(series === undefined ? [] : seriesPoints(series)).toEqual([
      { period: '2023-24', value: 11200, flags: 33 },
      { period: '2024-25', value: 12000, flags: 33 },
    ])
  })
})

describe('parseGbValues', () => {
  it('parses the fixture and rejects parallel arrays of different lengths', () => {
    expect(problemsOf(parseGbValues(readFixture('gb-constituency.json')))).toEqual([])
    const [first, ...rest] = gb.series
    const broken =
      first === undefined ? gb : { ...gb, series: [{ ...first, rankOf: [3] }, ...rest] }

    expect(problemsOf(parseGbValues(broken))).toEqual([
      'series.spend-pensioner.total.rankOf: expected 2 entries',
    ])
  })
})

describe('parseManifest', () => {
  it('pins each level to its boundary set', () => {
    const swapped = {
      ...manifest,
      levels: {
        ...manifest.levels,
        constituency: { ...manifest.levels.constituency, boundarySet: 'LAD23' as const },
      },
    }

    expect(problemsOf(parseManifest(swapped))).toEqual([
      'levels.constituency.boundarySet: expected PCON24',
    ])
  })
})
