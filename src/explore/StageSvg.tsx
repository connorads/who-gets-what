/**
 * The server-rendered stage: the same layouts as the canvas, drawn as SVG.
 * It is the first paint, the no-JavaScript view and the fallback when WebGL2
 * is missing. Every hex is one `<use>` of a shared shape, and every map area
 * one `<use>` of its path in the release's map sprite, so the page carries
 * no boundary coordinates and stays small.
 */
import { Fragment, memo, type ReactNode } from 'react'
import { tokenOf } from '#/viz/colour.ts'
import { rankTicks, swarmTicks, type Tick } from '#/viz/axes.ts'
import { STYLE_HALFTONE, STYLE_NO_VALUE } from '#/viz/engine/styles.ts'
import { hexLayout, MARK_FILL, rankBars, swarmLayout, type SwarmAxis } from '#/viz/layout/views.ts'
import { mapFrame, spriteTransform } from '#/viz/layout/map-frame.ts'
import type { Rect, Size } from '#/viz/layout/projection.ts'
import type { View } from '#/domain/url-state.ts'
import type { ColumnView } from './model.ts'
import type { ExploreArea, ExploreMap, ExploreSwarm } from './load.ts'

export const SVG_SIZE = { width: 800, height: 800 } as const
const PAD = 16
const AXIS = 34
const HEX_ID = 'stage-hex'

/** One decimal: a tenth of a pixel in the 800-unit viewBox. */
const tenth = (value: number): number => Math.round(value * 10) / 10

/** A pointy-top hexagon of circumradius `r` around the origin, as the hex layout draws it. */
function hexPath(r: number): string {
  const w = tenth((r * Math.sqrt(3)) / 2)
  const h = tenth(r / 2)
  return `M0,${-tenth(r)}L${w},${-h}L${w},${h}L0,${tenth(r)}L${-w},${h}L${-w},${-h}Z`
}

export interface StageSvgProps {
  readonly view: View
  readonly map: ExploreMap
  readonly areas: readonly ExploreArea[]
  readonly column: ColumnView
  readonly swarm: ExploreSwarm
  readonly swarmXY: Float32Array
  readonly selected: number
  readonly title: string
  readonly formatTick: (value: number) => string
  /**
   * The stage box in CSS pixels, once measured, so the SVG frames the map as
   * the canvas will. The server and no-JavaScript render use `SVG_SIZE`.
   */
  readonly size?: Size | undefined
}

/** The halftone and hatch screens, sized for marks drawn at `scale` stage pixels per unit. */
function Screens({ suffix, scale }: { readonly suffix: string; readonly scale: number }) {
  const unit = 1 / scale
  return (
    <>
      <pattern
        id={`stage-halftone${suffix}`}
        width="4"
        height="4"
        patternUnits="userSpaceOnUse"
        patternTransform={unit === 1 ? undefined : `scale(${unit})`}
      >
        <circle cx="2" cy="2" r="1.05" fill="var(--ink)" opacity="0.42" />
      </pattern>
      <pattern
        id={`stage-hatch${suffix}`}
        width="5"
        height="5"
        patternUnits="userSpaceOnUse"
        patternTransform={unit === 1 ? 'rotate(45)' : `scale(${unit}) rotate(45)`}
      >
        <rect width="1.2" height="5" fill="var(--ink-muted)" opacity="0.55" />
      </pattern>
    </>
  )
}

function Defs({ hex }: { readonly hex: string | undefined }) {
  return (
    <defs>
      {hex === undefined ? null : <path id={HEX_ID} d={hex} />}
      <Screens suffix="" scale={1} />
    </defs>
  )
}

const overlayFill = (style: number, suffix = ''): string | undefined =>
  (style & STYLE_NO_VALUE) !== 0
    ? `url(#stage-hatch${suffix})`
    : (style & STYLE_HALFTONE) !== 0
      ? `url(#stage-halftone${suffix})`
      : undefined

const frameRect = (rect: Rect) => ({
  x: tenth(rect.x),
  y: tenth(rect.y),
  width: tenth(rect.width),
  height: tenth(rect.height),
})

/**
 * The map: every area as a `<use>` of its sprite path, then the inset
 * region again, larger, with frames round the inset and the part of the map
 * it redraws.
 */
function SvgMap({
  size,
  map,
  areas,
  fill,
  dim,
  styles,
  selected,
}: {
  readonly size: Size
  readonly map: ExploreMap
  readonly areas: readonly ExploreArea[]
  readonly fill: (area: number) => string
  readonly dim: (area: number) => number | undefined
  readonly styles: Uint8Array
  readonly selected: number
}) {
  const { camera, inset } = mapFrame(size, map.bounds, map.inset?.bounds, PAD)
  const [k, x, y] = spriteTransform(camera, size, map.bounds)
  const groups = [{ suffix: '-map', k, x, y, picked: areas.map((_, i) => i) }]
  if (inset !== undefined && map.inset !== undefined) {
    groups.push({
      suffix: '-inset',
      k: k * inset.scale,
      x: inset.rect.x + (x - inset.source.x) * inset.scale,
      y: inset.rect.y + (y - inset.source.y) * inset.scale,
      picked: [...map.inset.areas],
    })
  }
  const href = (area: number) => `${map.sprite}#a${area}`
  return (
    <>
      <defs>
        {groups.map((group) => (
          <Screens key={group.suffix} suffix={group.suffix} scale={group.k} />
        ))}
      </defs>
      {groups.map(({ suffix, k: scale, x: dx, y: dy, picked }) => (
        <g
          key={suffix}
          transform={`matrix(${scale} 0 0 ${scale} ${tenth(dx)} ${tenth(dy)})`}
          stroke="var(--paper)"
          strokeWidth={0.6 / scale}
        >
          {picked.map((area) => {
            const extra = overlayFill(styles[area] ?? 0, suffix)
            return (
              <Fragment key={area}>
                <use href={href(area)} fill={fill(area)} opacity={dim(area)} />
                {extra === undefined ? null : (
                  <use href={href(area)} fill={extra} stroke="none" opacity={dim(area)} />
                )}
              </Fragment>
            )
          })}
          {picked.includes(selected) ? (
            <use href={href(selected)} fill="none" stroke="var(--ink)" strokeWidth={2 / scale} />
          ) : null}
        </g>
      ))}
      {inset === undefined || map.inset === undefined ? null : (
        <g fill="none" stroke="var(--ink-muted)" strokeWidth="1" aria-hidden="true">
          <rect {...frameRect(inset.rect)} />
          <rect {...frameRect(inset.source)} />
          {/* On the frame's top edge, backed by the stage colour, so it covers no area. */}
          <text
            x={tenth(inset.rect.x + 10)}
            y={tenth(inset.rect.y + 4)}
            className="stage-tick"
            fill="var(--ink-muted)"
            stroke="var(--surface)"
            strokeWidth="4"
            paintOrder="stroke"
          >
            {map.inset.label}
          </text>
        </g>
      )}
    </>
  )
}

/** The swarm's centre line, and its value ticks along a rule beside the stage. */
export function SwarmAxisMarks({
  axis,
  rule,
  ticks,
  formatTick,
}: {
  readonly axis: SwarmAxis
  readonly rule: number
  readonly ticks: readonly Tick[]
  readonly formatTick: (value: number) => string
}) {
  const { vertical, start, end, cross } = axis
  const at = (t: number) => start + t * (end - start)
  return (
    <g className="stage-axis" aria-hidden="true">
      {vertical ? (
        <>
          <line
            x1={cross}
            x2={cross}
            y1={start}
            y2={end}
            stroke="var(--rule-strong)"
            strokeWidth="0.75"
            strokeDasharray="2 3"
          />
          <line x1={rule} x2={rule} y1={start} y2={end} stroke="var(--rule-strong)" />
          {ticks.map((tick) => (
            <g key={tick.value} transform={`translate(${rule}, ${at(tick.at)})`}>
              <line x2="-5" stroke="var(--rule-strong)" />
              <text x="-8" y="4" textAnchor="end" className="stage-tick">
                {formatTick(tick.value)}
              </text>
            </g>
          ))}
        </>
      ) : (
        <>
          <line
            x1={start}
            x2={end}
            y1={cross}
            y2={cross}
            stroke="var(--rule-strong)"
            strokeWidth="0.75"
            strokeDasharray="2 3"
          />
          <line x1={start} x2={end} y1={rule} y2={rule} stroke="var(--rule-strong)" />
          {ticks.map((tick) => (
            <g key={tick.value} transform={`translate(${at(tick.at)}, ${rule})`}>
              <line y2="5" stroke="var(--rule-strong)" />
              <text y="18" textAnchor="middle" className="stage-tick">
                {formatTick(tick.value)}
              </text>
            </g>
          ))}
        </>
      )}
    </g>
  )
}

function StageSvgImpl({
  view,
  map,
  areas,
  column,
  swarm,
  swarmXY,
  selected,
  title,
  formatTick,
  size = SVG_SIZE,
}: StageSvgProps) {
  const fill = (area: number) => `var(${tokenOf(column.bins[area] ?? 255, column.scaleKind)})`
  const dim = (area: number) => (selected >= 0 && area !== selected ? 0.38 : undefined)
  let marks: ReactNode
  let axis: ReactNode = null
  let hex: string | undefined

  if (view === 'swarm') {
    const stage = {
      x: PAD + 8,
      y: PAD,
      width: size.width - 2 * (PAD + 8),
      height: size.height - 2 * PAD - AXIS,
    }
    const layout = swarmLayout(swarmXY, swarm.radius, stage, 4)
    const r = tenth(layout.radius)
    marks = areas.map((area, i) => {
      const cx = tenth(layout.centres[i * 2] ?? 0)
      const cy = tenth(layout.centres[i * 2 + 1] ?? 0)
      const extra = overlayFill(column.styles[i] ?? 0)
      return (
        <Fragment key={area.code}>
          <circle cx={cx} cy={cy} r={r} fill={fill(i)} opacity={dim(i)} />
          {extra === undefined ? null : (
            <circle cx={cx} cy={cy} r={r} fill={extra} opacity={dim(i)} />
          )}
          {i === selected ? (
            <circle cx={cx} cy={cy} r={r + 1.5} fill="none" stroke="var(--ink)" strokeWidth="2" />
          ) : null}
        </Fragment>
      )
    })
    const ticks = swarmTicks(swarm.domain, swarm.scale, swarm.basisFactor, 5)
    axis = (
      <SwarmAxisMarks
        axis={layout.axis}
        rule={size.height - PAD - AXIS + 10}
        ticks={ticks}
        formatTick={formatTick}
      />
    )
  } else if (view === 'rank') {
    const stage = {
      x: PAD,
      y: PAD + 12,
      width: size.width - 2 * PAD,
      height: size.height - 2 * PAD - 12 - AXIS,
    }
    const { bars, baseline, domain } = rankBars(column.values, stage)
    marks = bars.map((bar) => {
      const extra = overlayFill(column.styles[bar.area] ?? 0)
      const rect = {
        x: tenth(bar.x0),
        y: tenth(bar.y0),
        width: tenth(bar.x1 - bar.x0),
        height: tenth(bar.y1 - bar.y0),
      }
      return (
        <Fragment key={areas[bar.area]?.code ?? bar.area}>
          <rect {...rect} fill={fill(bar.area)} opacity={dim(bar.area)} />
          {extra === undefined ? null : <rect {...rect} fill={extra} opacity={dim(bar.area)} />}
          {bar.area === selected ? (
            <rect {...rect} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
          ) : null}
        </Fragment>
      )
    })
    const ticks = rankTicks(domain, 4)
    axis = (
      <g className="stage-axis" aria-hidden="true">
        {ticks.map((tick) => {
          const y = stage.y + tick.at * stage.height
          return (
            <g key={tick.value}>
              <line
                x1={PAD}
                x2={size.width - PAD}
                y1={y}
                y2={y}
                stroke="var(--rule)"
                strokeWidth="0.75"
              />
              <text x={size.width - PAD} y={y - 4} textAnchor="end" className="stage-tick">
                {formatTick(tick.value)}
              </text>
            </g>
          )
        })}
        <line
          x1={PAD}
          x2={size.width - PAD}
          y1={baseline}
          y2={baseline}
          stroke="var(--rule-strong)"
        />
        <text x={PAD} y={size.height - PAD - 8} className="stage-tick">
          Highest
        </text>
        <text
          x={size.width - PAD}
          y={size.height - PAD - 8}
          textAnchor="end"
          className="stage-tick"
        >
          Lowest
        </text>
      </g>
    )
  } else if (view === 'map') {
    marks = (
      <SvgMap
        size={size}
        map={map}
        areas={areas}
        fill={fill}
        dim={dim}
        styles={column.styles}
        selected={selected}
      />
    )
  } else {
    const layout = hexLayout(
      areas,
      { x: PAD, y: PAD, width: size.width - 2 * PAD, height: size.height - 2 * PAD },
      6,
    )
    hex = hexPath(layout.cellRadius * MARK_FILL)
    marks = areas.map((area, i) => {
      const at = {
        href: `#${HEX_ID}`,
        x: tenth(layout.centres[i * 2] ?? 0),
        y: tenth(layout.centres[i * 2 + 1] ?? 0),
      }
      const extra = overlayFill(column.styles[i] ?? 0)
      return (
        <Fragment key={area.code}>
          <use {...at} fill={fill(i)} opacity={dim(i)} />
          {extra === undefined ? null : <use {...at} fill={extra} opacity={dim(i)} />}
          {i === selected ? <use {...at} fill="none" stroke="var(--ink)" strokeWidth="2" /> : null}
        </Fragment>
      )
    })
  }

  return (
    <svg
      viewBox={`0 0 ${size.width} ${size.height}`}
      className="stage-svg absolute inset-0 size-full"
      aria-labelledby="stage-svg-title"
    >
      <title id="stage-svg-title">{title}</title>
      <Defs hex={hex} />
      <g>{marks}</g>
      {axis}
    </svg>
  )
}

export const StageSvg = memo(StageSvgImpl)
