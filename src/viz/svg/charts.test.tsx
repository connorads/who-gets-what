import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { hexCentre, hexFrame, hexPath } from './hex.ts'
import { Waffle, waffleColumns, waffleRuns, type WaffleItem } from './Waffle.tsx'

const item = (key: string, value: number): WaffleItem => ({
  key,
  label: key,
  color: `var(--family-${key})`,
  value,
  derived: false,
})

describe('waffle', () => {
  it('rounds cumulatively so the squares add up to the rounded total', () => {
    const runs = waffleRuns([item('a', 1.4e6), item('b', 1.4e6), item('c', 0.3e6)], 1e6)

    expect(runs.map((run) => [run.start, run.end])).toEqual([
      [0, 1],
      [1, 3],
      [3, 3],
    ])
  })

  it('draws each family as at most three rectangles', () => {
    const html = renderToStaticMarkup(
      <Waffle id="w" unit={1} columns={10} label="Test" items={[item('a', 7), item('b', 26)]} />,
    )

    expect(html).toContain('<title>Test</title>')
    expect(html.match(/data-family="b"[\s\S]*?<\/g>/)?.[0].match(/<rect/g)).toHaveLength(3)
  })

  it('keeps a wide block for large totals', () => {
    expect(waffleColumns(400)).toBe(35)
    expect(waffleColumns(10)).toBe(20)
  })
})

describe('hex geometry', () => {
  it('shifts odd rows half a hex right and puts north at the top', () => {
    const [x0, y0] = hexCentre({ q: 0, r: 0 })
    const [x1, y1] = hexCentre({ q: 0, r: 1 })

    expect(x1 - x0).toBeCloseTo(Math.sqrt(3) / 2)
    expect(y1).toBeLessThan(y0)
  })

  it('draws one closed path per hex', () => {
    const cells = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]

    expect(hexPath(cells, hexFrame(cells), 10).match(/z/g)).toHaveLength(2)
  })
})
