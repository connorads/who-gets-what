/**
 * A unit chart: one square per £1 million, filled in family order. Each family
 * is at most three rectangles (a partial first row, whole rows, a partial last
 * row) under a mask of square cells, so a council with 3,000 squares is still
 * a few dozen elements.
 */
export interface WaffleItem {
  readonly key: string
  readonly label: string
  readonly color: string
  readonly value: number
  readonly derived: boolean
}

export interface WaffleRun {
  readonly key: string
  readonly start: number
  readonly end: number
}

/** Cells per item from cumulative rounding, so the squares add up to the rounded total. */
export function waffleRuns(items: readonly WaffleItem[], unit: number): readonly WaffleRun[] {
  let sum = 0
  return items.map((item) => {
    const start = Math.round(sum / unit)
    sum += Math.max(0, item.value)
    return { key: item.key, start, end: Math.round(sum / unit) }
  })
}

/** Columns for a roughly 3:1 block, never under 20. */
export function waffleColumns(cells: number): number {
  return Math.max(20, Math.ceil(Math.sqrt(cells * 3)))
}

function runRects(run: WaffleRun, columns: number) {
  const rects: { x: number; y: number; w: number; h: number }[] = []
  let at = run.start
  while (at < run.end) {
    const row = Math.floor(at / columns)
    const col = at % columns
    if (col === 0 && run.end - at >= columns) {
      const rows = Math.floor((run.end - at) / columns)
      rects.push({ x: 0, y: row, w: columns, h: rows })
      at += rows * columns
    } else {
      const n = Math.min(columns - col, run.end - at)
      rects.push({ x: col, y: row, w: n, h: 1 })
      at += n
    }
  }
  return rects
}

export function Waffle({
  id,
  items,
  unit,
  columns,
  label,
  pitch = 10,
}: {
  id: string
  items: readonly WaffleItem[]
  unit: number
  columns: number
  label: string
  pitch?: number
}) {
  const runs = waffleRuns(items, unit)
  const cells = runs.at(-1)?.end ?? 0
  const rows = Math.max(1, Math.ceil(cells / columns))
  const width = columns * pitch
  const height = rows * pitch
  const cell = pitch - 2
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="waffle"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <title>{label}</title>
      <defs>
        <pattern id={`${id}-cell`} width={pitch} height={pitch} patternUnits="userSpaceOnUse">
          <rect width={cell} height={cell} rx={1.5} fill="#fff" />
        </pattern>
        <pattern id={`${id}-dots`} width={4} height={4} patternUnits="userSpaceOnUse">
          <circle cx={2} cy={2} r={0.9} className="waffle__dot" />
        </pattern>
        <mask id={`${id}-mask`}>
          <rect width={width} height={height} fill={`url(#${id}-cell)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`}>
        {runs.map((run, i) => {
          const item = items[i]
          if (item === undefined) return null
          const rects = runRects(run, columns)
          return (
            <g key={run.key} data-family={run.key}>
              <title>{item.label}</title>
              {rects.map((rect) => (
                <rect
                  key={`${rect.x}-${rect.y}`}
                  x={rect.x * pitch}
                  y={rect.y * pitch}
                  width={rect.w * pitch}
                  height={rect.h * pitch}
                  fill={item.color}
                />
              ))}
              {item.derived
                ? rects.map((rect) => (
                    <rect
                      key={`d-${rect.x}-${rect.y}`}
                      x={rect.x * pitch}
                      y={rect.y * pitch}
                      width={rect.w * pitch}
                      height={rect.h * pitch}
                      fill={`url(#${id}-dots)`}
                    />
                  ))
                : null}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
