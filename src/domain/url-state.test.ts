import { describe, expect, it } from 'vitest'
import { exploreSearch } from './explore-search.ts'
import { GeoLevel } from './geography.ts'
import { Basis } from './measure.ts'
import { fixtureCatalogue } from './testing/fixtures.ts'
import {
  decodeExploreQuery,
  encodeExploreState,
  parseRankRoute,
  resolveExploreState,
  viewFor,
  viewsFor,
  type ExploreState,
} from './url-state.ts'

const catalogue = fixtureCatalogue()

const viaUrl = (state: ExploreState): ExploreState => {
  const search = new URLSearchParams(encodeExploreState(state, catalogue)).toString()
  const raw = exploreSearch(Object.fromEntries(new URLSearchParams(search)))
  return resolveExploreState(decodeExploreQuery(raw).query, catalogue).state
}

describe('exploreSearch', () => {
  it('keeps the explorer keys as strings and leaves decoding to the codec', () => {
    const raw = { level: 'local-authority', period: 202603, sel: 'nonsense', utm: 'x' }

    expect(exploreSearch(raw)).toEqual({ level: 'local-authority', sel: 'nonsense' })
    expect(decodeExploreQuery(exploreSearch(raw)).query).toEqual({ level: 'local-authority' })
  })
})

/** Every coherent state the fixture catalogue allows, with and without selections. */
function allStates(): ExploreState[] {
  const states: ExploreState[] = []
  for (const level of GeoLevel.options) {
    const selected = level === 'constituency' ? 'E14001074' : 'E06000001'
    const compared = level === 'constituency' ? 'W07000081' : 'W06000001'
    for (const metric of catalogue.metrics.filter((m) => m.levels.includes(level))) {
      for (const denominator of metric.denominators) {
        for (const period of metric.periods) {
          for (const basis of Basis.options) {
            for (const view of viewsFor(level)) {
              const base = { level, metric: metric.id, denom: denominator, basis, period, view }
              states.push(
                resolveExploreState(decodeExploreQuery(base).query, catalogue).state,
                resolveExploreState(
                  decodeExploreQuery({ ...base, sel: selected, vs: compared }).query,
                  catalogue,
                ).state,
              )
            }
          }
        }
      }
    }
  }
  return states
}

describe('explore URL state', () => {
  it('round-trips every coherent state through a real URL', () => {
    const states = allStates()

    expect(states.length).toBeGreaterThan(100)
    for (const state of states) expect(viaUrl(state)).toEqual(state)
  })

  it('encodes the default view as a bare /explore', () => {
    const { state } = resolveExploreState({}, catalogue)

    expect(encodeExploreState(state, catalogue)).toEqual({})
    expect(state).toEqual({
      level: 'constituency',
      metric: 'spend-pensioner',
      denominator: 'per-aged-66-plus',
      basis: 'real-gdp',
      period: '2024-25',
      view: 'map',
    })
  })

  it('offers equal-size hexes for constituencies only, and the map otherwise', () => {
    const { state, issues } = resolveExploreState(
      decodeExploreQuery({ level: 'local-authority', view: 'hex' }).query,
      catalogue,
    )

    expect(state.view).toBe('map')
    expect(issues).toEqual([
      { key: 'view', input: 'hex', reason: 'not offered for local-authority' },
    ])
    expect(
      resolveExploreState(decodeExploreQuery({ view: 'hex' }).query, catalogue).state.view,
    ).toBe('hex')
    expect(viewsFor('local-authority')).toEqual(['map', 'swarm', 'rank'])
    expect(viewFor('constituency', undefined)).toBe('map')
  })

  it('writes keys in grammar order so each state has one URL', () => {
    const { state } = resolveExploreState(
      decodeExploreQuery({ vs: 'W07000081', sel: 'E14001074', view: 'swarm', basis: 'nominal' })
        .query,
      catalogue,
    )

    expect(Object.keys(encodeExploreState(state, catalogue))).toEqual([
      'basis',
      'view',
      'sel',
      'vs',
    ])
  })

  it('falls back field by field and reports each issue', () => {
    const { query, issues: malformed } = decodeExploreQuery({
      metric: 'Spend Pensioner',
      view: 'globe',
      period: '2024-25',
      utm_source: 'newsletter',
    })
    const { state, issues } = resolveExploreState(
      { ...query, denom: 'per-aged-0-15', sel: 'E06000001' },
      catalogue,
    )

    expect(malformed.map((issue) => issue.key)).toEqual(['metric', 'view'])
    expect(issues.map((issue) => issue.key)).toEqual(['denom', 'sel'])
    expect(state).toMatchObject({
      metric: 'spend-pensioner',
      denominator: 'per-aged-66-plus',
      view: 'map',
    })
  })

  it('drops a metric the level does not publish and keeps the rest of the state', () => {
    const { state, issues } = resolveExploreState(
      decodeExploreQuery({
        level: 'local-authority',
        metric: 'claimants-pension-credit',
        basis: 'nominal',
      }).query,
      catalogue,
    )

    expect(state).toMatchObject({
      level: 'local-authority',
      metric: 'spend-pensioner',
      basis: 'nominal',
    })
    expect(issues).toEqual([
      {
        key: 'metric',
        input: 'claimants-pension-credit',
        reason: 'not available for local-authority',
      },
    ])
  })

  it('resolves the period against the metric, so a fiscal year never reads as a month', () => {
    const { state, issues } = resolveExploreState(
      decodeExploreQuery({ metric: 'claimants-pension-credit', period: '2010-11' }).query,
      catalogue,
    )

    expect(state.period).toBe('2026-03')
    expect(issues.map((issue) => issue.key)).toEqual(['period'])
  })

  it('needs a selection before a comparison', () => {
    const { state, issues } = resolveExploreState(
      decodeExploreQuery({ vs: 'E14001074' }).query,
      catalogue,
    )

    expect(state.compared).toBeUndefined()
    expect(issues.map((issue) => issue.reason)).toEqual(['needs sel'])
  })
})

describe('parseRankRoute', () => {
  it('accepts a published metric and denominator pair', () => {
    const route = parseRankRoute({ metric: 'spend-pensioner', denom: 'per-resident' }, catalogue)

    expect(route.ok && route.value.denominator).toBe('per-resident')
  })

  it('treats an unpublished pair as not found', () => {
    expect(
      parseRankRoute({ metric: 'spend-pensioner', denom: 'per-aged-0-15' }, catalogue).ok,
    ).toBe(false)
    expect(parseRankRoute({ metric: 'no-such-metric', denom: 'total' }, catalogue).ok).toBe(false)
  })
})
