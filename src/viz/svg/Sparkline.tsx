import { scaleLinear } from '@visx/scale'
import { AreaClosed, LinePath } from '@visx/shape'
import { ValueFlag } from '#/domain/measure.ts'
import { BASES } from '#/content/labels.ts'
import type { PerBasis } from '#/content/figures.ts'
import { isDerived } from '#/content/sources.ts'

export interface SparkPoint {
  readonly label: string
  readonly value: PerBasis<number> | null
  readonly text: PerBasis<string>
  readonly flags: number
}

const WIDTH = 240
const HEIGHT = 64
const PAD = { top: 6, right: 6, bottom: 4, left: 6 }

/**
 * A small multiple on a zero baseline, so the filled area is honest. Every
 * basis is drawn and CSS shows the reader's. Derived periods sit on a dot
 * screen; a dashed rule marks a series break before its period.
 */
export function Sparkline({
  points,
  varies,
  label,
}: {
  points: readonly SparkPoint[]
  varies: boolean
  label: string
}) {
  const max = Math.max(
    1e-9,
    ...points.flatMap((point) =>
      point.value === null ? [] : BASES.map((basis) => point.value?.[basis] ?? 0),
    ),
  )
  const x = scaleLinear({
    domain: [0, Math.max(1, points.length - 1)],
    range: [PAD.left, WIDTH - PAD.right],
  })
  const y = scaleLinear({ domain: [0, max], range: [HEIGHT - PAD.bottom, PAD.top], nice: false })
  const step = points.length > 1 ? x(1) - x(0) : WIDTH
  const bases = varies ? BASES : (['real-gdp'] as const)
  const indexed = points.map((point, i) => ({ ...point, i }))

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="spark">
      <title>{label}</title>
      {indexed
        .filter((point) => isDerived(point.flags))
        .map((point) => (
          <rect
            key={`d-${point.label}`}
            x={x(point.i) - step / 2}
            y={PAD.top}
            width={step}
            height={HEIGHT - PAD.top - PAD.bottom}
            className="spark__derived"
          />
        ))}
      <line
        x1={PAD.left}
        x2={WIDTH - PAD.right}
        y1={HEIGHT - PAD.bottom}
        y2={HEIGHT - PAD.bottom}
        className="spark__base"
      />
      {bases.map((basis) => {
        const at = (point: (typeof indexed)[number]) => y(point.value?.[basis] ?? 0)
        const last = indexed.findLast((point) => point.value !== null)
        return (
          <g key={basis} data-basis={varies ? basis : undefined}>
            <AreaClosed
              data={indexed}
              x={(point) => x(point.i)}
              y={at}
              yScale={y}
              defined={(point) => point.value !== null}
              className="spark__area"
            />
            <LinePath
              data={indexed}
              x={(point) => x(point.i)}
              y={at}
              defined={(point) => point.value !== null}
              className="spark__line"
            />
            {indexed
              .filter((point) => point.i > 0 && (point.flags & ValueFlag.seriesBreak) !== 0)
              .map((point) => (
                <line
                  key={`b-${point.label}`}
                  x1={x(point.i) - step / 2}
                  x2={x(point.i) - step / 2}
                  y1={PAD.top}
                  y2={HEIGHT - PAD.bottom}
                  className="spark__break"
                />
              ))}
            {last === undefined ? null : (
              <circle cx={x(last.i)} cy={at(last)} r={3.5} className="spark__end" />
            )}
          </g>
        )
      })}
    </svg>
  )
}
