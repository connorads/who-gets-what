/**
 * The compiled data contract: every JSON file the pipeline publishes for the
 * app, and where each one lives. The schemas are structural and export to JSON
 * Schema for the pipeline's own tests; the `parse*` functions add the
 * cross-field rules a JSON Schema cannot state.
 */
import { z } from 'zod/mini'
import { Administrator, BenefitCode, BenefitFamily } from './benefit.ts'
import { AreaCode, GeoLevel, Nation, Slug, parseAreaCode, type BoundarySet } from './geography.ts'
import {
  Denominator,
  MetricId,
  ProvenanceKind,
  RateScale,
  Unit,
  ValueFlags,
  type PriceFactors,
} from './measure.ts'
import { FiscalYear, MidYear, Month, PeriodKind, fiscalYearOf, isPeriodOfKind } from './period.ts'
import { err, ok, type Result } from './result.ts'

export const SCHEMA_VERSION = 2

/** Data release id, also the GitHub Release tag suffix (`data-2026-10-05.1`). */
export const ReleaseId = z
  .string()
  .check(z.regex(/^\d{4}-\d{2}-\d{2}\.\d+$/))
  .brand<'ReleaseId'>()
export type ReleaseId = z.infer<typeof ReleaseId>

/**
 * First 16 hex characters of SHA-256 over the level's area codes in published
 * order, joined by `\n` with no trailing newline. Every binary bundle repeats
 * it, so a bundle can never be read against the wrong area order.
 */
export const AreaOrderHash = z
  .string()
  .check(z.regex(/^[0-9a-f]{16}$/))
  .brand<'AreaOrderHash'>()
export type AreaOrderHash = z.infer<typeof AreaOrderHash>

export const SourceId = z
  .string()
  .check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
  .brand<'SourceId'>()
export type SourceId = z.infer<typeof SourceId>

export const CaveatId = z
  .string()
  .check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
  .brand<'CaveatId'>()
export type CaveatId = z.infer<typeof CaveatId>

const Sha256 = z.string().check(z.regex(/^[0-9a-f]{64}$/))
const Text = z.string().check(z.minLength(1))
const Count = z.int().check(z.minimum(0))
const Share = z.number().check(z.minimum(0), z.maximum(1))
const PositiveCount = z.int().check(z.positive())
const Positive = z.number().check(z.positive())

/**
 * Inputs to one change decomposition, each `[from, to]`: the eligible
 * population (the age band the benefit serves), claimants (households for
 * Universal Credit) and the mean weekly award in nominal pounds. `decompose`
 * in `decomposition.ts` turns them into population, claim-rate and award-size
 * effects for a basis.
 */
const DecompositionInputs = {
  population: z.tuple([PositiveCount, PositiveCount]),
  claimants: z.tuple([PositiveCount, PositiveCount]),
  meanWeeklyAward: z.tuple([Positive, Positive]),
}
export const DecompositionInputsSchema = z.strictObject(DecompositionInputs)
export type DecompositionInputs = z.infer<typeof DecompositionInputsSchema>

/** An area measure the models use; an area that lacks one names it. */
export const ModelInputId = z.enum([
  'share-aged-0-15',
  'share-aged-66-plus',
  'deprivation-decile',
  'median-pay',
  'population-density',
])
export type ModelInputId = z.infer<typeof ModelInputId>

const TermId = z.string().check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
const ConditionId = z.string().check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))

const ModelFit = z.strictObject({
  observations: PositiveCount,
  rSquared: Share,
  /** In the order of the design: intercept first. */
  terms: z
    .array(
      z.strictObject({
        id: TermId,
        label: Text,
        coefficient: z.number(),
        standardError: z.number().check(z.minimum(0)),
      }),
    )
    .check(z.minLength(1)),
})

// ---------------------------------------------------------------- manifest.json

const LevelSummary = z.strictObject({
  boundarySet: z.enum(['PCON24', 'LAD23']),
  areaCount: Count,
  areaOrderHash: AreaOrderHash,
})

export const Manifest = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  release: ReleaseId,
  createdAt: z.iso.datetime(),
  pipelineCommit: z.string().check(z.regex(/^[0-9a-f]{40}$/)),
  priceBase: FiscalYear,
  levels: z.record(GeoLevel, LevelSummary),
  coverage: z.strictObject({
    nations: z.array(Nation),
    notCovered: z.array(z.strictObject({ area: Text, reason: Text })),
  }),
  /** Every other file in the release, keyed by path relative to the release root. */
  files: z.record(z.string(), z.strictObject({ bytes: Count, sha256: Sha256 })),
})
export type Manifest = z.infer<typeof Manifest>

// ---------------------------------------------------- meta/areas-{level}.json

export const AreaMeta = z.strictObject({
  code: AreaCode,
  name: Text,
  slug: Slug,
  nation: Nation,
  region: AreaCode,
  hex: z.strictObject({ q: z.int(), r: z.int() }),
  /** [longitude, latitude], WGS84. */
  centroid: z.tuple([z.number(), z.number()]),
  /** Total residents at `populationPeriod`. */
  population: Count,
})
export type AreaMeta = z.infer<typeof AreaMeta>

/** [[west, south], [east, north]] in degrees, WGS84. */
export const LonLatBounds = z.tuple([
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number()]),
])
export type LonLatBounds = z.infer<typeof LonLatBounds>

export const AreasMeta = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  release: ReleaseId,
  level: GeoLevel,
  boundarySet: z.enum(['PCON24', 'LAD23']),
  areaOrderHash: AreaOrderHash,
  populationPeriod: MidYear,
  hexLayout: z.literal('odd-r'),
  /** The extent of every area's map shapes, islands included. */
  bounds: LonLatBounds,
  regions: z.array(
    z.strictObject({ code: AreaCode, name: Text, nation: Nation, bounds: LonLatBounds }),
  ),
  /** Published order: ascending by code. An area's index here is its index in every bundle. */
  areas: z.array(AreaMeta),
})
export type AreasMeta = z.infer<typeof AreasMeta>

// --------------------------------------------------------- meta/catalogue.json

export const MetricDefinition = z.strictObject({
  id: MetricId,
  label: Text,
  shortLabel: Text,
  description: Text,
  unit: Unit,
  rateScale: RateScale,
  levels: z.array(GeoLevel).check(z.minLength(1)),
  denominators: z.array(Denominator).check(z.minLength(1)),
  defaultDenominator: Denominator,
  periodKind: PeriodKind,
  /** Ascending; the last entry is the latest period. */
  periods: z.array(z.string()).check(z.minLength(1)),
  /** Benefit families summed in the numerator; empty for non-benefit metrics. */
  families: z.array(BenefitFamily),
  provenance: ProvenanceKind,
  sources: z.array(SourceId).check(z.minLength(1)),
  caveats: z.array(CaveatId),
  /** Nations included in each period, for the per-period coverage badge. */
  coverage: z.array(z.strictObject({ period: z.string(), nations: z.array(Nation) })),
})
export type MetricDefinition = z.infer<typeof MetricDefinition>

export const Catalogue = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  release: ReleaseId,
  priceBase: FiscalYear,
  defaultMetric: MetricId,
  metrics: z.array(MetricDefinition).check(z.minLength(1)),
  families: z.array(
    z.strictObject({
      id: BenefitFamily,
      label: Text,
      description: Text,
      members: z.array(
        z.strictObject({
          code: BenefitCode,
          label: Text,
          administrator: Administrator,
          nations: z.array(Nation),
          from: z.nullable(FiscalYear),
          to: z.nullable(FiscalYear),
        }),
      ),
    }),
  ),
  /** Multipliers from nominal to real pounds at `priceBase` prices. */
  fiscalYears: z.array(
    z.strictObject({
      id: FiscalYear,
      status: z.enum(['outturn', 'forecast']),
      realGdp: z.number().check(z.positive()),
      realCpi: z.number().check(z.positive()),
    }),
  ),
  sources: z.array(
    z.strictObject({
      id: SourceId,
      publisher: Text,
      title: Text,
      url: z.url(),
      published: z.iso.date(),
      licence: Text,
    }),
  ),
  caveats: z.array(z.strictObject({ id: CaveatId, text: Text })),
  /** Measures of area profile and the models built on them, with every coefficient. */
  models: z.strictObject({
    inputs: z.array(
      z.strictObject({
        id: ModelInputId,
        label: Text,
        period: Text,
        sources: z.array(SourceId).check(z.minLength(1)),
      }),
    ),
    /** Spending modelled from profile; each `metric` publishes actual minus modelled. */
    expected: z.strictObject({
      method: Text,
      period: FiscalYear,
      inputs: z.array(ModelInputId),
      fits: z.array(
        z.strictObject({
          metric: MetricId,
          actualMetric: MetricId,
          denominator: Denominator,
          levels: z.record(GeoLevel, ModelFit),
        }),
      ),
    }),
    /** How each dossier's `neighbours` are chosen: the nearest `count` areas on `features`. */
    neighbours: z.strictObject({
      method: Text,
      count: PositiveCount,
      features: z.array(ModelInputId).check(z.minLength(1)),
    }),
  }),
  /**
   * PIP claimants by main disabling condition at `month`: the condition
   * groups, largest first, with the comparison over `nations`. Each dossier's
   * `conditions` is parallel to `groups`.
   */
  conditions: z.strictObject({
    month: Month,
    nations: z.array(Nation).check(z.minLength(1)),
    sources: z.array(SourceId).check(z.minLength(1)),
    groups: z
      .array(z.strictObject({ id: ConditionId, label: Text, claimants: Count, share: Share }))
      .check(z.minLength(1)),
  }),
  /** Change in annual spending per benefit family, split into population, claim-rate and award-size effects. */
  decomposition: z.strictObject({
    method: Text,
    families: z.array(
      z.strictObject({
        family: BenefitFamily,
        /** The benefit code counted, e.g. `UC_HH` (households) or `CA_16_64`. */
        benefit: BenefitCode,
        claimantUnit: z.enum(['people', 'households']),
        /** The eligible population's band; the claim rate is claimants per person in it. */
        denominator: Denominator,
        from: Month,
        to: Month,
        populationPeriods: z.tuple([MidYear, MidYear]),
        /** Nations whose areas have every input; other areas are left out, as is their share of GB. */
        nations: z.array(Nation),
        /** GB inputs per level: sums over the areas with every input. */
        gb: z.record(GeoLevel, DecompositionInputsSchema),
      }),
    ),
  }),
})
export type Catalogue = z.infer<typeof Catalogue>
export type DecompositionFamily = Catalogue['decomposition']['families'][number]

// ------------------------------------------------------- meta/gb-{level}.json

/**
 * GB value and number of ranked areas for every metric, denominator and
 * period of one level: the same for every area, so dossiers do not repeat
 * them. Arrays are parallel over `periods`, ascending.
 */
export const GbValues = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  release: ReleaseId,
  level: GeoLevel,
  series: z.array(
    z.strictObject({
      metric: MetricId,
      denominator: Denominator,
      periodKind: PeriodKind,
      periods: z.array(z.string()).check(z.minLength(1)),
      /** Nominal for `gbp` metrics. A rate is the GB numerator over the GB band, not a mean of areas. */
      values: z.array(z.nullable(z.number())),
      rankOf: z.array(Count),
    }),
  ),
})
export type GbValues = z.infer<typeof GbValues>

// ------------------------------------------------ area/{level}/{code}.json

/**
 * Latest-period headline values for one metric. Arrays are parallel: entry `j`
 * of each belongs to `denominators[j]`. Rank 1 is the highest value in GB; the
 * GB value and the number of ranked areas are in `meta/gb-{level}.json`.
 */
const MetricFacts = z.strictObject({
  metric: MetricId,
  period: z.string(),
  denominators: z.array(Denominator).check(z.minLength(1)),
  /** Nominal for `gbp` metrics; null when suppressed or not applicable. */
  values: z.array(z.nullable(z.number())),
  flags: z.array(ValueFlags),
  ranks: z.array(z.nullable(z.int().check(z.minimum(1)))),
})
export type MetricFacts = z.infer<typeof MetricFacts>

/** A sparkline for one metric at its default denominator. Arrays are parallel, ascending by period. */
const Series = z.strictObject({
  metric: MetricId,
  denominator: Denominator,
  periodKind: PeriodKind,
  periods: z.array(z.string()).check(z.minLength(1)),
  /** Nominal for `gbp` metrics; null when suppressed or not applicable. */
  values: z.array(z.nullable(z.number())),
  flags: z.array(ValueFlags),
})
export type Series = z.infer<typeof Series>

export const AreaDossier = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  release: ReleaseId,
  level: GeoLevel,
  area: z.strictObject({
    code: AreaCode,
    name: Text,
    slug: Slug,
    nation: Nation,
    region: z.strictObject({ code: AreaCode, name: Text }),
  }),
  /** Areas of the other level that share residents, with this area's population share in each. */
  overlaps: z.array(
    z.strictObject({
      level: GeoLevel,
      code: AreaCode,
      name: Text,
      slug: Slug,
      populationShare: Share,
    }),
  ),
  population: z.strictObject({
    period: MidYear,
    total: Count,
    aged0to15: Count,
    aged16to64: Count,
    aged66plus: Count,
  }),
  /** Latest-period headline values, one entry per metric; `factRows` reads them as rows. */
  facts: z.array(MetricFacts),
  spendByFamily: z.strictObject({
    period: FiscalYear,
    items: z.array(z.strictObject({ family: BenefitFamily, value: z.number(), flags: ValueFlags })),
  }),
  series: z.array(Series),
  /** Change decomposition inputs for each family the area has every input for; months are in the catalogue. */
  decomposition: z.array(
    z.strictObject({ family: BenefitFamily, ...DecompositionInputs, flags: ValueFlags }),
  ),
  /**
   * Actual and modelled spending per person for each `models.expected` fit.
   * `residual` is actual minus expected, the value of the `-vs-model` metric;
   * values are null where an input is missing, and `missingInputs` names it.
   */
  expected: z.array(
    z.strictObject({
      metric: MetricId,
      actual: z.nullable(z.number()),
      expected: z.nullable(z.number()),
      residual: z.nullable(z.number()),
      flags: ValueFlags,
      missingInputs: z.array(ModelInputId),
    }),
  ),
  /**
   * The areas of the same level with the most similar profile (see
   * `models.neighbours`), nearest first. `distance` is in standard deviations;
   * `missingInputs` names any profile measure the area lacks.
   */
  neighbours: z.strictObject({
    missingInputs: z.array(ModelInputId),
    areas: z.array(
      z.strictObject({
        code: AreaCode,
        name: Text,
        slug: Slug,
        distance: z.number().check(z.minimum(0)),
      }),
    ),
  }),
  /** Deprivation decile within the area's own nation; indices are not comparable across nations. */
  deprivation: z.nullable(
    z.strictObject({
      source: SourceId,
      nation: Nation,
      decile: z.int().check(z.minimum(1), z.maximum(10)),
    }),
  ),
  /** Constituencies only. Party appears as text, never as a colour. */
  representation: z.nullable(z.strictObject({ member: Text, party: Text, since: z.iso.date() })),
  /**
   * Constituencies only: the general election of 4 July 2024. Candidates are
   * by votes, most first, so the first won; shares and the majority's share
   * divide by valid votes, and turnout divides valid votes by the electorate.
   * Party appears as text, never as a colour.
   */
  election: z.nullable(
    z.strictObject({
      date: z.iso.date(),
      electorate: PositiveCount,
      validVotes: PositiveCount,
      turnout: Share,
      majority: Count,
      majorityShare: Share,
      candidates: z
        .array(z.strictObject({ party: Text, name: Text, votes: Count, share: Share }))
        .check(z.minLength(2)),
    }),
  ),
  /**
   * PIP claimants per catalogue condition group, parallel to
   * `conditions.groups`; a withheld count is null and flagged suppressed.
   * Null where no breakdown is published (Scottish areas).
   */
  conditions: z.nullable(
    z.strictObject({ claimants: z.array(z.nullable(Count)), flags: z.array(ValueFlags) }),
  ),
  caveats: z.array(CaveatId),
})
export type AreaDossier = z.infer<typeof AreaDossier>

// ------------------------------------------------------------------ paths

/** Every published path, relative to the site root. The release id makes each URL immutable. */
export const dataPath = {
  manifest: (release: ReleaseId) => `/data/${release}/manifest.json`,
  catalogue: (release: ReleaseId) => `/data/${release}/meta/catalogue.json`,
  areas: (release: ReleaseId, level: GeoLevel) => `/data/${release}/meta/areas-${level}.json`,
  gb: (release: ReleaseId, level: GeoLevel) => `/data/${release}/meta/gb-${level}.json`,
  dossier: (release: ReleaseId, level: GeoLevel, code: AreaCode) =>
    `/data/${release}/area/${level}/${code}.json`,
  series: (release: ReleaseId, level: GeoLevel, metric: MetricId, denominator: Denominator) =>
    `/data/${release}/series/${level}/${metric}/${denominator}.bin`,
  swarm: (release: ReleaseId, level: GeoLevel, metric: MetricId, denominator: Denominator) =>
    `/data/${release}/layout/${level}/swarm/${metric}/${denominator}.bin`,
  rings: (release: ReleaseId, level: GeoLevel) => `/data/${release}/layout/${level}/rings.bin`,
  shapes: (release: ReleaseId, level: GeoLevel) => `/data/${release}/layout/${level}/shapes.bin`,
  mapSprite: (release: ReleaseId, level: GeoLevel) => `/data/${release}/layout/${level}/map.svg`,
  decomposition: (release: ReleaseId, level: GeoLevel, family: BenefitFamily) =>
    `/data/${release}/decomposition/${level}/${family}.bin`,
  boundaries: (release: ReleaseId, level: GeoLevel) => `/data/${release}/geo/${level}.geojson`,
} as const

// ---------------------------------------------------------- semantic parsing

export interface ContractViolation {
  readonly kind: 'contract-violation'
  readonly file: string
  readonly problems: readonly string[]
}

const violation = (file: string, problems: readonly string[]): ContractViolation => ({
  kind: 'contract-violation',
  file,
  problems,
})

const schemaProblems = (error: z.core.$ZodError): readonly string[] =>
  error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)

const isAscending = (values: readonly string[]): boolean =>
  values.every((value, i) => i === 0 || (values[i - 1] ?? '') < value)

export function parseManifest(input: unknown): Result<Manifest, ContractViolation> {
  const parsed = Manifest.safeParse(input)
  if (!parsed.success) return err(violation('manifest.json', schemaProblems(parsed.error)))
  const problems = GeoLevel.options.flatMap((level) => {
    const expected: BoundarySet = level === 'constituency' ? 'PCON24' : 'LAD23'
    return parsed.data.levels[level].boundarySet === expected
      ? []
      : [`levels.${level}.boundarySet: expected ${expected}`]
  })
  return problems.length === 0 ? ok(parsed.data) : err(violation('manifest.json', problems))
}

export function parseAreasMeta(input: unknown): Result<AreasMeta, ContractViolation> {
  const parsed = AreasMeta.safeParse(input)
  if (!parsed.success) return err(violation('areas', schemaProblems(parsed.error)))
  const meta = parsed.data
  const file = `meta/areas-${meta.level}.json`
  const regionCodes = new Set<string>(meta.regions.map((region) => region.code))
  const codes = meta.areas.map((area) => area.code)
  const problems = [
    ...(isAscending(codes) ? [] : ['areas: codes must be unique and ascending']),
    ...meta.areas.flatMap((area, i) => [
      ...(parseAreaCode(area.code, meta.level).ok
        ? []
        : [`areas.${i}.code: not a ${meta.level} code`]),
      ...(regionCodes.has(area.region) ? [] : [`areas.${i}.region: unknown region ${area.region}`]),
    ]),
  ]
  return problems.length === 0 ? ok(meta) : err(violation(file, problems))
}

export function parseCatalogue(input: unknown): Result<Catalogue, ContractViolation> {
  const parsed = Catalogue.safeParse(input)
  if (!parsed.success) return err(violation('meta/catalogue.json', schemaProblems(parsed.error)))
  const catalogue = parsed.data
  const fiscalYears = new Set<string>(catalogue.fiscalYears.map((year) => year.id))
  const sources = new Set<string>(catalogue.sources.map((source) => source.id))
  const caveats = new Set<string>(catalogue.caveats.map((caveat) => caveat.id))
  const base = catalogue.fiscalYears.find((year) => year.id === catalogue.priceBase)
  const problems = [
    ...(catalogue.metrics.some((metric) => metric.id === catalogue.defaultMetric)
      ? []
      : ['defaultMetric: not in metrics']),
    ...GeoLevel.options
      .filter((level) => !catalogue.metrics.some((metric) => metric.levels.includes(level)))
      .map((level) => `metrics: none available for ${level}`),
    ...(base !== undefined && base.realGdp === 1 && base.realCpi === 1
      ? []
      : ['fiscalYears: priceBase year must have factors of exactly 1']),
    ...catalogue.metrics.flatMap((metric) =>
      metricProblems(metric, { fiscalYears, sources, caveats }),
    ),
    ...decompositionProblems(catalogue.decomposition.families, fiscalYears),
    ...modelProblems(catalogue),
    ...catalogue.conditions.sources
      .filter((source) => !sources.has(source))
      .map((source) => `conditions.sources: unknown ${source}`),
    ...(new Set(catalogue.conditions.groups.map((group) => group.id)).size ===
    catalogue.conditions.groups.length
      ? []
      : ['conditions.groups: one entry per group']),
  ]
  return problems.length === 0 ? ok(catalogue) : err(violation('meta/catalogue.json', problems))
}

function modelProblems(catalogue: Catalogue): readonly string[] {
  const inputs = new Set<string>(catalogue.models.inputs.map((input) => input.id))
  const sources = new Set<string>(catalogue.sources.map((source) => source.id))
  const { expected } = catalogue.models
  return [
    ...catalogue.models.inputs.flatMap((input) =>
      input.sources
        .filter((source) => !sources.has(source))
        .map((source) => `models.inputs.${input.id}: unknown source ${source}`),
    ),
    ...[...expected.inputs, ...catalogue.models.neighbours.features]
      .filter((input) => !inputs.has(input))
      .map((input) => `models: ${input} is not described in models.inputs`),
    ...expected.fits.flatMap((fit) => fitProblems(catalogue, fit, expected.period)),
  ]
}

function fitProblems(
  catalogue: Catalogue,
  fit: Catalogue['models']['expected']['fits'][number],
  period: FiscalYear,
): readonly string[] {
  const at = `models.expected.${fit.metric}`
  const metric = findMetric(catalogue, fit.metric)
  const actual = findMetric(catalogue, fit.actualMetric)
  const problems: string[] = []
  if (metric?.provenance !== 'modelled') problems.push(`${at}: not a modelled metric`)
  if (actual?.denominators.includes(fit.denominator) !== true) {
    problems.push(`${at}.actualMetric: does not offer ${fit.denominator}`)
  }
  if (metric !== undefined && !metric.periods.includes(period)) {
    problems.push(`${at}: does not publish ${period}`)
  }
  return problems
}

function decompositionProblems(
  families: readonly DecompositionFamily[],
  fiscalYears: ReadonlySet<string>,
): readonly string[] {
  const ids = families.map((entry) => entry.family)
  return [
    ...(new Set(ids).size === ids.length ? [] : ['decomposition.families: one entry per family']),
    ...families.flatMap((entry) => {
      const at = `decomposition.${entry.family}`
      return [
        ...(entry.from < entry.to ? [] : [`${at}: from must precede to`]),
        ...[entry.from, entry.to]
          .filter((month) => !fiscalYears.has(fiscalYearOf(month)))
          .map((month) => `${at}: no price factors for ${month}`),
      ]
    }),
  ]
}

interface KnownIds {
  readonly fiscalYears: ReadonlySet<string>
  readonly sources: ReadonlySet<string>
  readonly caveats: ReadonlySet<string>
}

function metricProblems(metric: MetricDefinition, known: KnownIds): readonly string[] {
  const at = `metrics.${metric.id}`
  const periodsOk = metric.periods.every((period) => isPeriodOfKind(period, metric.periodKind))
  return [
    ...(metric.denominators.includes(metric.defaultDenominator)
      ? []
      : [`${at}.defaultDenominator: not in denominators`]),
    ...(metric.unit === 'ratio' && metric.denominators.some((d) => d !== 'total')
      ? [`${at}.denominators: a ratio takes no per-head denominator`]
      : []),
    ...((metric.unit === 'people') === (metric.rateScale === 1000)
      ? []
      : [`${at}.rateScale: 1000 for people metrics, 1 otherwise`]),
    ...(periodsOk ? [] : [`${at}.periods: not all ${metric.periodKind} periods`]),
    ...(isAscending(metric.periods) ? [] : [`${at}.periods: must be unique and ascending`]),
    ...(metric.unit === 'gbp' && metric.periodKind === 'fiscal-year'
      ? metric.periods
          .filter((period) => !known.fiscalYears.has(period))
          .map((period) => `${at}.periods: no price factors for ${period}`)
      : []),
    ...metric.sources
      .filter((source) => !known.sources.has(source))
      .map((source) => `${at}.sources: unknown ${source}`),
    ...metric.caveats
      .filter((caveat) => !known.caveats.has(caveat))
      .map((caveat) => `${at}.caveats: unknown ${caveat}`),
  ]
}

export function parseAreaDossier(input: unknown): Result<AreaDossier, ContractViolation> {
  const parsed = AreaDossier.safeParse(input)
  if (!parsed.success) return err(violation('area dossier', schemaProblems(parsed.error)))
  const dossier = parsed.data
  const file = `area/${dossier.level}/${dossier.area.code}.json`
  const problems = [
    ...(parseAreaCode(dossier.area.code, dossier.level).ok ? [] : ['area.code: wrong level']),
    ...(dossier.representation !== null && dossier.level !== 'constituency'
      ? ['representation: constituencies only']
      : []),
    ...(dossier.election !== null && dossier.level !== 'constituency'
      ? ['election: constituencies only']
      : []),
    ...(dossier.election?.candidates.some(
      (candidate, i, all) => i > 0 && candidate.votes > (all[i - 1]?.votes ?? 0),
    ) === true
      ? ['election.candidates: most votes first']
      : []),
    ...(dossier.conditions === null
      ? []
      : parallelProblems('conditions', dossier.conditions.claimants.length, {
          flags: dossier.conditions.flags,
        })),
    ...dossier.overlaps
      .filter((overlap) => overlap.level === dossier.level)
      .map((overlap) => `overlaps.${overlap.code}: must be the other level`),
    ...dossier.facts.flatMap((facts) => [
      ...parallelProblems(`facts.${facts.metric}`, facts.denominators.length, {
        values: facts.values,
        flags: facts.flags,
        ranks: facts.ranks,
      }),
      ...(new Set(facts.denominators).size === facts.denominators.length
        ? []
        : [`facts.${facts.metric}.denominators: must be unique`]),
    ]),
    ...neighbourProblems(dossier),
    ...dossier.expected.flatMap((entry) =>
      entry.actual !== null &&
      entry.expected !== null &&
      entry.residual !== null &&
      Math.abs(entry.actual - entry.expected - entry.residual) > 0.02
        ? [`expected.${entry.metric}: residual must be actual minus expected`]
        : [],
    ),
    ...(new Set(dossier.decomposition.map((entry) => entry.family)).size ===
    dossier.decomposition.length
      ? []
      : ['decomposition: one entry per family']),
    ...dossier.series.flatMap((series) => [
      ...parallelProblems(`series.${series.metric}`, series.periods.length, {
        values: series.values,
        flags: series.flags,
      }),
      ...(isAscending(series.periods)
        ? []
        : [`series.${series.metric}.periods: must be unique and ascending`]),
      ...series.periods
        .filter((period) => !isPeriodOfKind(period, series.periodKind))
        .map((period) => `series.${series.metric}: ${period} is not a ${series.periodKind}`),
    ]),
  ]
  return problems.length === 0 ? ok(dossier) : err(violation(file, problems))
}

function neighbourProblems(dossier: AreaDossier): readonly string[] {
  const { areas } = dossier.neighbours
  const codes = areas.map((area) => area.code)
  const problems: string[] = []
  if (codes.includes(dossier.area.code))
    problems.push('neighbours: an area is not its own neighbour')
  if (new Set(codes).size !== codes.length) problems.push('neighbours: each area once')
  if (codes.some((code) => !parseAreaCode(code, dossier.level).ok)) {
    problems.push('neighbours: areas must be the same level')
  }
  if (areas.some((area, i) => i > 0 && area.distance < (areas[i - 1]?.distance ?? 0))) {
    problems.push('neighbours: nearest first')
  }
  return problems
}

function parallelProblems(
  at: string,
  length: number,
  arrays: Readonly<Record<string, readonly unknown[]>>,
): readonly string[] {
  return Object.entries(arrays)
    .filter(([, array]) => array.length !== length)
    .map(([name]) => `${at}.${name}: expected ${length} entries`)
}

export function parseGbValues(input: unknown): Result<GbValues, ContractViolation> {
  const parsed = GbValues.safeParse(input)
  if (!parsed.success) return err(violation('gb values', schemaProblems(parsed.error)))
  const gb = parsed.data
  const keys = gb.series.map((entry) => `${entry.metric}/${entry.denominator}`)
  const problems = [
    ...(new Set(keys).size === keys.length ? [] : ['series: one entry per metric and denominator']),
    ...gb.series.flatMap((entry) => {
      const at = `series.${entry.metric}.${entry.denominator}`
      return [
        ...parallelProblems(at, entry.periods.length, {
          values: entry.values,
          rankOf: entry.rankOf,
        }),
        ...(isAscending(entry.periods) ? [] : [`${at}.periods: must be unique and ascending`]),
        ...entry.periods
          .filter((period) => !isPeriodOfKind(period, entry.periodKind))
          .map((period) => `${at}: ${period} is not a ${entry.periodKind}`),
      ]
    }),
  ]
  return problems.length === 0 ? ok(gb) : err(violation(`meta/gb-${gb.level}.json`, problems))
}

// ----------------------------------------------------------------- lookups

/** The GB value and number of ranked areas for one metric, denominator and period. */
export function gbValueOf(
  gb: GbValues,
  metric: MetricId,
  denominator: Denominator,
  period: string,
): { readonly value: number | null; readonly rankOf: number } | undefined {
  const entry = gb.series.find((s) => s.metric === metric && s.denominator === denominator)
  const i = entry?.periods.indexOf(period) ?? -1
  if (entry === undefined || i < 0) return undefined
  return { value: entry.values[i] ?? null, rankOf: entry.rankOf[i] ?? 0 }
}

/** One headline value of a dossier with its GB context. */
export interface FactRow {
  readonly metric: MetricId
  readonly denominator: Denominator
  readonly period: string
  readonly value: number | null
  readonly flags: number
  readonly rank: number | null
  /** Areas ranked; null when the GB file has no entry for the period. */
  readonly rankOf: number | null
  readonly gbValue: number | null
}

/** Every fact of a parsed dossier as rows, in published order, joined to the level's GB values. */
export function factRows(facts: readonly MetricFacts[], gb: GbValues): readonly FactRow[] {
  return facts.flatMap((entry) =>
    entry.denominators.map((denominator, j) => {
      const context = gbValueOf(gb, entry.metric, denominator, entry.period)
      return {
        metric: entry.metric,
        denominator,
        period: entry.period,
        value: entry.values[j] ?? null,
        flags: entry.flags[j] ?? 0,
        rank: entry.ranks[j] ?? null,
        rankOf: context?.rankOf ?? null,
        gbValue: context?.value ?? null,
      }
    }),
  )
}

/** A parsed series as points, ascending by period. */
export function seriesPoints(
  series: Series,
): readonly { readonly period: string; readonly value: number | null; readonly flags: number }[] {
  return series.periods.map((period, i) => ({
    period,
    value: series.values[i] ?? null,
    flags: series.flags[i] ?? 0,
  }))
}

export function findMetric(catalogue: Catalogue, id: string): MetricDefinition | undefined {
  return catalogue.metrics.find((metric) => metric.id === id)
}

/** Price factors keyed by fiscal year, for `applyBasis`. */
export function priceFactors(catalogue: Catalogue): ReadonlyMap<FiscalYear, PriceFactors> {
  return new Map(catalogue.fiscalYears.map((year) => [year.id, year]))
}
