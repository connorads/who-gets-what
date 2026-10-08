/**
 * Geometry for the Open Innovations hex layouts (`odd-r`: odd rows shift half
 * a hex to the right; `r` grows northwards). Pointy-top hexes of unit radius.
 */
const SQRT3 = Math.sqrt(3)

export interface HexCell {
  readonly q: number
  readonly r: number
}

/** Centre of a hex in layout units, with y growing downwards for SVG. */
export function hexCentre(cell: HexCell): readonly [number, number] {
  return [SQRT3 * (cell.q + 0.5 * (cell.r & 1)), -1.5 * cell.r]
}

export interface HexFrame {
  readonly minX: number
  readonly minY: number
  readonly width: number
  readonly height: number
}

export function hexFrame(cells: readonly HexCell[]): HexFrame {
  const centres = cells.map(hexCentre)
  const xs = centres.map(([x]) => x)
  const ys = centres.map(([, y]) => y)
  const minX = Math.min(...xs) - SQRT3 / 2
  const minY = Math.min(...ys) - 1
  return {
    minX,
    minY,
    width: Math.max(...xs) + SQRT3 / 2 - minX,
    height: Math.max(...ys) + 1 - minY,
  }
}

const round = (value: number): string => String(Math.round(value))

/**
 * One path for many hexes, `size` units per layout unit, drawn at `inset` of
 * full size so neighbours keep a hairline gap. Relative moves repeat, so the
 * path compresses well.
 */
export function hexPath(
  cells: readonly HexCell[],
  frame: HexFrame,
  size: number,
  inset = 0.88,
): string {
  const radius = size * inset
  const w = round((SQRT3 / 2) * radius)
  const h = round(radius / 2)
  const v = round(radius)
  return cells
    .map((cell) => {
      const [cx, cy] = hexCentre(cell)
      const x = round((cx - frame.minX) * size)
      const y = round((cy - frame.minY) * size - radius)
      return `M${x} ${y}l${w} ${h}v${v}l-${w} ${h}-${w}-${h}v-${v}z`
    })
    .join('')
}
