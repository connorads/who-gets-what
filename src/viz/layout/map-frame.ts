/**
 * Where the map sits on the stage, and where its inset goes. The inset
 * redraws one dense region (London) larger, so seats a few pixels wide on
 * the map can be seen, hovered and selected. It sits beside Great Britain
 * when the stage is wide enough, otherwise over open sea, where no area is
 * drawn. Pure, so the server's SVG and the canvas place everything alike.
 */
import {
  TILE_SIZE,
  worldX,
  worldY,
  type Bounds,
  type Camera,
  type Rect,
  type Size,
} from './projection.ts'

/** The region drawn larger in the inset: London (ONS region E12000007). */
export const INSET_REGION = 'E12000007'
export const INSET_LABEL = 'London'

export interface InsetFrame {
  /** The inset panel on the stage, in CSS pixels. */
  readonly rect: Rect
  /** The part of the main map it redraws, in CSS pixels at the main camera. */
  readonly source: Rect
  /** Inset pixels per main-map pixel. */
  readonly scale: number
}

export interface MapFrame {
  readonly camera: Camera
  readonly inset: InsetFrame | undefined
}

/**
 * Open sea round Great Britain where an inset can sit: west of Wales and
 * south of Scotland, where Ireland and the Isle of Man are not drawn, and
 * the North Sea east of Scotland. Each runs out past any stage's edge, so
 * the inset can use all the sea a narrow stage shows. A test checks that no
 * area of either level reaches into them.
 */
export const SEA_SLOTS: readonly Bounds[] = [
  [
    [-30, 50.35],
    [-5.45, 54.45],
  ],
  [
    [-1.45, 55.85],
    [20, 59.25],
  ],
]

/** Room kept between Great Britain and a side inset, and round an inset in the sea. */
const GAP = 20
/** The source rectangle's margin round the region, as a share of its size. */
const SOURCE_MARGIN = 0.04
/** An inset that magnifies less than this is not worth the room. */
const MIN_SCALE = 1.8
/** A side inset is no wider than this share of the stage. */
const MAX_SIDE_SHARE = 0.36

const scaleOf = (camera: Camera): number => TILE_SIZE * 2 ** camera.zoom

/** The world rectangle (0 to 1, y down) a lon/lat box covers. */
function worldBox(bounds: Bounds): Rect {
  const [[west, south], [east, north]] = bounds
  const x = worldX(west)
  const y = worldY(north)
  return { x, y, width: worldX(east) - x, height: worldY(south) - y }
}

/** The camera that draws `bounds` as large as fits inside `rect`, centred in it. */
export function fitCameraIn(bounds: Bounds, size: Size, rect: Rect): Camera {
  const box = worldBox(bounds)
  const scale = Math.min(Math.max(rect.width, 1) / box.width, Math.max(rect.height, 1) / box.height)
  // The box's centre lands on the rectangle's centre.
  const cx = box.x + box.width / 2 - (rect.x + rect.width / 2 - size.width / 2) / scale
  const cy = box.y + box.height / 2 - (rect.y + rect.height / 2 - size.height / 2) / scale
  return {
    longitude: cx * 360 - 180,
    latitude: (Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180) / Math.PI,
    zoom: Math.log2(scale / TILE_SIZE),
  }
}

/** A lon/lat box as a pixel rectangle at `camera`. */
export function boxOnStage(camera: Camera, size: Size, bounds: Bounds): Rect {
  const box = worldBox(bounds)
  const scale = scaleOf(camera)
  return {
    x: (box.x - worldX(camera.longitude)) * scale + size.width / 2,
    y: (box.y - worldY(camera.latitude)) * scale + size.height / 2,
    width: box.width * scale,
    height: box.height * scale,
  }
}

/** The largest rectangle of `aspect` (width over height) centred inside `space`, less `margin`. */
function fitAspect(space: Rect, aspect: number, margin: number): Rect {
  const width = Math.max(space.width - 2 * margin, 0)
  const height = Math.max(space.height - 2 * margin, 0)
  const w = Math.min(width, height * aspect)
  const h = w / aspect
  return {
    x: space.x + (space.width - w) / 2,
    y: space.y + (space.height - h) / 2,
    width: w,
    height: h,
  }
}

function sourceRect(camera: Camera, size: Size, region: Bounds): Rect {
  const box = boxOnStage(camera, size, region)
  const mx = box.width * SOURCE_MARGIN
  const my = box.height * SOURCE_MARGIN
  return { x: box.x - mx, y: box.y - my, width: box.width + 2 * mx, height: box.height + 2 * my }
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high))

/** The part of `a` inside `b`; zero-sized when they do not meet. */
function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(Math.min(a.x + a.width, b.x + b.width) - x, 0),
    height: Math.max(Math.min(a.y + a.height, b.y + b.height) - y, 0),
  }
}

/**
 * The map's camera and inset for a stage. `bounds` is the level's extent and
 * `region` the inset region's; without a region, or with no room for a
 * useful inset, the map fills the stage alone.
 */
export function mapFrame(
  size: Size,
  bounds: Bounds,
  region: Bounds | undefined,
  padding: number,
): MapFrame {
  const stage: Rect = {
    x: padding,
    y: padding,
    width: Math.max(size.width - 2 * padding, 1),
    height: Math.max(size.height - 2 * padding, 1),
  }
  const full = fitCameraIn(bounds, size, stage)
  if (region === undefined) return { camera: full, inset: undefined }

  const beside = besideLand(size, stage, bounds, region)
  const first = mostMagnified([
    ...(beside === undefined ? [] : [beside]),
    ...overSea(size, stage, full, region),
  ])
  if (insetWidth(first) >= stage.width * MIN_SHARE) return first
  // A narrow stage shrinks Great Britain a little, until the sea beside it holds a wide enough inset.
  for (const shrink of SHRINKS) {
    const frame = mostMagnified(
      anchored(stage, shrink).flatMap((land) =>
        overSea(size, stage, fitCameraIn(bounds, size, land), region),
      ),
    )
    if (insetWidth(frame) >= stage.width * MIN_SHARE) return frame
  }
  return (first.inset?.scale ?? 0) >= MIN_SCALE ? first : { camera: full, inset: undefined }
}

/** Shares of the stage a narrow stage may shrink Great Britain to, tried in order. */
const SHRINKS = [0.95, 0.9, 0.85, 0.8] as const
/** An inset this share of the stage's width is wide enough to stop shrinking the map. */
const MIN_SHARE = 1 / 3

const insetWidth = (frame: MapFrame): number => frame.inset?.rect.width ?? 0

const mostMagnified = (frames: readonly MapFrame[]): MapFrame =>
  frames.reduce((a, b) => ((b.inset?.scale ?? 0) > (a.inset?.scale ?? 0) ? b : a))

/** A share of the stage, against its left edge and against its right, centred top to bottom. */
function anchored(stage: Rect, shrink: number): readonly Rect[] {
  const width = stage.width * shrink
  const height = stage.height * shrink
  const y = stage.y + (stage.height - height) / 2
  return [
    { x: stage.x, y, width, height },
    { x: stage.x + stage.width - width, y, width, height },
  ]
}

/** The inset beside Great Britain, when the stage is wider than the map needs. */
function besideLand(size: Size, stage: Rect, bounds: Bounds, region: Bounds): MapFrame | undefined {
  const regionBox = worldBox(region)
  const aspect = regionBox.width / regionBox.height
  const land = boxOnStage(fitCameraIn(bounds, size, stage), size, bounds)
  const spare = stage.width - land.width - GAP
  const sideWidth = Math.min(spare, stage.width * MAX_SIDE_SHARE, stage.height * 0.6 * aspect)
  if (sideWidth <= 0) return undefined
  const group = land.width + GAP + sideWidth
  const left = stage.x + (stage.width - group) / 2
  const camera = fitCameraIn(bounds, size, { ...stage, x: left, width: land.width })
  const source = sourceRect(camera, size, region)
  const height = sideWidth / aspect
  const rect: Rect = {
    x: left + land.width + GAP,
    y: clamp(source.y + source.height / 2 - height / 2, stage.y, stage.y + stage.height - height),
    width: sideWidth,
    height,
  }
  return { camera, inset: { rect, source, scale: rect.width / source.width } }
}

/** The inset over each sea slot, as much of it as the stage shows, with the map at `camera`. */
function overSea(size: Size, stage: Rect, camera: Camera, region: Bounds): MapFrame[] {
  const source = sourceRect(camera, size, region)
  return SEA_SLOTS.map((slot) => {
    const sea = intersect(boxOnStage(camera, size, slot), stage)
    const rect = fitAspect(sea, source.width / source.height, GAP / 2)
    return { camera, inset: { rect, source, scale: rect.width / source.width } }
  })
}

/**
 * The map sprite's units (`layout/{level}/map.svg`): Web Mercator world
 * pixels at zoom 7 from the north-west corner of the level's bounds.
 */
export const SPRITE_SCALE = TILE_SIZE * 2 ** 7

/** Sprite units to stage pixels: [scale, x offset, y offset]. */
export function spriteTransform(
  camera: Camera,
  size: Size,
  bounds: Bounds,
): readonly [number, number, number] {
  const [[west], [, north]] = bounds
  const scale = scaleOf(camera)
  return [
    scale / SPRITE_SCALE,
    (worldX(west) - worldX(camera.longitude)) * scale + size.width / 2,
    (worldY(north) - worldY(camera.latitude)) * scale + size.height / 2,
  ]
}

/** A main-map pixel moved into the inset. */
export function intoInset(inset: InsetFrame, x: number, y: number): [number, number] {
  return [
    inset.rect.x + (x - inset.source.x) * inset.scale,
    inset.rect.y + (y - inset.source.y) * inset.scale,
  ]
}

/** Packed main-map pixels moved into the inset, into a new array. */
export function allIntoInset(inset: InsetFrame, pixels: Float32Array): Float32Array {
  const out = new Float32Array(pixels.length)
  for (let i = 0; i < pixels.length; i += 2) {
    out[i] = inset.rect.x + ((pixels[i] ?? 0) - inset.source.x) * inset.scale
    out[i + 1] = inset.rect.y + ((pixels[i + 1] ?? 0) - inset.source.y) * inset.scale
  }
  return out
}

/** Whether pixel (x, y) is inside a rectangle. */
export const inRect = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
