/**
 * Four rulers: every area's rank under each denominator, joined as a bump
 * chart. The ten highest under the listed denominator, and the selected
 * area, are drawn in ink; when the denominator changes their lines redraw
 * after the canvas dots settle. Rank 1 is the highest value.
 *
 * The faint lines for every area are one path. The server renders it as
 * SVG; in the browser a 2D canvas behind the SVG draws it once, so the
 * highlighted lines animate without the browser repainting 632 others.
 */
import { scaleLinear, scalePoint } from '@visx/scale'
import { gsap } from 'gsap'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { MetricDefinition } from '#/domain/contract.ts'
import type { Denominator } from '#/domain/measure.ts'
import { LEVEL_LABEL } from '#/content/labels.ts'
import { MOTION } from '#/viz/motion.ts'
import type { GeoLevel } from '#/domain/geography.ts'
import { DARK_QUERY, THEME_EVENT } from '#/lib/preferences.ts'
import { denominatorControlLabel } from '../Controls.tsx'
import type { ExploreArea } from '../load.ts'
import type { ColumnView } from '../model.ts'

const WIDTH = 1080
const HEIGHT = 400
const MARGIN = { top: 40, right: 240, bottom: 16, left: 40 }

export interface Label {
  readonly area: number
  readonly y: number
  readonly at: number
}

/** Push labels apart to at least `gap` pixels, keeping their order and staying above `max`. */
export function spreadLabels(labels: readonly Label[], gap: number, max: number): readonly Label[] {
  const sorted = labels.toSorted((a, b) => a.y - b.y)
  const placed: Label[] = []
  for (const label of sorted) {
    const previous = placed.at(-1)
    placed.push({
      ...label,
      at: previous === undefined ? label.y : Math.max(label.y, previous.at + gap),
    })
  }
  const overflow = (placed.at(-1)?.at ?? 0) - max
  return overflow > 0 ? placed.map((label) => ({ ...label, at: label.at - overflow })) : placed
}

/** Scales and a path builder: one area's line through its rank under each denominator. */
function rankGeometry(columns: readonly ColumnView[]) {
  const rankOf = Math.max(...columns.map((column) => column.ranking.rankOf), 1)
  const x = scalePoint({
    domain: columns.map((column) => column.denominator),
    range: [MARGIN.left, WIDTH - MARGIN.right],
  })
  const y = scaleLinear({ domain: [1, rankOf], range: [MARGIN.top, HEIGHT - MARGIN.bottom] })
  /** Whole units suit the faint background lines and keep the page small; highlights keep a decimal. */
  const path = (area: number, digits = 1): string =>
    columns
      .map((column) => {
        const rank = column.ranking.ranks[area] ?? 0
        return rank > 0
          ? `${(x(column.denominator) ?? 0).toFixed(digits)},${y(rank).toFixed(digits)}`
          : null
      })
      .filter((point) => point !== null)
      .map((point, i) => `${i === 0 ? 'M' : 'L'}${point}`)
      .join('')
  return { rankOf, x, y, path }
}

/**
 * Stroke SVG path data `d` on `canvas`, in the chart's viewBox units, and
 * again on resize or a theme change. True once drawn, so the SVG copy can go.
 */
function useCanvasPath(canvasRef: RefObject<HTMLCanvasElement | null>, d: string): boolean {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas === null || canvas === undefined || context === null || context === undefined)
      return undefined
    const path = new Path2D(d)
    const draw = () => {
      const { clientWidth: width, clientHeight: height } = canvas
      if (width === 0 || height === 0) return
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0)
      // The canvas's `color` is the token, resolved by CSS for the active theme.
      context.strokeStyle = getComputedStyle(canvas).color
      context.globalAlpha = 0.7
      context.lineWidth = 0.6
      context.stroke(path)
      setDrawn(true)
    }
    draw()
    const resize = new ResizeObserver(draw)
    resize.observe(canvas)
    const media = window.matchMedia(DARK_QUERY)
    window.addEventListener(THEME_EVENT, draw)
    media.addEventListener('change', draw)
    return () => {
      resize.disconnect()
      window.removeEventListener(THEME_EVENT, draw)
      media.removeEventListener('change', draw)
    }
  }, [canvasRef, d])
  return drawn
}

function RankRulersImpl({
  areas,
  columns,
  listed,
  selected,
  metric,
  level,
  reduced,
}: {
  readonly areas: readonly ExploreArea[]
  readonly columns: readonly ColumnView[]
  /** The denominator whose top ten are highlighted; it lags the URL until the dots settle. */
  readonly listed: Denominator
  readonly selected: number
  readonly metric: MetricDefinition
  readonly level: GeoLevel
  readonly reduced: boolean
}) {
  const active = columns.find((column) => column.denominator === listed) ?? columns[0]
  const { rankOf, x, y, path } = useMemo(() => rankGeometry(columns), [columns])
  // 632 faint lines that only a new measure changes; the listed denominator does not.
  const background = useMemo(() => areas.map((_, i) => path(i, 0)).join(''), [areas, path])
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawn = useCanvasPath(canvas, background)
  const top = active?.order.slice(0, 10) ?? []
  const emphasised = selected >= 0 && !top.includes(selected) ? [...top, selected] : top
  const last = columns.at(-1)
  const labels = spreadLabels(
    emphasised.map((area) => ({
      area,
      y: y(last?.ranking.ranks[area] || rankOf),
      at: 0,
    })),
    12.5,
    HEIGHT - 6,
  )

  if (columns.length < 2) return null
  const many = LEVEL_LABEL[level].many

  return (
    <figure className="viz-hero" aria-labelledby="rulers-title">
      <p className="kicker">Total or per person</p>
      <h2 id="rulers-title" className="hero-title">
        Does the order change when you count per person?
      </h2>
      <p className="hero-lede">
        Each line is one of the {rankOf.toLocaleString('en-GB')} ranked {many}. It joins the area's
        rank for each way of counting. The 10 highest{' '}
        {denominatorControlLabel(listed, metric).toLowerCase()} are drawn in dark lines
        {selected >= 0 ? ', and the selected area in gold' : ''}.
      </p>
      <div className="chart-scroll mt-4">
        <div className="chart-wide relative">
          <canvas
            ref={canvas}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ color: 'var(--rule)' }}
            aria-hidden="true"
          />
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="relative block w-full"
            aria-labelledby="rulers-title"
          >
            <g>
              {columns.map((column) => (
                <g
                  key={column.denominator}
                  transform={`translate(${x(column.denominator) ?? 0}, 0)`}
                >
                  <line
                    y1={MARGIN.top - 6}
                    y2={HEIGHT - MARGIN.bottom}
                    stroke="var(--rule-strong)"
                  />
                  <text
                    y={MARGIN.top - 16}
                    textAnchor="middle"
                    className="hero-axis-label"
                    data-active={column.denominator === listed ? 'true' : undefined}
                  >
                    {denominatorControlLabel(column.denominator, metric)}
                  </text>
                </g>
              ))}
              <text x={MARGIN.left - 8} y={y(1) + 4} textAnchor="end" className="stage-tick">
                1
              </text>
              <text x={MARGIN.left - 8} y={y(rankOf)} textAnchor="end" className="stage-tick">
                {rankOf}
              </text>
              {drawn ? null : (
                <path
                  d={background}
                  fill="none"
                  stroke="var(--rule)"
                  strokeWidth="0.6"
                  opacity="0.7"
                />
              )}
              <HighlightLines
                key={listed}
                reduced={reduced}
                lines={emphasised.map((area) => ({
                  area,
                  d: path(area),
                  selected: area === selected,
                }))}
              />
              {labels.map((label) => {
                const rank = last?.ranking.ranks[label.area] ?? 0
                const lastX = x(last?.denominator ?? listed) ?? 0
                return (
                  <g key={label.area}>
                    <line
                      x1={lastX + 3}
                      x2={lastX + 12}
                      y1={label.y}
                      y2={label.at}
                      stroke="var(--rule-strong)"
                      strokeWidth="0.6"
                    />
                    <text x={lastX + 15} y={label.at + 3.5} className="hero-line-label">
                      {areas[label.area]?.name}
                      <tspan className="hero-line-rank"> {rank > 0 ? rank : ''}</tspan>
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        </div>
      </div>
    </figure>
  )
}

/** The emphasised lines, drawn in once per mount: a new listed denominator remounts them. */
function HighlightLines({
  lines,
  reduced,
}: {
  readonly lines: readonly {
    readonly area: number
    readonly d: string
    readonly selected: boolean
  }[]
  readonly reduced: boolean
}) {
  const group = useRef<SVGGElement>(null)
  useLayoutEffect(() => {
    const element = group.current
    if (element === null) return undefined
    const paths = Array.from(element.querySelectorAll('path'))
    const context = gsap.context(() => {
      if (reduced) {
        gsap.fromTo(paths, { opacity: 0 }, { opacity: 1, duration: MOTION.fade, ease: 'none' })
        return
      }
      for (const path of paths) {
        const length = path.getTotalLength()
        gsap.fromTo(
          path,
          { strokeDasharray: length, strokeDashoffset: length },
          {
            strokeDashoffset: 0,
            duration: MOTION.bump,
            ease: 'power2.inOut',
            clearProps: 'strokeDasharray,strokeDashoffset',
          },
        )
      }
    }, element)
    return () => context.revert()
  }, [reduced])
  return (
    <g ref={group}>
      {lines.map((line) => (
        <path
          key={line.area}
          d={line.d}
          fill="none"
          stroke={line.selected ? 'var(--brass)' : 'var(--ink)'}
          strokeWidth={line.selected ? 2.5 : 1.4}
          strokeLinejoin="round"
        />
      ))}
    </g>
  )
}

/** Memoised: loader data keeps its identity across view and selection changes. */
export const RankRulers = memo(RankRulersImpl)
