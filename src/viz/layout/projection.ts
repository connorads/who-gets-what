/**
 * Web Mercator maths shared by deck.gl's MapView and the layouts. Layouts are
 * drawn in CSS pixels inside the stage, then unprojected to longitude and
 * latitude, so every view lives in the map's one coordinate space and the
 * camera never moves between views.
 */

/** deck.gl's Web Mercator viewport uses 512-pixel world tiles. */
export const TILE_SIZE = 512

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Camera {
  readonly longitude: number
  readonly latitude: number
  readonly zoom: number
}

/** [[west, south], [east, north]] in degrees. */
export type Bounds = readonly [readonly [number, number], readonly [number, number]]

const DEG = Math.PI / 180

/** Longitude to world x, 0 to 1. */
export const worldX = (longitude: number): number => (longitude + 180) / 360

/** Latitude to world y, 0 at the top to 1 at the bottom. */
export function worldY(latitude: number): number {
  const sin = Math.sin(latitude * DEG)
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
}

const longitudeOf = (x: number): number => x * 360 - 180
const latitudeOf = (y: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI

/** The camera that fits `bounds` inside `size` with `padding` pixels on each side. */
export function fitCamera(bounds: Bounds, size: Size, padding: number): Camera {
  const [[west, south], [east, north]] = bounds
  const x0 = worldX(west)
  const x1 = worldX(east)
  const y0 = worldY(north)
  const y1 = worldY(south)
  const width = Math.max(size.width - 2 * padding, 1)
  const height = Math.max(size.height - 2 * padding, 1)
  const scale = Math.min(width / (x1 - x0), height / (y1 - y0))
  return {
    longitude: longitudeOf((x0 + x1) / 2),
    latitude: latitudeOf((y0 + y1) / 2),
    zoom: Math.log2(scale / TILE_SIZE),
  }
}

const scaleOf = (camera: Camera): number => TILE_SIZE * 2 ** camera.zoom

/** Longitude and latitude to CSS pixels from the top left of the canvas. */
export function project(
  camera: Camera,
  size: Size,
  longitude: number,
  latitude: number,
): [number, number] {
  const scale = scaleOf(camera)
  return [
    (worldX(longitude) - worldX(camera.longitude)) * scale + size.width / 2,
    (worldY(latitude) - worldY(camera.latitude)) * scale + size.height / 2,
  ]
}

/** CSS pixels to longitude and latitude; the inverse of `project`. */
export function unproject(camera: Camera, size: Size, x: number, y: number): [number, number] {
  const scale = scaleOf(camera)
  return [
    longitudeOf((x - size.width / 2) / scale + worldX(camera.longitude)),
    latitudeOf((y - size.height / 2) / scale + worldY(camera.latitude)),
  ]
}

/** Project a packed [lon, lat, lon, lat, ...] array to pixels. */
export function projectAll(camera: Camera, size: Size, lonLat: Float32Array): Float32Array {
  const out = new Float32Array(lonLat.length)
  const scale = scaleOf(camera)
  const cx = worldX(camera.longitude)
  const cy = worldY(camera.latitude)
  for (let i = 0; i < lonLat.length; i += 2) {
    out[i] = (worldX(lonLat[i] ?? 0) - cx) * scale + size.width / 2
    out[i + 1] = (worldY(lonLat[i + 1] ?? 0) - cy) * scale + size.height / 2
  }
  return out
}

/** Unproject a packed [x, y, x, y, ...] pixel array to longitude and latitude. */
export function unprojectAll(camera: Camera, size: Size, pixels: Float32Array): Float32Array {
  const out = new Float32Array(pixels.length)
  const scale = scaleOf(camera)
  const cx = worldX(camera.longitude)
  const cy = worldY(camera.latitude)
  for (let i = 0; i < pixels.length; i += 2) {
    out[i] = longitudeOf(((pixels[i] ?? 0) - size.width / 2) / scale + cx)
    out[i + 1] = latitudeOf(((pixels[i + 1] ?? 0) - size.height / 2) / scale + cy)
  }
  return out
}

/** The bounding box of a packed [lon, lat, ...] array, ignoring NaN. */
export function boundsOf(lonLat: Float32Array): Bounds {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (let i = 0; i < lonLat.length; i += 2) {
    const lon = lonLat[i] ?? Number.NaN
    const lat = lonLat[i + 1] ?? Number.NaN
    if (Number.isNaN(lon) || Number.isNaN(lat)) continue
    west = Math.min(west, lon)
    east = Math.max(east, lon)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return [
    [west, south],
    [east, north],
  ]
}

/** `size` less `padding` on every side. */
export function inset(size: Size, padding: number): Rect {
  return {
    x: padding,
    y: padding,
    width: Math.max(size.width - 2 * padding, 1),
    height: Math.max(size.height - 2 * padding, 1),
  }
}
