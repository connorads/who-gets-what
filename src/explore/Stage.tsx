/**
 * The explorer's figure. The server renders the SVG; after first paint the
 * engine chunk loads lazily and, once its first frame is drawn, the canvas
 * cross-fades in over the SVG. Keyboard readers move through areas in rank
 * order with a roving-tabindex list, and a live region reads out each one.
 */
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import type { MetricDefinition } from '#/domain/contract.ts'
import { perLabel } from '#/domain/measure.ts'
import type { View } from '#/domain/url-state.ts'
import { useReducedMotion } from '#/lib/preferences-dom.ts'
import { binEdges, tokenOf, NO_VALUE } from '#/viz/colour.ts'
import { rankTicks, swarmTicks } from '#/viz/axes.ts'
import type { EngineLayout, EngineScene, SkylineInput } from '#/viz/engine/engine.ts'
import { LEVEL_LABEL } from '#/content/labels.ts'
import { capitalise } from '#/content/sentences.ts'
import { formatValue, ordinal, periodLabel, type ValueFormat } from '#/lib/format.ts'
import { flagChips } from './SelectedPanel.tsx'
import type { ExploreData } from './load.ts'
import { measureKey, swarmArray, type ColumnView } from './model.ts'
import { StageSvg, SwarmAxisMarks } from './StageSvg.tsx'

// The server never renders the canvas, so its build leaves the engine out.
const ExplorerCanvas = import.meta.env.SSR
  ? () => null
  : lazy(() => import('#/viz/engine/ExplorerCanvas.tsx'))

type EngineStatus = 'waiting' | 'loading' | 'ready' | 'unavailable'

function hasWebGl2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}

/** Longer than the canvas's cross-fade over the SVG (`--dur-panel`). */
const SVG_RETIRE_MS = 1000

interface Skyline extends SkylineInput {
  /** The value a full-height shape stands for. */
  readonly max: number
  /** The three tallest areas, for the caption. */
  readonly top: readonly number[]
}

/**
 * Heights from zero for the column on screen, or why there are none: a
 * height can only stand for a value of zero or more.
 */
export function skylineFor(values: Float32Array): Skyline | string {
  let max = 0
  for (const value of values) {
    if (value < 0) return 'This measure has values below zero, so it cannot be shown as heights.'
    if (Number.isFinite(value)) max = Math.max(max, value)
  }
  if (max <= 0) return 'No area has a value above zero, so there is nothing to show in 3D.'
  const heights = Float32Array.from(values, (v) => (Number.isFinite(v) ? v / max : 0))
  const top = Array.from(values.keys())
    .filter((i) => Number.isFinite(values[i]))
    .toSorted((a, b) => (values[b] ?? 0) - (values[a] ?? 0))
    .slice(0, 3)
  return { heights, max, top }
}

/** The one-line reason for the equal-size view. */
export const EQUAL_AREAS_NOTE =
  'Equal-size areas: every constituency is one hexagon of the same size, so small city seats show as clearly as large rural ones.'

export interface StageProps {
  readonly data: ExploreData
  readonly column: ColumnView
  readonly selected: number
  readonly onSelect: (area: number) => void
  readonly onView: (view: View) => void
}

export function Stage({ data, column, selected, onSelect, onView }: StageProps) {
  const { state, metric, areas } = data
  const reduced = useReducedMotion()
  const [status, setStatus] = useState<EngineStatus>('waiting')
  const [focused, setFocused] = useState(-1)
  const [hover, setHover] = useState<{ area: number; x: number; y: number } | null>(null)
  const [layout, setLayout] = useState<EngineLayout | null>(null)
  // The stage's real box, so the SVG frames the map as the canvas will and the hand-over does not jump.
  const stageBox = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>()
  useEffect(() => {
    const element = stageBox.current
    if (element === null) return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setStageSize({ width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const [raised, setRaised] = useState(false)
  // The skyline stands on the map, for whatever measure the map shows.
  const heights = useMemo(() => skylineFor(column.values), [column.values])
  const skyline =
    raised && state.view === 'map' && typeof heights !== 'string' && !reduced ? heights : undefined
  const swarmXY = useMemo(() => swarmArray(data.swarm.xy), [data.swarm])
  const format = useMemo(
    () => ({ unit: metric.unit, denominator: column.denominator, rateScale: metric.rateScale }),
    [metric, column.denominator],
  )
  const level = LEVEL_LABEL[state.level]

  // Load the engine after first paint, when the browser is idle.
  useEffect(() => {
    const start = () =>
      setStatus((s) => (s !== 'waiting' ? s : hasWebGl2() ? 'loading' : 'unavailable'))
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(start, { timeout: 1200 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(start, 200)
    return () => clearTimeout(id)
  }, [])

  const scene: EngineScene = useMemo(
    () => ({
      view: state.view,
      hex: areas,
      rankValues: column.values,
      swarmXY,
      swarmRadius: data.swarm.radius,
      bins: column.bins,
      scaleKind: column.scaleKind,
      styles: column.styles,
      selected,
      focused,
    }),
    [state.view, areas, column, swarmXY, data.swarm.radius, selected, focused],
  )

  // The off-screen list of every area relabels in idle time, not in a morph's first frame.
  const listColumn = useDeferredValue(column)
  const order = useMemo(() => {
    const ranked = new Set(listColumn.order)
    return [...listColumn.order, ...areas.map((_, i) => i).filter((i) => !ranked.has(i))]
  }, [listColumn.order, areas])

  /** A reader-facing sentence per area for one column, with the per-column words worked out once. */
  const describerFor = useCallback(
    (shown: ColumnView) => {
      const shownFormat = {
        unit: metric.unit,
        denominator: shown.denominator,
        rateScale: metric.rateScale,
      }
      const of = `of ${shown.ranking.rankOf.toLocaleString('en-GB')} ${level.many}`
      const tail = `${perLabel(metric, shown.denominator)}, ${periodLabel(state.period, metric.periodKind)}`
      return (area: number): string => {
        const meta = areas[area]
        if (meta === undefined) return ''
        const rank = shown.ranking.ranks[area] ?? 0
        const where = rank > 0 ? `${ordinal(rank)} ${of}` : 'not ranked'
        return `${meta.name}: ${formatValue(shown.values[area] ?? Number.NaN, shownFormat)} ${tail}, ${where}.`
      }
    },
    [areas, level.many, metric, state.period],
  )
  const describe = useMemo(() => describerFor(column), [describerFor, column])
  const describeListed = useMemo(() => describerFor(listColumn), [describerFor, listColumn])

  const announce =
    focused >= 0 ? describe(focused) : selected >= 0 ? `Selected ${describe(selected)}` : ''
  const tooltipArea = hover !== null && hover.area >= 0 ? hover.area : focused
  const anchor =
    hover !== null && hover.area >= 0
      ? { x: hover.x, y: hover.y }
      : focused >= 0 && layout !== null
        ? { x: layout.centres[focused * 2] ?? 0, y: layout.centres[focused * 2 + 1] ?? 0 }
        : null

  // Leaving the map settles the skyline; it does not rise again on return.
  const [viewSeen, setViewSeen] = useState(state.view)
  if (viewSeen !== state.view) {
    setViewSeen(state.view)
    if (state.view !== 'map') setRaised(false)
  }

  const toggleSkyline = () => {
    if (skyline !== undefined) {
      setRaised(false)
      return
    }
    if (state.view !== 'map') onView('map')
    setRaised(true)
  }
  const skylineBlocked = reduced
    ? 'The 3D view is off because you chose to reduce motion'
    : typeof heights === 'string'
      ? heights
      : undefined

  const canvasVisible = status === 'ready'
  // Once the canvas has faded in, the hidden SVG leaves the page, so a change
  // restyles no fallback marks behind it. It returns if the canvas goes.
  const [svgRetired, setSvgRetired] = useState(false)
  useEffect(() => {
    if (!canvasVisible) return undefined
    const id = setTimeout(() => setSvgRetired(true), SVG_RETIRE_MS)
    return () => clearTimeout(id)
  }, [canvasVisible])
  const title = `${metric.label}, ${perLabel(metric, column.denominator)}, ${periodLabel(state.period, metric.periodKind)}, by ${level.one}`

  return (
    <figure className="stage-figure" aria-labelledby="stage-caption">
      <div className="stage-toolbar">
        <button
          type="button"
          className="stage-button"
          aria-pressed={skyline !== undefined}
          disabled={skylineBlocked !== undefined || status !== 'ready'}
          title={skylineBlocked}
          onClick={toggleSkyline}
          data-testid="skyline-toggle"
        >
          {skyline === undefined ? '3D view' : 'Flat view'}
        </button>
      </div>
      {status === 'waiting' ? null : (
        <AreaNavigator
          order={order}
          focused={focused}
          selected={selected}
          describe={describeListed}
          label={`${level.titleMany} in rank order. Use the arrow keys to move between them and Enter to select one.`}
          onFocusArea={setFocused}
          onSelect={onSelect}
        />
      )}
      <div ref={stageBox} className="stage" data-view={state.view} data-engine={status}>
        <div className="stage-svg-layer" data-hidden={canvasVisible ? 'true' : undefined}>
          {canvasVisible && svgRetired ? null : (
            <StageSvg
              view={state.view}
              map={data.map}
              areas={areas}
              column={column}
              swarm={data.swarm}
              swarmXY={swarmXY}
              selected={selected}
              title={title}
              formatTick={(value) => formatValue(value, format)}
              size={stageSize}
            />
          )}
        </div>
        {status === 'loading' || status === 'ready' ? (
          <Suspense fallback={null}>
            <ExplorerCanvas
              key={state.level}
              level={state.level}
              areaOrderHash={data.areaOrderHash}
              map={data.map}
              scene={scene}
              measureKey={measureKey(state)}
              denominator={column.denominator}
              reduced={reduced}
              skyline={skyline}
              onHover={(area, x, y) => setHover(area >= 0 ? { area, x, y } : null)}
              onSelect={(area) => {
                if (area >= 0) onSelect(area)
              }}
              onLayout={setLayout}
              onReady={() => setStatus('ready')}
              onError={(error) => {
                console.warn('Explorer canvas unavailable', error)
                setStatus('unavailable')
              }}
            />
          </Suspense>
        ) : null}
        {canvasVisible && layout !== null && layout.view === state.view ? (
          <CanvasAxes layout={layout} data={data} column={column} format={format} />
        ) : null}
        {canvasVisible &&
        layout?.view === 'map' &&
        state.view === 'map' &&
        layout.inset !== undefined &&
        skyline === undefined ? (
          <div
            className="stage-inset"
            style={{
              left: layout.inset.rect.x,
              top: layout.inset.rect.y,
              width: layout.inset.rect.width,
              height: layout.inset.rect.height,
            }}
            aria-hidden="true"
            data-testid="stage-inset"
          >
            <span className="stage-inset__label">{data.map.inset?.label}</span>
          </div>
        ) : null}
        {tooltipArea >= 0 && anchor !== null && skyline === undefined ? (
          <StageTooltip
            x={anchor.x}
            y={anchor.y}
            flip={anchor.x > (layout?.size.width ?? 800) * 0.6}
            name={areas[tooltipArea]?.name ?? ''}
            value={formatValue(column.values[tooltipArea], format)}
            label={perLabel(metric, column.denominator)}
            rank={column.ranking.ranks[tooltipArea] ?? 0}
            rankOf={column.ranking.rankOf}
            chips={flagChips(column.flags[tooltipArea] ?? 0)}
          />
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite" data-testid="stage-announcer">
        {announce}
      </p>
      {skyline === undefined ? null : (
        <SkylineKey
          max={formatValue(skyline.max, format)}
          half={formatValue(skyline.max / 2, format)}
          label={perLabel(metric, column.denominator)}
          tallest={skyline.top.map((i) => areas[i]?.name ?? '')}
          inset={data.map.inset?.label}
        />
      )}
      <Legend column={column} metric={metric} format={format} />
      <figcaption id="stage-caption" className="mt-3 max-w-prose text-xs text-ink-muted">
        {title}.{' '}
        {state.view === 'map'
          ? `Boundaries are simplified.${data.map.inset === undefined ? '' : ` ${data.map.inset.label} is also shown larger, in a separate box.`} `
          : ''}
        {state.view === 'hex' ? `${EQUAL_AREAS_NOTE} Hexagon layout by Open Innovations. ` : ''}
        {status === 'unavailable'
          ? 'This browser cannot show the interactive map, so it shows a still version. '
          : ''}
        Northern Ireland is not covered. Every value is in the table below.
      </figcaption>
    </figure>
  )
}

/**
 * A roving-tabindex list of every area in rank order, kept off screen. One
 * button is in the tab order; arrow keys move focus, which highlights the
 * area on the canvas and shows its tooltip; Enter or a click selects it.
 */
function AreaNavigatorImpl({
  order,
  focused,
  selected,
  describe,
  label,
  onFocusArea,
  onSelect,
}: {
  readonly order: readonly number[]
  readonly focused: number
  readonly selected: number
  readonly describe: (area: number) => string
  readonly label: string
  readonly onFocusArea: (area: number) => void
  readonly onSelect: (area: number) => void
}) {
  const list = useRef<HTMLOListElement>(null)
  // Handlers read the order through a ref, so moving focus re-renders two items, not 632.
  const latestOrder = useRef(order)
  useEffect(() => {
    latestOrder.current = order
  })
  const current = focused >= 0 ? focused : selected >= 0 ? selected : (order[0] ?? -1)
  const onKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, area: number) => {
      const ranked = latestOrder.current
      const steps: Readonly<Record<string, number>> = {
        ArrowRight: 1,
        ArrowDown: 1,
        ArrowLeft: -1,
        ArrowUp: -1,
        PageDown: 10,
        PageUp: -10,
        Home: -ranked.length,
        End: ranked.length,
      }
      const step = steps[event.key]
      if (step === undefined) return
      event.preventDefault()
      const position = ranked.indexOf(area)
      const next = ranked[Math.min(Math.max(position + step, 0), ranked.length - 1)]
      if (next === undefined) return
      onFocusArea(next)
      list.current?.querySelector<HTMLButtonElement>(`[data-area="${next}"]`)?.focus()
    },
    [onFocusArea],
  )
  const onLeave = useCallback(
    (event: FocusEvent<HTMLButtonElement>) => {
      if (!list.current?.contains(event.relatedTarget)) onFocusArea(-1)
    },
    [onFocusArea],
  )
  return (
    <ol ref={list} className="area-nav" aria-label={label}>
      {order.map((area, position) => (
        <NavItem
          // oxlint-disable-next-line react/no-array-index-key -- keyed by rank, so a re-rank rewrites labels in place instead of moving 632 items
          key={position}
          area={area}
          tabbable={area === current}
          describe={describe}
          onFocusArea={onFocusArea}
          onLeave={onLeave}
          onKey={onKey}
          onSelect={onSelect}
        />
      ))}
    </ol>
  )
}

/** One area in the navigator: its own component, so a deferred re-rank renders in slices. */
const NavItem = memo(function NavItem({
  area,
  tabbable,
  describe,
  onFocusArea,
  onLeave,
  onKey,
  onSelect,
}: {
  readonly area: number
  readonly tabbable: boolean
  readonly describe: (area: number) => string
  readonly onFocusArea: (area: number) => void
  readonly onLeave: (event: FocusEvent<HTMLButtonElement>) => void
  readonly onKey: (event: KeyboardEvent<HTMLButtonElement>, area: number) => void
  readonly onSelect: (area: number) => void
}) {
  return (
    <li>
      <button
        type="button"
        data-area={area}
        tabIndex={tabbable ? 0 : -1}
        onFocus={() => onFocusArea(area)}
        onBlur={onLeave}
        onKeyDown={(event) => onKey(event, area)}
        onClick={() => onSelect(area)}
      >
        {describe(area)}
      </button>
    </li>
  )
})

/** Memoised: hover and morphs re-render the stage, not these 632 buttons. */
const AreaNavigator = memo(AreaNavigatorImpl)

function StageTooltip({
  x,
  y,
  flip,
  name,
  value,
  label,
  rank,
  rankOf,
  chips,
}: {
  readonly x: number
  readonly y: number
  /** Open to the left of the anchor, near the right edge. */
  readonly flip: boolean
  readonly name: string
  readonly value: string
  readonly label: string
  readonly rank: number
  readonly rankOf: number
  readonly chips: readonly string[]
}) {
  return (
    <div
      className="stage-tooltip"
      style={{ left: x, top: y }}
      data-side={flip ? 'left' : 'right'}
      aria-hidden="true"
    >
      <p className="font-medium">{name}</p>
      <p className="font-mono tabular">
        {value} <span className="text-ink-muted">{label}</span>
      </p>
      <p className="text-ink-muted">
        {rank > 0 ? `${ordinal(rank)} of ${rankOf.toLocaleString('en-GB')}` : 'Not ranked'}
      </p>
      {chips.length > 0 ? <p className="text-ink-muted">{chips.join(' · ')}</p> : null}
    </div>
  )
}

function CanvasAxes({
  layout,
  data,
  column,
  format,
}: {
  readonly layout: EngineLayout
  readonly data: ExploreData
  readonly column: ColumnView
  readonly format: ValueFormat
}) {
  const { width, height } = layout.size
  if (layout.view === 'swarm' && layout.swarm !== undefined) {
    const ticks = swarmTicks(data.swarm.domain, data.swarm.scale, data.swarm.basisFactor, 5)
    return (
      <svg className="stage-axes" width={width} height={height} aria-hidden="true">
        <SwarmAxisMarks
          axis={layout.swarm}
          rule={layout.swarm.rule}
          ticks={ticks}
          formatTick={(value) => formatValue(value, format)}
        />
      </svg>
    )
  }
  if (layout.view === 'rank' && layout.rank !== undefined) {
    const { top, bottom, domain, baseline } = layout.rank
    const ticks = rankTicks(domain, 4)
    const gb = column.gb?.value
    const yOf = (value: number) =>
      top + ((domain[1] - value) / (domain[1] - domain[0])) * (bottom - top)
    return (
      <svg className="stage-axes" width={width} height={height} aria-hidden="true">
        {ticks.map((tick) => {
          const y = top + tick.at * (bottom - top)
          return (
            <g key={tick.value}>
              <line x1={16} x2={width - 16} y1={y} y2={y} stroke="var(--rule)" strokeWidth="0.75" />
              <text x={width - 16} y={y - 4} textAnchor="end" className="stage-tick">
                {formatValue(tick.value, format)}
              </text>
            </g>
          )
        })}
        <line x1={16} x2={width - 16} y1={baseline} y2={baseline} stroke="var(--rule-strong)" />
        {gb === null || gb === undefined || format.denominator === 'total' ? null : (
          <g>
            <line
              x1={16}
              x2={width - 16}
              y1={yOf(gb)}
              y2={yOf(gb)}
              stroke="var(--ink)"
              strokeDasharray="4 3"
            />
            <text x={20} y={yOf(gb) - 5} className="stage-tick stage-tick-strong">
              GB {formatValue(gb, format)}
            </text>
          </g>
        )}
        <text x={16} y={height - 20} className="stage-tick">
          Highest
        </text>
        <text x={width - 16} y={height - 20} textAnchor="end" className="stage-tick">
          Lowest
        </text>
      </svg>
    )
  }
  return null
}

/** What the skyline's heights mean, and what a 3D map exaggerates. */
function SkylineKey({
  max,
  half,
  label,
  tallest,
  inset,
}: {
  readonly max: string
  readonly half: string
  readonly label: string
  readonly tallest: readonly string[]
  readonly inset: string | undefined
}) {
  return (
    <div className="skyline-key mt-3" data-testid="skyline-key">
      <p className="kicker">Height from zero, {label}</p>
      <ol className="skyline-scale mt-2" aria-label="Height scale">
        <li>
          <span className="skyline-bar" style={{ height: '0.25rem' }} aria-hidden="true" />0
        </li>
        <li>
          <span className="skyline-bar" style={{ height: '1rem' }} aria-hidden="true" />
          {half}
        </li>
        <li>
          <span className="skyline-bar" style={{ height: '2rem' }} aria-hidden="true" />
          {max}
        </li>
      </ol>
      <p className="mt-2 text-sm text-ink-muted">
        Highest: {tallest.join(', ')}. Large rural areas stand out in 3D because they cover more
        ground. Only the height shows the value.
        {inset === undefined
          ? ''
          : ` ${inset}'s areas also rise in the separate box, on the same scale.`}
      </p>
    </div>
  )
}

function Legend({
  column,
  metric,
  format,
}: {
  readonly column: ColumnView
  readonly metric: MetricDefinition
  readonly format: ValueFormat
}) {
  const edges = binEdges(column.domain, column.scaleKind)
  const bins = edges.length + 1
  const label = (i: number) =>
    i === 0
      ? `Under ${formatValue(edges[0], format)}`
      : i === bins - 1
        ? `${formatValue(edges[bins - 2], format)} and over`
        : `${formatValue(edges[i - 1], format)} to ${formatValue(edges[i], format)}`
  const hasDerived = column.styles.some((style) => (style & 1) !== 0)
  const hasMissing = column.bins.includes(NO_VALUE)
  return (
    <div className="stage-legend mt-3" aria-label="Colour key">
      <p className="kicker">
        {column.scaleKind === 'diverging'
          ? 'Below the expected level, then above it'
          : `${capitalise(perLabel(metric, column.denominator))}, low to high`}
      </p>
      <ol className="legend-ramp mt-2">
        {Array.from({ length: bins }, (_, i) => (
          <li key={i}>
            <span
              className="legend-swatch"
              style={{ background: `var(${tokenOf(i, column.scaleKind)})` }}
            />
            <span className="legend-label tabular">{label(i)}</span>
          </li>
        ))}
      </ol>
      {hasDerived || hasMissing ? (
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
          {hasDerived ? (
            <li>
              <span className="halftone-chip" aria-hidden="true" /> Estimated value
            </li>
          ) : null}
          {hasMissing ? (
            <li>
              <span className="hatch-chip" aria-hidden="true" /> No value
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
