import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AreaCode } from '#/domain/geography.ts'
import { ValueFlag } from '#/domain/measure.ts'
import { decodeExploreQuery } from '#/domain/url-state.ts'
import { fixtureCatalogue } from '#/domain/testing/fixtures.ts'
import { fileSource, hasPulledRelease } from '#/data/testing/file-source.ts'
import { sortAreas } from './AreaTable.tsx'
import { RankRulers } from './heroes/RankRulers.tsx'
import { familiesFor } from './heroes/Waterfall.tsx'
import { scatterPoints } from './heroes/ExpectedScatter.tsx'
import { loadExpected, loadExplore, memoised } from './load.ts'
import { metricGroups, withMetric } from './MetricPicker.tsx'
import { columnView, columnViews, measureKey, queryFor, styleBits, withSelection } from './model.ts'
import { flagChips } from './SelectedPanel.tsx'

describe('view model', () => {
  it('halftones apportioned and modelled values and hatches missing ones', () => {
    const styles = styleBits(
      Float32Array.from([1, 2, Number.NaN, 4]),
      Uint8Array.from([0, ValueFlag.apportioned, 0, ValueFlag.modelled | ValueFlag.harmonised]),
    )

    expect(Array.from(styles)).toEqual([0, 1, 2, 1])
  })

  it('ranks, bins and orders one denominator column', () => {
    const column = columnView('spend-total-vs-model', {
      denominator: 'per-resident',
      values: [-50, null, 120, 0],
      flags: [0, ValueFlag.suppressed, 0, 0],
      gb: undefined,
    })

    expect(column.scaleKind).toBe('diverging')
    expect(column.order).toEqual([2, 3, 0])
    expect(column.ranking.rankOf).toBe(3)
    expect(column.bins[1]).toBe(255)
  })

  it('names flags in plain words', () => {
    expect(flagChips(ValueFlag.apportioned | ValueFlag.smallPopulation)).toEqual([
      'Shared out',
      'Not ranked: under 1,000 people',
    ])
    expect(flagChips(0)).toEqual([])
  })

  it('sorts table rows by value with missing values last, or by name', () => {
    const rows = ['B', 'A', 'C'].map((name, i) => ({
      code: AreaCode.parse(`E1400000${i}`),
      name,
      q: 0,
      r: 0,
    }))
    const column = columnView('spend-total', {
      denominator: 'total',
      values: [5, null, 9],
      flags: [0, 0, 0],
      gb: undefined,
    })

    expect(sortAreas(rows, [column], { by: 'value', denominator: 'total' }, true)).toEqual([
      2, 0, 1,
    ])
    expect(sortAreas(rows, [column], { by: 'value', denominator: 'total' }, false)).toEqual([
      0, 2, 1,
    ])
    expect(sortAreas(rows, [column], { by: 'name' }, false)).toEqual([1, 0, 2])
  })

  it('keeps the denominator and period when the new measure publishes them', () => {
    const catalogue = fixtureCatalogue()
    const metric = catalogue.metrics[0]
    if (metric === undefined) throw new Error('fixture has no metric')
    const state = {
      level: 'constituency',
      metric: metric.id,
      denominator: 'per-aged-0-15',
      basis: 'real-gdp',
      period: '1999-00',
      view: 'swarm',
    } as const
    const next = withMetric(state, metric)

    expect(next.denominator).toBe(metric.defaultDenominator)
    expect(next.period).toBe(metric.periods.at(-1))
    expect(next.view).toBe('swarm')
    expect(metricGroups(catalogue, state).flatMap((g) => g.metrics)).toContain(metric)
  })

  it('names the rulers hero without counting the denominators', () => {
    const metric = fixtureCatalogue().metrics[0]
    if (metric === undefined) throw new Error('fixture has no metric')
    const areas = ['A', 'B'].map((name, i) => ({
      code: AreaCode.parse(`E1400000${i}`),
      name,
      q: 0,
      r: 0,
    }))
    const columns = (['total', 'per-resident', 'per-aged-66-plus'] as const).map((denominator) =>
      columnView(metric.id, { denominator, values: [1, 2], flags: [0, 0], gb: undefined }),
    )
    const html = renderToStaticMarkup(
      createElement(RankRulers, {
        areas,
        columns,
        listed: 'total',
        selected: -1,
        metric,
        level: 'constituency',
        reduced: false,
      }),
    )

    expect(html).not.toMatch(/\b(two|three|four|five) rulers\b/i)
    expect(html).toContain('Does the order change when you count per person?')
  })

  it('rulers stage only within one measure', () => {
    const base = {
      level: 'constituency',
      metric: fixtureCatalogue().defaultMetric,
      denominator: 'total',
      basis: 'real-gdp',
      period: '2024-25',
      view: 'hex',
    } as const

    expect(measureKey(base)).toBe(measureKey({ ...base, denominator: 'per-resident', view: 'map' }))
    expect(measureKey(base)).not.toBe(measureKey({ ...base, basis: 'nominal' }))
  })
})

describe.runIf(hasPulledRelease)('loadExplore on the pulled release', () => {
  it('ranks as many areas as the release publishes for every denominator', async () => {
    const data = await loadExplore({}, fileSource)

    for (const view of columnViews(data.metric.id, data.columns)) {
      expect(view.ranking.rankOf).toBe(view.gb?.rankOf)
    }
  })

  it('sends the browser no link to the code host', async () => {
    const data = await loadExplore({}, fileSource)

    expect(JSON.stringify(data)).not.toMatch(/github/i)
  })

  it('fills every surface for the default state', async () => {
    const data = await loadExplore({}, fileSource)
    const n = data.areas.length

    expect(n).toBe(632)
    expect(data.state.metric).toBe(data.catalogue.defaultMetric)
    expect(data.periods).toContain(data.state.period)
    expect(data.columns.map((c) => c.denominator)).toEqual(data.metric.denominators)
    for (const column of data.columns) expect(column.values).toHaveLength(n)
    expect(data.swarm.xy).toHaveLength(n * 2)
    const expected =
      data.expectedFit &&
      (await loadExpected(
        fileSource,
        data.catalogue,
        data.state.level,
        data.metric,
        data.state.basis,
        data.areaOrderHash,
      ))
    expect(expected?.actual).toHaveLength(n)
    expect(data.selectedDecomposition).toBeUndefined()
  })

  it('changes who leads when only the denominator changes', async () => {
    const data = await loadExplore({}, fileSource)
    const leaders = columnViews(data.metric.id, data.columns).map((column) => column.order[0])

    expect(new Set(leaders).size).toBeGreaterThan(1)
  })

  it('reads the selected area’s decomposition inputs and a council level', async () => {
    const council = await loadExplore(
      decodeExploreQuery({ level: 'local-authority', sel: 'E06000001', view: 'rank' }).query,
      fileSource,
    )

    expect(council.areas).toHaveLength(350)
    expect(council.selectedDecomposition?.length).toBeGreaterThan(0)
    expect(familiesFor(council.catalogue, council.metric).length).toBeGreaterThan(0)
    const expected = await loadExpected(
      fileSource,
      council.catalogue,
      'local-authority',
      council.metric,
      council.state.basis,
      council.areaOrderHash,
    )
    if (council.expectedFit === undefined || expected === undefined)
      throw new Error('no modelled spending fit')
    for (const point of scatterPoints(expected)) {
      expect(point.actual - point.expected).toBeCloseTo(point.residual, 6)
    }
  })

  it('round-trips a selection through the canonical URL', async () => {
    const data = await loadExplore({}, fileSource)
    const code = data.areas[5]?.code
    const query = queryFor(withSelection(data.state, code), data.catalogue)

    expect(query).toEqual({ sel: code })
  })

  it('applies the basis to money values', async () => {
    const real = await loadExplore({}, fileSource)
    const cash = await loadExplore({ basis: 'nominal' }, fileSource)
    const a = real.columns[0]?.values[0] ?? 0
    const b = cash.columns[0]?.values[0] ?? 0

    expect(a).toBeGreaterThan(b)
  })
})

describe('memoised', () => {
  it('loads each key once and retries after a failure', async () => {
    const cache = memoised<number>()
    let calls = 0
    const load = () => {
      calls += 1
      return calls === 1 ? Promise.reject(new Error('first read fails')) : Promise.resolve(calls)
    }

    await expect(cache('k', load)).rejects.toThrow('first read fails')
    expect(await cache('k', load)).toBe(2)
    expect(await cache('k', load)).toBe(2)
    expect(calls).toBe(2)
  })
})
