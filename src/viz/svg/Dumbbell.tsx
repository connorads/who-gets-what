import { scaleLinear } from '@visx/scale'
import type { PerBasis } from '#/content/figures.ts'
import { BASES } from '#/content/labels.ts'

const WIDTH = 320
const HEIGHT = 28

export interface DumbbellEnd {
  readonly value: PerBasis<number> | null
  readonly text: PerBasis<string>
  readonly name: string
  /** `solid` circle, `ring` circle or `diamond`: shape carries identity as well as colour. */
  readonly mark: 'solid' | 'ring' | 'diamond'
  readonly derived?: boolean
}

function Mark({ end, cx, cy }: { end: DumbbellEnd; cx: number; cy: number }) {
  const className = `dumbbell__${end.mark}${end.derived === true ? ' dumbbell__derived' : ''}`
  if (end.mark === 'diamond') {
    return (
      <rect
        x={cx - 5}
        y={cy - 5}
        width={10}
        height={10}
        transform={`rotate(45 ${cx} ${cy})`}
        className={className}
      />
    )
  }
  return <circle cx={cx} cy={cy} r={6} className={className} />
}

/**
 * Two values of one measure on a zero-based track. Each row has its own scale,
 * so rows compare the two ends, never rows with each other.
 */
export function Dumbbell({
  a,
  b,
  varies,
  label,
}: {
  a: DumbbellEnd
  b: DumbbellEnd
  varies: boolean
  label: string
}) {
  const all = [a, b].flatMap((end) =>
    end.value === null ? [] : BASES.map((basis) => end.value?.[basis] ?? 0),
  )
  const max = Math.max(1e-9, ...all.map(Math.abs))
  const x = scaleLinear({ domain: [0, max], range: [8, WIDTH - 8] })
  const bases = varies ? BASES : (['real-gdp'] as const)
  const cy = HEIGHT / 2
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="dumbbell">
      <title>{label}</title>
      <line x1={8} x2={WIDTH - 8} y1={cy} y2={cy} className="dumbbell__track" />
      {bases.map((basis) => {
        const xa = a.value === null ? null : x(Math.max(0, a.value[basis]))
        const xb = b.value === null ? null : x(Math.max(0, b.value[basis]))
        return (
          <g key={basis} data-basis={varies ? basis : undefined}>
            {xa !== null && xb !== null ? (
              <line x1={xa} x2={xb} y1={cy} y2={cy} className="dumbbell__span" />
            ) : null}
            {xb === null ? null : (
              <g>
                <title>{`${b.name}: ${b.text[basis]}`}</title>
                <Mark end={b} cx={xb} cy={cy} />
              </g>
            )}
            {xa === null ? null : (
              <g>
                <title>{`${a.name}: ${a.text[basis]}`}</title>
                <Mark end={a} cx={xa} cy={cy} />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
