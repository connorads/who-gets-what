import { scaleLinear } from '@visx/scale'
import type { PerBasis } from '#/content/figures.ts'
import { BASES } from '#/content/labels.ts'

const WIDTH = 320
const HEIGHT = 30

/**
 * A difference from a reference level, drawn from a centre line. `spread` is
 * the size of difference that reaches the edge, taken from all areas of the
 * level, so a bar's length reads against the other areas, not against zero.
 * One ink for both directions: above and below are not good and bad.
 */
export function Difference({
  value,
  spread,
  label,
}: {
  value: PerBasis<number>
  spread: PerBasis<number>
  label: string
}) {
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="difference">
      <title>{label}</title>
      <line x1={0} x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} className="difference__track" />
      {BASES.map((basis) => {
        const edge = Math.max(1e-9, spread[basis])
        const x = scaleLinear({ domain: [-edge, edge], range: [6, WIDTH - 6], clamp: true })
        const start = x(0)
        const end = x(value[basis])
        return (
          <g key={basis} data-basis={basis}>
            <rect
              x={Math.min(start, end)}
              y={HEIGHT / 2 - 6}
              width={Math.max(1.5, Math.abs(end - start))}
              height={12}
              rx={2}
              className="difference__bar"
            />
            {Math.abs(value[basis]) > edge ? (
              <path
                d={
                  value[basis] > 0
                    ? `M${WIDTH} ${HEIGHT / 2}l-7 -6v12z`
                    : `M0 ${HEIGHT / 2}l7 -6v12z`
                }
                className="difference__overflow"
              />
            ) : null}
          </g>
        )
      })}
      <line x1={WIDTH / 2} x2={WIDTH / 2} y1={2} y2={HEIGHT - 2} className="difference__zero" />
    </svg>
  )
}
