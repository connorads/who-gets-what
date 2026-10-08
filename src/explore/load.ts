/**
 * Everything the explorer renders for one URL state, read through the
 * DataSource port: the server renders the SVG fallback and tables from it,
 * and the client reuses it as the engine's first frame. Values arrive in the
 * reader's basis; NaN becomes null so the data survives serialisation.
 */
import { parseBundle, type SeriesBundle, type SwarmBundle } from '#/domain/bundle.ts'
import {
  dataPath,
  findMetric,
  parseAreaDossier,
  parseAreasMeta,
  parseCatalogue,
  parseGbValues,
  priceFactors,
  type AreaDossier,
  type AreaOrderHash,
  type AreasMeta,
  type Catalogue,
  type GbValues,
  type LonLatBounds,
  type MetricDefinition,
} from '#/domain/contract.ts'
import type { AreaCode, GeoLevel } from '#/domain/geography.ts'
import { applyBasis, type Basis, type Denominator, type MetricId } from '#/domain/measure.ts'
import { FiscalYear } from '#/domain/period.ts'
import { decodeExploreQuery, resolveExploreState, type ExploreState } from '#/domain/url-state.ts'
import { dataSource, RELEASE, required, type DataSource } from '#/data/source.ts'
import { INSET_LABEL, INSET_REGION } from '#/viz/layout/map-frame.ts'

export interface ExploreArea {
  readonly code: AreaCode
  readonly name: string
  readonly q: number
  readonly r: number
}

/** One denominator's values for the active period, in area order. */
export interface ExploreColumn {
  readonly denominator: Denominator
  readonly values: readonly (number | null)[]
  readonly flags: readonly number[]
  /** GB value (in the reader's basis) and the number of areas ranked, when published. */
  readonly gb: { readonly value: number | null; readonly rankOf: number } | undefined
}

/** What the map needs beyond the shapes: the level's extent and the inset region. */
export interface ExploreMap {
  /** The SVG sprite with one path per area, for the server-rendered map. */
  readonly sprite: string
  readonly bounds: LonLatBounds
  readonly inset:
    | {
        readonly label: string
        readonly bounds: LonLatBounds
        /** Area indices drawn in the inset. */
        readonly areas: readonly number[]
      }
    | undefined
}

export interface ExploreSwarm {
  /** Packed [x, y] per area: x from 0 to 1 across `domain`; null when the area has no value. */
  readonly xy: readonly (number | null)[]
  readonly radius: number
  readonly scale: 'linear' | 'log'
  /** Nominal domain; multiply by `basisFactor` for axis labels. */
  readonly domain: readonly [number, number]
  readonly basisFactor: number
}

export type ExpectedFit = Catalogue['models']['expected']['fits'][number]

export interface ExploreExpected {
  readonly fit: ExpectedFit
  readonly period: string
  readonly actual: readonly (number | null)[]
  readonly residual: readonly (number | null)[]
  readonly flags: readonly number[]
}

export interface ExploreData {
  readonly catalogue: Catalogue
  readonly state: ExploreState
  readonly metric: MetricDefinition
  readonly areas: readonly ExploreArea[]
  readonly areaOrderHash: AreaOrderHash
  readonly map: ExploreMap
  /** Periods the active level publishes for the metric (bundle header), ascending. */
  readonly periods: readonly string[]
  readonly columns: readonly ExploreColumn[]
  readonly swarm: ExploreSwarm
  /** The modelled-spending fit for the measure and level; Explained by age reads its values in the browser. */
  readonly expectedFit: ExpectedFit | undefined
  /** Change decomposition inputs for the selected area, by family. */
  readonly selectedDecomposition: AreaDossier['decomposition'] | undefined
  /** The selected area's slug, for its area page link; areas carry none, to keep the page small. */
  readonly selectedSlug: string | undefined
}

/**
 * A per-kind memo: each release file is read and parsed once per runtime.
 * Release paths are immutable, so a parsed result never goes stale; a failed
 * read is forgotten so it can be retried.
 */
export function memoised<T>(): (key: string, load: () => Promise<T>) => Promise<T> {
  const memo = new Map<string, Promise<T>>()
  return (key, load) => {
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    const pending = load()
    memo.set(key, pending)
    pending.catch(() => memo.delete(key))
    return pending
  }
}

const catalogues = memoised<Catalogue>()
const areaMetas = memoised<AreasMeta>()
const gbValues = memoised<GbValues>()
const series = memoised<SeriesBundle>()
const swarms = memoised<SwarmBundle>()
const dossiers = memoised<AreaDossier>()

function orThrow<T>(
  result: { ok: true; value: T } | { ok: false; error: { problems: readonly string[] } },
): T {
  if (result.ok) return result.value
  throw new Error(result.error.problems.join('\n'))
}

export function loadCatalogue(source: DataSource): Promise<Catalogue> {
  const path = dataPath.catalogue(RELEASE)
  return catalogues(path, async () => orThrow(parseCatalogue(await required(source.json(path)))))
}

function loadAreas(source: DataSource, level: GeoLevel): Promise<AreasMeta> {
  const path = dataPath.areas(RELEASE, level)
  return areaMetas(path, async () => orThrow(parseAreasMeta(await required(source.json(path)))))
}

function loadGb(source: DataSource, level: GeoLevel): Promise<GbValues> {
  const path = dataPath.gb(RELEASE, level)
  return gbValues(path, async () => orThrow(parseGbValues(await required(source.json(path)))))
}

async function readBundle(source: DataSource, path: string, hash: AreaOrderHash) {
  const parsed = parseBundle(await required(source.bytes(path)), hash)
  if (!parsed.ok) throw new Error(`${path}: ${parsed.error.kind}`)
  return parsed.value
}

export function loadSeries(
  source: DataSource,
  level: GeoLevel,
  metric: MetricId,
  denominator: Denominator,
  hash: AreaOrderHash,
): Promise<SeriesBundle> {
  const path = dataPath.series(RELEASE, level, metric, denominator)
  return series(path, async () => {
    const bundle = await readBundle(source, path, hash)
    if (bundle.kind !== 'series') throw new Error(`${path}: not a series bundle`)
    return bundle
  })
}

export function loadSwarm(
  source: DataSource,
  level: GeoLevel,
  metric: MetricId,
  denominator: Denominator,
  hash: AreaOrderHash,
): Promise<SwarmBundle> {
  const path = dataPath.swarm(RELEASE, level, metric, denominator)
  return swarms(path, async () => {
    const bundle = await readBundle(source, path, hash)
    if (bundle.kind !== 'swarm') throw new Error(`${path}: not a swarm bundle`)
    return bundle
  })
}

/** Multiplier from nominal pounds to the reader's basis for one period of a metric. */
export function basisFactor(
  metric: Pick<MetricDefinition, 'unit' | 'periodKind'>,
  basis: Basis,
  period: string,
  catalogue: Catalogue,
): number {
  if (metric.unit !== 'gbp' || metric.periodKind !== 'fiscal-year') return 1
  return applyBasis(1, 'gbp', basis, FiscalYear.parse(period), priceFactors(catalogue))
}

/**
 * The last few derived values by key. Loader data for an unchanged measure
 * keeps its identity, so a view or selection change re-renders nothing that
 * depends only on the numbers.
 */
function recent<T>(capacity: number): (key: string, make: () => T) => T {
  const cache = new Map<string, T>()
  return (key, make) => {
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const value = make()
    cache.set(key, value)
    if (cache.size > capacity) cache.delete(cache.keys().next().value ?? key)
    return value
  }
}

const areaLists = recent<readonly ExploreArea[]>(2)
const maps = recent<ExploreMap>(2)

function mapOf(meta: AreasMeta, level: GeoLevel): ExploreMap {
  const region = meta.regions.find((r) => r.code === INSET_REGION)
  const areas = meta.areas.flatMap((area, i) => (area.region === INSET_REGION ? [i] : []))
  return {
    sprite: dataPath.mapSprite(RELEASE, level),
    bounds: meta.bounds,
    inset:
      region === undefined || areas.length === 0
        ? undefined
        : { label: INSET_LABEL, bounds: region.bounds, areas },
  }
}
const columnSets = recent<readonly ExploreColumn[]>(4)
const swarmViews = recent<ExploreSwarm>(4)
const expectedViews = memoised<ExploreExpected | undefined>()

const round = (value: number): number =>
  Math.abs(value) >= 100 ? Math.round(value * 100) / 100 : Math.round(value * 1e4) / 1e4

const nullable = (value: number): number | null => (Number.isFinite(value) ? round(value) : null)

const PENSIONER_FAMILIES = new Set([
  'state-pension',
  'pension-credit',
  'attendance-allowance',
  'winter-fuel',
])

/** The modelled-spending fit closest to the metric: its own, else by the age group it serves. */
export function fitFor(catalogue: Catalogue, metric: MetricDefinition): ExpectedFit | undefined {
  const fits = catalogue.models.expected.fits
  const own = fits.find((fit) => fit.metric === metric.id || fit.actualMetric === metric.id)
  if (own !== undefined) return own
  const pensioner =
    metric.families.length > 0 && metric.families.every((family) => PENSIONER_FAMILIES.has(family))
  const band: Denominator = pensioner
    ? 'per-aged-66-plus'
    : metric.denominators.includes('per-aged-16-64')
      ? 'per-aged-16-64'
      : 'per-resident'
  return fits.find((fit) => fit.denominator === band) ?? fits[0]
}

export function loadExpected(
  source: DataSource,
  catalogue: Catalogue,
  level: GeoLevel,
  metric: MetricDefinition,
  basis: Basis,
  hash: AreaOrderHash,
): Promise<ExploreExpected | undefined> {
  const fit = fitFor(catalogue, metric)
  return expectedViews(`${level}|${fit?.metric ?? ''}|${basis}`, () =>
    readExpected(source, catalogue, level, metric, basis, hash),
  )
}

async function readExpected(
  source: DataSource,
  catalogue: Catalogue,
  level: GeoLevel,
  metric: MetricDefinition,
  basis: Basis,
  hash: AreaOrderHash,
): Promise<ExploreExpected | undefined> {
  const fit = fitFor(catalogue, metric)
  const actualMetric = fit === undefined ? undefined : findMetric(catalogue, fit.actualMetric)
  if (fit === undefined || actualMetric === undefined || fit.levels[level] === undefined) {
    return undefined
  }
  const period = catalogue.models.expected.period
  const [actual, residual] = await Promise.all([
    loadSeries(source, level, fit.actualMetric, fit.denominator, hash),
    loadSeries(source, level, fit.metric, fit.denominator, hash),
  ])
  const ia = actual.header.periods.indexOf(period)
  const ir = residual.header.periods.indexOf(period)
  if (ia < 0 || ir < 0) return undefined
  const factor = basisFactor(actualMetric, basis, period, catalogue)
  const n = actual.header.areaCount
  return {
    fit,
    period,
    actual: Array.from(actual.values.subarray(ia * n, (ia + 1) * n), (v) => nullable(v * factor)),
    residual: Array.from(residual.values.subarray(ir * n, (ir + 1) * n), (v) =>
      nullable(v * factor),
    ),
    flags: Array.from(residual.flags.subarray(ir * n, (ir + 1) * n)),
  }
}

async function loadDossier(
  source: DataSource,
  level: GeoLevel,
  code: ExploreState['selected'],
): Promise<AreaDossier | undefined> {
  if (code === undefined) return undefined
  const path = dataPath.dossier(RELEASE, level, code)
  return dossiers(path, async () => orThrow(parseAreaDossier(await required(source.json(path)))))
}

/** Everything the explorer shows for the search params as written; bad fields fall back to defaults. */
export async function loadExplore(
  search: Readonly<Record<string, unknown>>,
  source: DataSource = dataSource(),
): Promise<ExploreData> {
  const catalogue = await loadCatalogue(source)
  const resolved = resolveExploreState(decodeExploreQuery(search).query, catalogue).state
  const metric = findMetric(catalogue, resolved.metric)
  if (metric === undefined) throw new Error(`Unknown metric ${resolved.metric}`)
  const { level } = resolved
  const [areas, gb] = await Promise.all([loadAreas(source, level), loadGb(source, level)])
  const hash = areas.areaOrderHash
  const bundles = await Promise.all(
    metric.denominators.map((denominator) =>
      loadSeries(source, level, metric.id, denominator, hash),
    ),
  )
  const periods = bundles[0]?.header.periods ?? metric.periods
  const periodIndex = periods.includes(resolved.period)
    ? periods.indexOf(resolved.period)
    : periods.length - 1
  const period = periods[periodIndex] ?? resolved.period
  const state: ExploreState = { ...resolved, period }
  const factor = basisFactor(metric, state.basis, period, catalogue)

  const [swarm, dossier] = await Promise.all([
    loadSwarm(source, level, metric.id, state.denominator, hash),
    loadDossier(source, level, state.selected),
  ])
  const fit = fitFor(catalogue, metric)
  const expectedFit =
    fit !== undefined &&
    fit.levels[level] !== undefined &&
    findMetric(catalogue, fit.actualMetric) !== undefined
      ? fit
      : undefined
  const n = areas.areas.length
  const swarmPeriod = Math.max(swarm.header.periods.indexOf(period), 0)

  const measure = `${level}|${metric.id}|${period}|${state.basis}`
  const data: ExploreData = {
    catalogue,
    state,
    metric,
    areas: areaLists(level, () =>
      areas.areas.map((area) => ({
        code: area.code,
        name: area.name,
        q: area.hex.q,
        r: area.hex.r,
      })),
    ),
    areaOrderHash: hash,
    map: maps(level, () => mapOf(areas, level)),
    periods,
    columns: columnSets(measure, () =>
      metric.denominators.map((denominator, j) => {
        const bundle = bundles[j]
        const start = periodIndex * n
        const values = bundle?.values.subarray(start, start + n) ?? new Float32Array(n)
        const entry = gb.series.find((s) => s.metric === metric.id && s.denominator === denominator)
        const gi = entry?.periods.indexOf(period) ?? -1
        const gbValue = gi < 0 ? undefined : entry?.values[gi]
        return {
          denominator,
          values: Array.from(values, (v) => nullable(v * factor)),
          flags: Array.from(bundle?.flags.subarray(start, start + n) ?? new Uint8Array(n)),
          gb:
            entry === undefined || gi < 0
              ? undefined
              : {
                  value: gbValue === null || gbValue === undefined ? null : gbValue * factor,
                  rankOf: entry.rankOf[gi] ?? 0,
                },
        }
      }),
    ),
    swarm: swarmViews(`${measure}|${state.denominator}`, () => ({
      xy: Array.from(swarm.xy.subarray(swarmPeriod * n * 2, (swarmPeriod + 1) * n * 2), (v) =>
        // A ten-thousandth of the axis is under a tenth of a pixel on any stage.
        Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null,
      ),
      radius: swarm.header.radius,
      scale: swarm.header.scale,
      domain: swarm.header.domains[swarmPeriod] ?? [0, 1],
      basisFactor: factor,
    })),
    expectedFit,
    selectedDecomposition: dossier?.decomposition,
    selectedSlug: dossier?.area.slug,
  }
  // In the browser the page re-renders as soon as this resolves. A macrotask
  // between reading the files and that render keeps either from making a
  // long frame during a morph.
  if (typeof window !== 'undefined') await new Promise((resolve) => setTimeout(resolve, 0))
  return data
}
