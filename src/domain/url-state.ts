/**
 * The URL-state codec. One grammar serves the explorer's search params, rank
 * page paths and, later, MCP tool inputs, so a state shared by any of them
 * opens the same view.
 *
 *   /explore?level=&metric=&denom=&basis=&period=&view=&sel=&vs=
 *
 * Decoding never fails: an unusable field falls back to its default and is
 * reported as an issue. Encoding omits defaults and writes keys in a fixed
 * order, so every state has exactly one canonical URL.
 */
import { z } from 'zod/mini'
import type { Catalogue, MetricDefinition } from './contract.ts'
import { EXPLORE_KEYS, type ExploreKey } from './explore-search.ts'
import { GeoLevel, parseAreaCode, type AreaCode } from './geography.ts'
import { Basis, DEFAULT_BASIS, Denominator, MetricId } from './measure.ts'
import { err, ok, type Result } from './result.ts'

const findMetric = (catalogue: Catalogue, id: string): MetricDefinition | undefined =>
  catalogue.metrics.find((metric) => metric.id === id)

export const View = z.enum(['hex', 'map', 'swarm', 'rank'])
export type View = z.infer<typeof View>

export const DEFAULT_LEVEL: GeoLevel = 'constituency'
/** The real map, with London drawn again larger in an inset, so places look as they are. */
export const DEFAULT_VIEW: View = 'map'

/** The views a level offers: equal-size hexes exist for constituencies only. */
export function viewsFor(level: GeoLevel): readonly View[] {
  return level === 'constituency' ? ['map', 'hex', 'swarm', 'rank'] : ['map', 'swarm', 'rank']
}

/** The view asked for, or the default when there is none or the level does not offer it. */
export function viewFor(level: GeoLevel, view: View | undefined): View {
  return view !== undefined && viewsFor(level).includes(view) ? view : DEFAULT_VIEW
}

/** Syntactically valid explorer fields, before the catalogue resolves them. */
export const ExploreQuery = z.strictObject({
  level: z.optional(GeoLevel),
  metric: z.optional(MetricId),
  denom: z.optional(Denominator),
  basis: z.optional(Basis),
  period: z.optional(z.string().check(z.regex(/^\d{4}-\d{2}$/))),
  view: z.optional(View),
  sel: z.optional(z.string().check(z.regex(/^[ESW]\d{8}$/))),
  vs: z.optional(z.string().check(z.regex(/^[ESW]\d{8}$/))),
})
export type ExploreQuery = z.infer<typeof ExploreQuery>

export interface StateIssue {
  readonly key: ExploreKey
  readonly input: unknown
  readonly reason: string
}

export interface ExploreState {
  readonly level: GeoLevel
  readonly metric: MetricId
  readonly denominator: Denominator
  readonly basis: Basis
  readonly period: string
  readonly view: View
  readonly selected?: AreaCode
  readonly compared?: AreaCode
}

/** Read whatever the URL holds; unknown keys are ignored, bad values dropped. */
export function decodeExploreQuery(raw: Readonly<Record<string, unknown>>): {
  readonly query: ExploreQuery
  readonly issues: readonly StateIssue[]
} {
  const fields: Record<string, unknown> = {}
  const issues: StateIssue[] = []
  for (const key of EXPLORE_KEYS) {
    const input = raw[key]
    if (input === undefined) continue
    const field = ExploreQuery.shape[key].safeParse(input)
    if (field.success) fields[key] = field.data
    else issues.push({ key, input, reason: 'malformed' })
  }
  return { query: ExploreQuery.parse(fields), issues }
}

function metricFor(
  catalogue: Catalogue,
  level: GeoLevel,
  id: string | undefined,
): MetricDefinition {
  const supports = (metric: MetricDefinition | undefined): metric is MetricDefinition =>
    metric !== undefined && metric.levels.includes(level)
  const requested = id === undefined ? undefined : findMetric(catalogue, id)
  if (supports(requested)) return requested
  const fallback = findMetric(catalogue, catalogue.defaultMetric)
  if (supports(fallback)) return fallback
  const first = catalogue.metrics.find(supports)
  if (first === undefined) throw new Error(`Catalogue has no metric for ${level}`)
  return first
}

function choose<T>(
  requested: T | undefined,
  allowed: readonly T[],
  fallback: T,
  onReject: (input: T) => void,
): T {
  if (requested === undefined) return fallback
  if (allowed.includes(requested)) return requested
  onReject(requested)
  return fallback
}

const latestPeriod = (metric: MetricDefinition): string => metric.periods.at(-1) ?? ''

/** Resolve a query against the catalogue into a complete, coherent state. */
export function resolveExploreState(
  query: ExploreQuery,
  catalogue: Catalogue,
): { readonly state: ExploreState; readonly issues: readonly StateIssue[] } {
  const issues: StateIssue[] = []
  const reject = (key: ExploreKey, input: unknown, reason: string): undefined => {
    issues.push({ key, input, reason })
    return undefined
  }

  const level = query.level ?? DEFAULT_LEVEL
  const metric = metricFor(catalogue, level, query.metric)
  if (query.metric !== undefined && query.metric !== metric.id) {
    reject('metric', query.metric, `not available for ${level}`)
  }
  const denominator = choose(query.denom, metric.denominators, metric.defaultDenominator, (input) =>
    reject('denom', input, `not offered for ${metric.id}`),
  )
  const period = choose(query.period, metric.periods, latestPeriod(metric), (input) =>
    reject('period', input, `not published for ${metric.id}`),
  )

  const area = (key: 'sel' | 'vs', code: string | undefined): AreaCode | undefined => {
    if (code === undefined) return undefined
    const parsed = parseAreaCode(code, level)
    return parsed.ok ? parsed.value : reject(key, code, `not a ${level} code`)
  }
  const selected = area('sel', query.sel)
  const compared = selected === undefined ? undefined : area('vs', query.vs)
  if (selected === undefined && query.vs !== undefined) reject('vs', query.vs, 'needs sel')
  if (compared !== undefined && compared === selected) reject('vs', query.vs, 'same as sel')
  const view = viewFor(level, query.view)
  if (query.view !== undefined && query.view !== view) {
    reject('view', query.view, `not offered for ${level}`)
  }

  const state: ExploreState = {
    level,
    metric: metric.id,
    denominator,
    basis: query.basis ?? DEFAULT_BASIS,
    period,
    view,
    ...(selected === undefined ? {} : { selected }),
    ...(compared === undefined || compared === selected ? {} : { compared }),
  }
  return { state, issues }
}

/** The canonical search params for a state: defaults omitted, keys in grammar order. */
export function encodeExploreState(
  state: ExploreState,
  catalogue: Catalogue,
): Record<string, string> {
  const metric = metricFor(catalogue, state.level, state.metric)
  const entries: readonly (readonly [ExploreKey, string | undefined, string | undefined])[] = [
    ['level', state.level, DEFAULT_LEVEL],
    ['metric', state.metric, metricFor(catalogue, state.level, undefined).id],
    ['denom', state.denominator, metric.defaultDenominator],
    ['basis', state.basis, DEFAULT_BASIS],
    ['period', state.period, latestPeriod(metric)],
    ['view', state.view, DEFAULT_VIEW],
    ['sel', state.selected, undefined],
    ['vs', state.compared, undefined],
  ]
  const params: Record<string, string> = {}
  for (const [key, value, fallback] of entries) {
    if (value !== undefined && value !== fallback) params[key] = value
  }
  return params
}

export interface RankRoute {
  readonly metric: MetricDefinition
  readonly denominator: Denominator
}

export interface UnknownRank {
  readonly kind: 'unknown-rank'
  readonly metric: string
  readonly denominator: string
}

/** Resolve `/rank/{metric}/{denom}`. Unknown pairs are a 404, not a fallback. */
export function parseRankRoute(
  params: { readonly metric: string; readonly denom: string },
  catalogue: Catalogue,
): Result<RankRoute, UnknownRank> {
  const metric = findMetric(catalogue, params.metric)
  const denominator = Denominator.safeParse(params.denom)
  if (
    metric === undefined ||
    !denominator.success ||
    !metric.denominators.includes(denominator.data)
  ) {
    return err({ kind: 'unknown-rank', metric: params.metric, denominator: params.denom })
  }
  return ok({ metric, denominator: denominator.data })
}
