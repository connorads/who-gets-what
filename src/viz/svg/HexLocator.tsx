import { hexFrame, hexPath, type HexCell } from './hex.ts'

interface LocatorCell extends HexCell {
  readonly code: string
}

/**
 * Every area of the level as an equal hexagon, with the selected area in
 * brass and a second, when compared, in pewter. It shows where an area sits, not a value, so it carries no data colour.
 */
export function HexLocator({
  cells,
  selected,
  label,
  size = 10,
  className,
}: {
  cells: readonly LocatorCell[]
  selected: readonly string[]
  label: string
  size?: number
  className?: string
}) {
  const frame = hexFrame(cells)
  const chosen = new Set(selected)
  const others = cells.filter((cell) => !chosen.has(cell.code))
  const [first, second] = selected
  const picked = cells.filter((cell) => cell.code === first)
  const paired = cells.filter((cell) => cell.code === second)
  const width = Math.ceil(frame.width * size)
  const height = Math.ceil(frame.height * size)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className ?? 'hex-locator'}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{label}</title>
      <path d={hexPath(others, frame, size)} className="hex-locator__others" />
      <path d={hexPath(picked, frame, size, 1.15)} className="hex-locator__picked" />
      {paired.length === 0 ? null : (
        <path d={hexPath(paired, frame, size, 1.15)} className="hex-locator__paired" />
      )}
    </svg>
  )
}
