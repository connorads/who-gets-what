/**
 * The area dossier as a view: every figure, sentence, label and footnote a
 * page, an embed or a share card shows, built from checked contract data. It
 * holds no markup, so tests read it directly.
 */
import type { SeriesBundle } from '#/domain/bundle.ts'
import {
  factRows,
  findMetric,
  seriesPoints,
  type AreaDossier,
  type AreasMeta,
  type Catalogue,
  type FactRow,
  type GbValues,
  type MetricDefinition,
} from '#/domain/contract.ts'
import type { BenefitFamily } from '#/domain/benefit.ts'
import type { GeoLevel } from '#/domain/geography.ts'
import {
  denominatorLabel,
  perLabel,
  provenanceKinds,
  ValueFlag,
  type Denominator,
  type MetricId,
  type ProvenanceKind,
} from '#/domain/measure.ts'
import { encodeExploreState, resolveExploreState } from '#/domain/url-state.ts'
import {
  formatCount,
  formatDate,
  formatMonth,
  formatPounds,
  formatShare,
  periodLabel,
} from '#/lib/format.ts'
import {
  factorsOf,
  figure,
  inBases,
  perBasis,
  plainFigure,
  type Factors,
  type Figure,
  type PerBasis,
} from './figures.ts'
import { areaPath, LEVEL_LABEL, NATION_LABEL, rankPath } from './labels.ts'
import {
  capitalise,
  comparison,
  denominatorSentence,
  measurePhrase,
  modelSentence,
  rankSentence,
  rankText,
  taxRatioSentence,
  unrankedReason,
  type Standing,
} from './sentences.ts'
import { createSourceNotes, isDerived, type SourceNote, type SourceNotes } from './sources.ts'

export interface FactView {
  readonly metric: MetricId
  readonly label: string
  readonly shortLabel: string
  readonly denominator: Denominator
  readonly denominatorText: string
  readonly period: string
  readonly periodText: string
  readonly value: Figure | null
  readonly gb: Figure | null
  readonly standing: Standing | null
  readonly rankText: string
  /** "higher than in 93% of constituencies", or null when unranked. */
  readonly comparison: string | null
  readonly flags: number
  readonly kinds: readonly ProvenanceKind[]
  readonly derived: boolean
  readonly sources: readonly number[]
  readonly rankHref: string
}

export interface FamilySpend {
  readonly family: BenefitFamily
  readonly label: string
  readonly value: PerBasis<number>
  readonly text: PerBasis<string>
  readonly share: number
  readonly flags: number
  readonly kinds: readonly ProvenanceKind[]
  readonly derived: boolean
}

export interface SeriesView {
  readonly metric: MetricId
  readonly title: string
  readonly denominatorText: string
  readonly kind: 'spend' | 'claimants'
  readonly varies: boolean
  readonly points: readonly {
    readonly period: string
    readonly label: string
    readonly value: PerBasis<number> | null
    readonly text: PerBasis<string>
    readonly flags: number
  }[]
  readonly derived: boolean
  readonly sources: readonly number[]
}

export interface NeighbourRow {
  readonly code: string
  readonly name: string
  readonly href: string
  readonly compareHref: string | null
  readonly distance: number | null
  readonly value: PerBasis<number> | null
  readonly text: PerBasis<string>
  readonly flags: number
  readonly self: boolean
}

export interface ModelRow {
  readonly metric: MetricId
  readonly title: string
  readonly denominatorText: string
  readonly actual: PerBasis<number> | null
  readonly expected: PerBasis<number> | null
  readonly actualText: PerBasis<string>
  readonly expectedText: PerBasis<string>
  readonly residualText: PerBasis<string>
  /** Actual minus modelled, and the difference that reaches a chart's edge for this level. */
  readonly residual: PerBasis<number> | null
  readonly spread: PerBasis<number> | null
  readonly sentence: PerBasis<string> | null
  readonly missing: readonly string[]
  /** Share of variation across the level the model explains. */
  readonly rSquared: number | null
  readonly sources: readonly number[]
}

export interface ElectionView {
  readonly dateText: string
  readonly winner: { readonly party: string; readonly name: string }
  readonly majorityText: string
  readonly majorityShareText: string
  readonly turnoutText: string
  readonly electorateText: string
  readonly validVotesText: string
  readonly candidates: readonly {
    readonly party: string
    readonly name: string
    readonly votesText: string
    readonly share: number
    readonly shareText: string
  }[]
  readonly caveat: string | null
  readonly sources: readonly number[]
}

export interface ConditionRow {
  readonly id: string
  readonly label: string
  readonly claimantsText: string
  /** Share of the area's claimants; null when the count is withheld. */
  readonly share: number | null
  readonly shareText: string
  /** Share in the comparison nations, England and Wales. */
  readonly comparison: number
  readonly comparisonText: string
  readonly suppressed: boolean
}

export type ConditionsView =
  | {
      readonly kind: 'published'
      readonly periodText: string
      readonly comparisonLabel: string
      readonly totalText: string
      /** Groups with at least `MAIN_CONDITION_SHARE` of claimants in the comparison, then the rest together. */
      readonly main: readonly ConditionRow[]
      readonly rows: readonly ConditionRow[]
      /** Upper end of the shared scale for every small multiple. */
      readonly max: number
      readonly caveat: string | null
      readonly sources: readonly number[]
    }
  | { readonly kind: 'not-published'; readonly reason: string }

export interface AreaView {
  readonly level: GeoLevel
  readonly levelLabel: (typeof LEVEL_LABEL)[GeoLevel]
  readonly code: string
  readonly name: string
  readonly slug: string
  readonly nationLabel: string
  readonly regionName: string
  readonly path: string
  readonly exploreHref: string
  readonly priceBase: string
  readonly release: string
  readonly population: {
    readonly periodText: string
    readonly total: string
    readonly bands: readonly {
      readonly label: string
      readonly value: string
      readonly share: number
    }[]
  }
  readonly representation: {
    readonly member: string
    readonly party: string
    readonly since: string
  } | null
  /** Constituencies only: the 2024 general election, party as text. */
  readonly election: ElectionView | null
  /** PIP claimants by condition group, or why the area has none. */
  readonly conditions: ConditionsView
  /** Comparison sentences for the lede; the first is the page's summary. */
  readonly headline: readonly string[]
  readonly summary: string
  readonly glance: readonly FactView[]
  readonly facts: readonly { readonly title: string; readonly rows: readonly FactView[] }[]
  readonly spend: {
    readonly periodText: string
    readonly total: PerBasis<number>
    readonly totalText: PerBasis<string>
    readonly items: readonly FamilySpend[]
    readonly sources: readonly number[]
  }
  readonly series: readonly SeriesView[]
  readonly model: { readonly rows: readonly ModelRow[]; readonly caveat: string | null }
  readonly tax: {
    readonly periodText: string
    readonly incomeTax: FactView
    readonly spend: Figure | null
    readonly ratio: FactView
    /** The ratio in words, or null when the area has no ratio. */
    readonly ratioText: string | null
    readonly caveats: readonly string[]
  } | null
  readonly deprivation: {
    readonly decile: number
    readonly nationLabel: string
    readonly indexTitle: string
    readonly sources: readonly number[]
  } | null
  readonly neighbours: {
    readonly title: string
    readonly denominatorText: string
    readonly periodText: string
    readonly method: string
    readonly missing: readonly string[]
    readonly rows: readonly NeighbourRow[]
  }
  readonly overlaps: readonly {
    readonly name: string
    readonly href: string
    readonly levelText: string
    readonly share: number
    readonly shareText: string
  }[]
  readonly caveats: readonly { readonly id: string; readonly text: string }[]
  readonly sources: readonly SourceNote[]
}

export interface AreaInput {
  readonly dossier: AreaDossier
  readonly catalogue: Catalogue
  readonly gb: GbValues
  readonly areas: AreasMeta
  /** `spend-total` per resident for every area of the level, for the neighbour bars. */
  readonly spendPerResident: SeriesBundle
  /** Per `-vs-model` metric, the 98th percentile of the size of differences across the level, nominal. */
  readonly modelSpread: ReadonlyMap<string, number>
}

function requireMetric(catalogue: Catalogue, id: string): MetricDefinition {
  const metric = findMetric(catalogue, id)
  if (metric === undefined) throw new Error(`Catalogue has no metric ${id}`)
  return metric
}

export function factView(
  row: FactRow,
  metric: MetricDefinition,
  level: GeoLevel,
  factors: Factors,
  notes: SourceNotes,
): FactView {
  const standing =
    row.rank !== null && row.rankOf !== null && row.rankOf > 0
      ? { rank: row.rank, rankOf: row.rankOf }
      : null
  return {
    metric: metric.id,
    label: metric.label,
    shortLabel: metric.shortLabel,
    denominator: row.denominator,
    denominatorText: perLabel(metric, row.denominator),
    period: row.period,
    periodText: periodLabel(row.period, metric.periodKind),
    value:
      row.value === null ? null : figure(row.value, metric, row.denominator, row.period, factors),
    gb:
      row.gbValue === null
        ? null
        : figure(row.gbValue, metric, row.denominator, row.period, factors),
    standing,
    rankText:
      standing === null
        ? row.value === null
          ? 'No value published'
          : unrankedReason(row.flags)
        : rankText(standing),
    comparison: standing === null ? null : comparison(standing, level),
    flags: row.flags,
    kinds: provenanceKinds(row.flags),
    derived: isDerived(row.flags),
    sources: notes.cite(metric.sources),
    rankHref: rankPath(metric.id, row.denominator, level),
  }
}

const FACT_GROUPS: readonly { readonly title: string; readonly match: (id: string) => boolean }[] =
  [
    {
      title: 'Spending by benefit',
      match: (id) => id.startsWith('spend-') && !id.includes('-vs-'),
    },
    { title: 'People receiving benefits', match: (id) => id.startsWith('claimants-') },
    { title: 'Income tax', match: (id) => id === 'income-tax' || id === 'spend-to-income-tax' },
    { title: 'Compared with the expected level', match: (id) => id.includes('-vs-model') },
  ]

const GLANCE: readonly (readonly [string, Denominator])[] = [
  ['spend-total', 'per-resident'],
  ['spend-pensioner', 'per-aged-66-plus'],
  ['spend-working-age', 'per-aged-16-64'],
]

export function buildAreaView(input: AreaInput): AreaView {
  const { dossier, catalogue, gb } = input
  const { level } = dossier
  const factors = factorsOf(catalogue)
  const notes = createSourceNotes(catalogue)
  const metric = (id: string) => requireMetric(catalogue, id)
  const rows = factRows(dossier.facts, gb)
  const facts = rows.map((row) => factView(row, metric(row.metric), level, factors, notes))
  const fact = (id: string, denominator: Denominator): FactView | undefined =>
    facts.find((entry) => entry.metric === id && entry.denominator === denominator)

  const glance = GLANCE.flatMap(([id, denominator]) => {
    const found = fact(id, denominator)
    return found === undefined ? [] : [found]
  })

  const headline = headlineSentences(dossier.area.name, level, glance, facts)
  const explore = resolveExploreState({ level, sel: dossier.area.code }, catalogue).state

  return {
    level,
    levelLabel: LEVEL_LABEL[level],
    code: dossier.area.code,
    name: dossier.area.name,
    slug: dossier.area.slug,
    nationLabel: NATION_LABEL[dossier.area.nation],
    regionName: dossier.area.region.name,
    path: areaPath(level, dossier.area),
    exploreHref: `/explore?${new URLSearchParams(encodeExploreState(explore, catalogue)).toString()}`,
    priceBase: catalogue.priceBase,
    release: dossier.release,
    population: populationView(dossier),
    representation:
      dossier.representation === null
        ? null
        : { ...dossier.representation, since: formatDate(dossier.representation.since) },
    election: electionView(dossier, catalogue, notes),
    conditions: conditionsView(dossier, catalogue, notes),
    headline,
    summary: headline[0] ?? `${dossier.area.name}: benefit spending and people receiving benefits.`,
    glance,
    facts: FACT_GROUPS.map((group) => ({
      title: group.title,
      rows: facts.filter((entry) => group.match(entry.metric)),
    })).filter((group) => group.rows.length > 0),
    spend: spendView(dossier, catalogue, factors, notes),
    series: dossier.series
      .filter(
        (series) => series.metric.startsWith('spend-') || series.metric.startsWith('claimants-'),
      )
      .filter((series) => !series.metric.includes('-vs-') && series.periods.length > 1)
      .map((series) => {
        const definition = metric(series.metric)
        const points = seriesPoints(series).map((point) => {
          const value =
            point.value === null ? null : inBases(point.value, definition, point.period, factors)
          const shown =
            point.value === null
              ? plainFigure('No value')
              : figure(point.value, definition, series.denominator, point.period, factors)
          return {
            period: point.period,
            label: periodLabel(point.period, series.periodKind),
            value,
            text: shown.text,
            flags: point.flags,
          }
        })
        return {
          metric: definition.id,
          title: definition.shortLabel,
          denominatorText: perLabel(definition, series.denominator),
          kind: definition.unit === 'gbp' ? ('spend' as const) : ('claimants' as const),
          varies: definition.unit === 'gbp',
          points,
          derived: points.some((point) => isDerived(point.flags)),
          sources: notes.cite(definition.sources),
        }
      }),
    model: modelView(input, factors, notes),
    tax: taxView(dossier, facts, catalogue, factors),
    deprivation: deprivationView(dossier, catalogue, notes),
    neighbours: neighbourView(input, factors),
    overlaps: dossier.overlaps.map((overlap) => ({
      name: overlap.name,
      href: areaPath(overlap.level, overlap),
      levelText: LEVEL_LABEL[overlap.level].one,
      share: overlap.populationShare,
      shareText: formatShare(overlap.populationShare),
    })),
    caveats: dossier.caveats.flatMap((id) => {
      const caveat = catalogue.caveats.find((entry) => entry.id === id)
      return caveat === undefined ? [] : [caveat]
    }),
    sources: notes.list(),
  }
}

function headlineSentences(
  name: string,
  level: GeoLevel,
  glance: readonly FactView[],
  facts: readonly FactView[],
): readonly string[] {
  const sentences = glance.flatMap((entry) =>
    entry.standing === null
      ? []
      : [
          rankSentence({
            areaName: name,
            level,
            metricLabel: entry.label,
            denominatorText: entry.denominatorText,
            periodText: entry.periodText,
            standing: entry.standing,
          }),
        ],
  )
  const total = facts.find(
    (entry) => entry.metric === 'spend-total' && entry.denominator === 'total',
  )
  const perHead = glance[0]
  if (total?.standing && perHead?.standing) {
    sentences.push(
      denominatorSentence({
        areaName: name,
        level,
        total: total.standing,
        perHead: perHead.standing,
        perHeadText: perHead.denominatorText,
      }),
    )
  }
  return sentences
}

function populationView(dossier: AreaDossier): AreaView['population'] {
  const { population } = dossier
  const share = (value: number) => (population.total > 0 ? value / population.total : 0)
  const aged = population.aged0to15 + population.aged16to64 + population.aged66plus
  return {
    periodText: population.period,
    total: population.total.toLocaleString('en-GB'),
    bands: [
      {
        label: 'Aged 0 to 15',
        value: population.aged0to15.toLocaleString('en-GB'),
        share: share(population.aged0to15),
      },
      {
        label: 'Aged 16 to 64',
        value: population.aged16to64.toLocaleString('en-GB'),
        share: share(population.aged16to64),
      },
      {
        label: 'Aged 65',
        value: (population.total - aged).toLocaleString('en-GB'),
        share: share(population.total - aged),
      },
      {
        label: 'Aged 66 and over',
        value: population.aged66plus.toLocaleString('en-GB'),
        share: share(population.aged66plus),
      },
    ],
  }
}

const caveatText = (catalogue: Catalogue, id: string): string | null =>
  catalogue.caveats.find((caveat) => caveat.id === id)?.text ?? null

function electionView(
  dossier: AreaDossier,
  catalogue: Catalogue,
  notes: SourceNotes,
): ElectionView | null {
  const { election } = dossier
  const winner = election?.candidates[0]
  if (election === null || winner === undefined) return null
  return {
    dateText: formatDate(election.date),
    winner: { party: winner.party, name: winner.name },
    majorityText: formatCount(election.majority),
    majorityShareText: formatShare(election.majorityShare, 1),
    turnoutText: formatShare(election.turnout, 1),
    electorateText: formatCount(election.electorate),
    validVotesText: formatCount(election.validVotes),
    candidates: election.candidates.map((candidate) => ({
      party: candidate.party,
      name: candidate.name,
      votesText: formatCount(candidate.votes),
      share: candidate.share,
      shareText: formatShare(candidate.share, 1),
    })),
    caveat: caveatText(catalogue, 'election-2024'),
    sources: notes.cite(
      catalogue.sources
        .filter((source) => source.id === 'uk-parliament-election-results')
        .map((source) => source.id),
    ),
  }
}

/** A condition group is drawn on its own when it holds at least this share of claimants in the comparison. */
const MAIN_CONDITION_SHARE = 0.02

function conditionsView(
  dossier: AreaDossier,
  catalogue: Catalogue,
  notes: SourceNotes,
): ConditionsView {
  const { conditions } = dossier
  const { groups } = catalogue.conditions
  if (conditions === null) {
    return {
      kind: 'not-published',
      reason:
        dossier.area.nation === 'scotland'
          ? 'Figures by disability condition are published for Scotland as a whole, not for areas in Scotland.'
          : 'No figures by disability condition are published for this area.',
    }
  }
  const total = conditions.claimants.reduce<number>((sum, count) => sum + (count ?? 0), 0)
  const row = (
    id: string,
    label: string,
    count: number | null,
    elsewhere: number,
    suppressed: boolean,
  ): ConditionRow => {
    const share = count === null || total === 0 ? null : count / total
    return {
      id,
      label,
      claimantsText: count === null ? 'Not published' : formatCount(count),
      share,
      shareText: share === null ? 'Not published' : formatShare(share),
      comparison: elsewhere,
      comparisonText: formatShare(elsewhere),
      suppressed,
    }
  }
  const rows = groups.map((group, i) => {
    const count = conditions.claimants[i] ?? null
    const suppressed = ((conditions.flags[i] ?? 0) & ValueFlag.suppressed) !== 0
    return row(group.id, group.label, count, group.share, suppressed || count === null)
  })
  const main = rows.filter((entry) => entry.comparison >= MAIN_CONDITION_SHARE)
  const rest = rows.filter((entry) => entry.comparison < MAIN_CONDITION_SHARE)
  const restCount = rest.some((entry) => entry.suppressed)
    ? null
    : groups.reduce(
        (sum, group, i) =>
          group.share < MAIN_CONDITION_SHARE ? sum + (conditions.claimants[i] ?? 0) : sum,
        0,
      )
  const others = row(
    'other-groups',
    `Other condition groups (${rest.length.toLocaleString('en-GB')})`,
    restCount,
    rest.reduce((sum, entry) => sum + entry.comparison, 0),
    restCount === null,
  )
  const shown = rest.length > 0 ? [...main, others] : main
  return {
    kind: 'published',
    periodText: formatMonth(catalogue.conditions.month),
    comparisonLabel: catalogue.conditions.nations
      .map((nation) => NATION_LABEL[nation])
      .join(' and '),
    totalText: formatCount(total),
    main: shown,
    rows,
    max: Math.max(...shown.flatMap((entry) => [entry.share ?? 0, entry.comparison])),
    caveat: caveatText(catalogue, 'pip-conditions'),
    sources: notes.cite(catalogue.conditions.sources),
  }
}

function spendView(
  dossier: AreaDossier,
  catalogue: Catalogue,
  factors: Factors,
  notes: SourceNotes,
): AreaView['spend'] {
  const { period, items } = dossier.spendByFamily
  const money = { unit: 'gbp', periodKind: 'fiscal-year' } as const
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const totals = inBases(total, money, period, factors)
  const order = catalogue.families.map((family) => family.id)
  const spendTotal = findMetric(catalogue, 'spend-total')
  return {
    periodText: period,
    total: totals,
    totalText: perBasis((basis) => formatPounds(totals[basis], { total: true })),
    items: items
      .toSorted((a, b) => order.indexOf(a.family) - order.indexOf(b.family))
      .map((item) => {
        const value = inBases(item.value, money, period, factors)
        return {
          family: item.family,
          label:
            catalogue.families.find((family) => family.id === item.family)?.label ?? item.family,
          value,
          text: perBasis((basis) => formatPounds(value[basis], { total: true })),
          share: total > 0 ? item.value / total : 0,
          flags: item.flags,
          kinds: provenanceKinds(item.flags),
          derived: isDerived(item.flags),
        }
      }),
    sources: spendTotal === undefined ? [] : notes.cite(spendTotal.sources),
  }
}

function modelView(
  { dossier, catalogue, modelSpread }: AreaInput,
  factors: Factors,
  notes: SourceNotes,
): AreaView['model'] {
  const { expected } = catalogue.models
  const rows = dossier.expected.flatMap((entry): ModelRow[] => {
    const fit = expected.fits.find((candidate) => candidate.metric === entry.metric)
    const actualMetric = fit === undefined ? undefined : findMetric(catalogue, fit.actualMetric)
    if (fit === undefined || actualMetric === undefined) return []
    const denominatorText = denominatorLabel(fit.denominator, actualMetric.rateScale)
    const bases = (value: number | null) =>
      value === null ? null : inBases(value, actualMetric, expected.period, factors)
    const text = (value: number | null, sign = false) =>
      value === null
        ? plainFigure('No expected level').text
        : figure(value, actualMetric, fit.denominator, expected.period, factors, { sign }).text
    const residual = bases(entry.residual)
    const measure = measurePhrase(actualMetric.label, denominatorText)
    const inputLabels = entry.missingInputs.map(
      (id) => catalogue.models.inputs.find((input) => input.id === id)?.label ?? id,
    )
    return [
      {
        metric: entry.metric,
        title: actualMetric.shortLabel,
        denominatorText,
        actual: bases(entry.actual),
        expected: bases(entry.expected),
        actualText: text(entry.actual),
        expectedText: text(entry.expected),
        residualText: text(entry.residual, true),
        residual,
        spread: bases(modelSpread.get(entry.metric) ?? null),
        sentence:
          residual === null || entry.residual === null
            ? null
            : perBasis((basis) =>
                modelSentence({
                  measure,
                  residual: residual[basis],
                  differenceText: formatPounds(Math.abs(residual[basis])),
                }),
              ),
        missing: inputLabels,
        rSquared: fit.levels[dossier.level]?.rSquared ?? null,
        sources: notes.cite(findMetric(catalogue, entry.metric)?.sources ?? []),
      },
    ]
  })
  return {
    rows,
    caveat: catalogue.caveats.find((caveat) => caveat.id === 'modelled-comparison')?.text ?? null,
  }
}

function taxView(
  dossier: AreaDossier,
  facts: readonly FactView[],
  catalogue: Catalogue,
  factors: Factors,
): AreaView['tax'] {
  const incomeTax = facts.find(
    (entry) => entry.metric === 'income-tax' && entry.denominator === 'per-resident',
  )
  const ratio = facts.find((entry) => entry.metric === 'spend-to-income-tax')
  if (incomeTax === undefined || ratio === undefined) return null
  const spendSeries = dossier.series.find(
    (series) => series.metric === 'spend-total' && series.denominator === 'per-resident',
  )
  const index = spendSeries?.periods.indexOf(incomeTax.period) ?? -1
  const spendValue = index < 0 ? null : (spendSeries?.values[index] ?? null)
  const spendMetric = findMetric(catalogue, 'spend-total')
  return {
    periodText: incomeTax.periodText,
    incomeTax,
    spend:
      spendValue === null || spendMetric === undefined
        ? null
        : figure(spendValue, spendMetric, 'per-resident', incomeTax.period, factors),
    ratio,
    ratioText:
      ratio.value === null
        ? null
        : taxRatioSentence({
            areaName: dossier.area.name,
            valueText: ratio.value.text['real-gdp'],
            periodText: ratio.periodText,
          }),
    caveats: ['income-tax-only', 'income-tax-survey', 'same-year-ratio'].flatMap((id) => {
      const caveat = catalogue.caveats.find((entry) => entry.id === id)
      return caveat === undefined ? [] : [caveat.text]
    }),
  }
}

function deprivationView(
  dossier: AreaDossier,
  catalogue: Catalogue,
  notes: SourceNotes,
): AreaView['deprivation'] {
  const { deprivation } = dossier
  if (deprivation === null) return null
  const source = catalogue.sources.find((entry) => entry.id === deprivation.source)
  return {
    decile: deprivation.decile,
    nationLabel: NATION_LABEL[deprivation.nation],
    indexTitle: source?.title ?? deprivation.source,
    sources: notes.cite([deprivation.source]),
  }
}

function neighbourView(input: AreaInput, factors: Factors): AreaView['neighbours'] {
  const { dossier, catalogue, areas, spendPerResident } = input
  const { level } = dossier
  const metric = requireMetric(catalogue, 'spend-total')
  const { header } = spendPerResident
  const periodIndex = header.periods.length - 1
  const period = header.periods[periodIndex] ?? ''
  const indexOf = new Map<string, number>(areas.areas.map((area, i) => [area.code, i]))
  const valueOf = (code: string) => {
    const i = indexOf.get(code)
    if (i === undefined) return { value: null, flags: 0 }
    const at = periodIndex * header.areaCount + i
    const raw = spendPerResident.values[at]
    return {
      value: raw === undefined || Number.isNaN(raw) ? null : inBases(raw, metric, period, factors),
      flags: spendPerResident.flags[at] ?? 0,
    }
  }
  const row = (
    area: { code: string; name: string; slug: string },
    distance: number | null,
    self: boolean,
  ): NeighbourRow => {
    const { value, flags } = valueOf(area.code)
    return {
      code: area.code,
      name: area.name,
      href: areaPath(level, area),
      compareHref: self ? null : `${areaPath(level, dossier.area)}/vs/${area.code}-${area.slug}`,
      distance,
      value,
      text:
        value === null
          ? plainFigure('No value').text
          : perBasis((basis) => formatPounds(value[basis])),
      flags,
      self,
    }
  }
  return {
    title: metric.shortLabel,
    denominatorText: denominatorLabel('per-resident', metric.rateScale),
    periodText: period,
    method: catalogue.models.neighbours.method,
    missing: dossier.neighbours.missingInputs.map(
      (id) => catalogue.models.inputs.find((entry) => entry.id === id)?.label ?? id,
    ),
    rows: [
      row(dossier.area, null, true),
      ...dossier.neighbours.areas.map((area) => row(area, area.distance, false)),
    ],
  }
}

/** The one comparative fact a share card carries. */
export function shareFact(view: AreaView): string {
  const first = view.glance[0]
  if (first?.comparison == null) return view.summary
  return capitalise(
    `${measurePhrase(first.label, first.denominatorText)} was ${first.comparison} in ${first.periodText}.`,
  )
}
