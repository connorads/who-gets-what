/**
 * The explorer canvas: one deck.gl `Deck` with a `MapView`, drawing every
 * mark on one WebGL2 canvas with no basemap (ADR 0008). The camera stays
 * fixed on Great Britain; views are layouts of the same marks in Web
 * Mercator longitude and latitude, and GSAP is the only clock (ADR 0003).
 *
 * The map at rest draws every area's real shapes, islands and holes
 * included, with London again, larger, in an inset (ADR 0009). The morphing
 * rings carry the marks between views; the shapes fade in over them once
 * they land on the map, and the skyline extrudes the same shapes.
 */
import { PathLayer, SolidPolygonLayer } from '@deck.gl/layers'
import { Deck, MapView, type Layer } from '@deck.gl/core'
import { gsap } from 'gsap'
import type { View } from '#/domain/url-state.ts'
import type { ScaleKind } from '../colour.ts'
import {
  allIntoInset,
  inRect,
  mapFrame,
  type InsetFrame,
  type MapFrame,
} from '../layout/map-frame.ts'
import {
  inset as insetOf,
  projectAll,
  unprojectAll,
  type Bounds,
  type Rect,
  type Size,
} from '../layout/projection.ts'
import { hitTest, mixInto } from '../layout/rings.ts'
import {
  hexLayout,
  mapLayout,
  rankLayout,
  swarmLayout,
  type HexCell,
  type SwarmAxis,
} from '../layout/views.ts'
import { CAMERA_EASE, EASE, MOTION, stagePlan, type ChangeKind } from '../motion.ts'
import { mixBytesInto, perVertexColours, perVertexMeta, triangulate } from './geometry.ts'
import { MorphLayer } from './morph-layer.ts'
import { areaColours, readPalette, type Palette, type Rgb } from './palette.ts'
import {
  areaAnchor,
  areaBoxes,
  closedRings,
  extrusion,
  hitShapes,
  shapeColours,
  shapeMeta,
  subsetShapes,
  type BinaryPaths,
  type Extrusion,
  type MapShapes,
} from './shapes.ts'

export interface EngineScene {
  readonly view: View
  readonly hex: readonly HexCell[]
  /** Values for the rank view, in area order; NaN for none. */
  readonly rankValues: Float32Array
  /** Swarm layout for the active period, packed [x, y]; NaN for none. */
  readonly swarmXY: Float32Array
  readonly swarmRadius: number
  readonly bins: Uint8Array
  readonly scaleKind: ScaleKind
  /** Per-area style bits (halftone, no value). */
  readonly styles: Uint8Array
  /** Area index, or -1. */
  readonly selected: number
  readonly focused: number
}

/** Extrusion heights (0 to 1) per area; the shapes keep the map's colours. */
export interface SkylineInput {
  readonly heights: Float32Array
}

/** Where the marks sit once a change settles, for the HTML overlays. */
export interface EngineLayout {
  readonly view: View
  readonly size: Size
  /** Packed [x, y] pixel anchor per area; in the map, inset areas anchor in the inset. */
  readonly centres: Float32Array
  /** The swarm's value axis, and where its ticks sit across it. */
  readonly swarm?: SwarmAxis & { readonly rule: number }
  readonly rank?: {
    readonly baseline: number
    readonly top: number
    readonly bottom: number
    readonly domain: readonly [number, number]
  }
  /** The map's inset, when it has one. */
  readonly inset?: InsetFrame
}

export interface EngineInset {
  /** The inset region's extent. */
  readonly bounds: Bounds
  /** Area indices drawn in the inset. */
  readonly areas: readonly number[]
}

export interface EngineOptions {
  /** `rings.bin` boundaries, packed [lon, lat]. */
  readonly boundaries: Float32Array
  readonly areaCount: number
  readonly points: number
  /** Every area's real shapes, from `shapes.bin`. */
  readonly shapes: MapShapes
  /** The level's extent: the camera fits it. */
  readonly bounds: Bounds
  readonly inset: EngineInset | undefined
  readonly onHover: (area: number, x: number, y: number) => void
  readonly onSelect: (area: number) => void
  readonly onLayout: (layout: EngineLayout) => void
  readonly onReady: () => void
}

const rgba = (rgb: Rgb, alpha: number): [number, number, number, number] => [
  rgb[0],
  rgb[1],
  rgb[2],
  alpha,
]

/** One area's rings in `lonLat` (laid out as `shapes`), each a closed flat [lon, lat, ...] path. */
function areaPaths(shapes: MapShapes, lonLat: Float32Array, k: number): Float32Array[] {
  const out: Float32Array[] = []
  const r0 = shapes.polygons[shapes.areas[k] ?? 0] ?? 0
  const r1 = shapes.polygons[shapes.areas[k + 1] ?? 0] ?? 0
  for (let r = r0; r < r1; r++) {
    const from = shapes.rings[r] ?? 0
    const to = shapes.rings[r + 1] ?? 0
    const path = new Float32Array((to - from + 1) * 2)
    path.set(lonLat.subarray(from * 2, to * 2))
    path[(to - from) * 2] = lonLat[from * 2] ?? 0
    path[(to - from) * 2 + 1] = lonLat[from * 2 + 1] ?? 0
    out.push(path)
  }
  return out
}

/** Whether the canvas's WebGL context renders on the CPU. */
function softwareRenderer(canvas: HTMLCanvasElement | null): boolean {
  const gl = canvas?.getContext('webgl2')
  const info = gl?.getExtension('WEBGL_debug_renderer_info')
  const renderer: unknown =
    gl === null || gl === undefined || info === null || info === undefined
      ? ''
      : gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
  return typeof renderer === 'string' && /swiftshader|llvmpipe|software/i.test(renderer)
}

/** Run `task` when the browser is next idle; returns a cancel function. */
function whenIdle(task: () => void): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(task, { timeout: 4000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(task, 1000)
  return () => clearTimeout(id)
}

/** A derived array per source array, so a layer prop keeps its identity and uploads once. */
function memoByIdentity<K extends object, V>(make: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>()
  return (key) => {
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const value = make(key)
    cache.set(key, value)
    return value
  }
}

const PADDING = 16
const AXIS_ROOM = 34
const AXIS_LEFT = 58
/** The skyline's pitched camera. */
const PITCH = 50
const BEARING = -12
/** Zoom steps the pitched camera backs off, so the far north stays on the stage. */
const PULL_BACK = 0.3
/** The tallest extrusion, as a share of the stage height at the resting camera. */
const TALLEST = 0.16

interface Target {
  readonly pixels: Float32Array
  readonly lonLat: Float32Array
  readonly layout: EngineLayout
}

/** The inset's shapes placed for the current stage. */
interface PlacedInset {
  readonly frame: InsetFrame
  readonly lonLat: Float32Array
  readonly pixels: Float32Array
  readonly boxes: Float32Array
  readonly paths: BinaryPaths
  /** The inset panel and the part of the map it redraws, as closed paths. */
  readonly frames: readonly Float32Array[]
  extrusion: Extrusion | undefined
}

export class ExplorerEngine {
  private readonly deck: Deck<MapView>
  private readonly indices: Uint32Array
  private readonly shapes: MapShapes
  private readonly shapePaths: BinaryPaths
  private readonly insetShapes: MapShapes | undefined
  private readonly resizeObserver: ResizeObserver
  private size: Size
  private frame: MapFrame
  private shapePixels: Float32Array
  private shapeBoxes: Float32Array
  private placed: PlacedInset | undefined
  private mainExtrusion: Extrusion | undefined
  private palette: Palette
  private scene: EngineScene | undefined
  private target: Target | undefined
  private positionsFrom: Float32Array
  private positionsTo: Float32Array
  /** Per-area RGBA: the colours the marks leave and reach in a change. */
  private areaFrom: Uint8Array
  private areaTo: Uint8Array
  private meta: Float32Array
  private readonly ringColours: (area: Uint8Array) => Uint8Array
  private readonly shapeColours: (area: Uint8Array) => Uint8Array
  private readonly insetColours: (area: Uint8Array) => Uint8Array
  private readonly shapeMeta: (styles: Uint8Array) => Float32Array
  private readonly insetMeta: (styles: Uint8Array) => Float32Array
  /** `shapes` is 1 once the real shapes have faded in over the rings at rest on the map. */
  private readonly anim = { tPosition: 1, tColour: 1, opacity: 1, outline: 0, shapes: 0 }
  private readonly camAnim = { pitch: 0, bearing: 0, pull: 0, elevation: 0 }
  private timeline: gsap.core.Timeline | undefined
  private cameraTimeline: gsap.core.Timeline | undefined
  private skyline: Float32Array | undefined
  private hovered = -1
  private cancelIdle: () => void = () => {}
  private warmed = false
  /** Flat heights and fixed colours for the hidden skyline, once it is built in idle time. */
  private skylineIdle: { readonly heights: Float32Array; readonly colours: Uint8Array } | undefined
  /** WebGL runs in software (SwiftShader, llvmpipe): the map skips its hairlines. */
  private software = false
  private ready = false
  private destroyed = false

  private readonly container: HTMLDivElement
  private readonly options: EngineOptions

  constructor(container: HTMLDivElement, options: EngineOptions) {
    this.container = container
    this.options = options
    const { areaCount, points, boundaries, shapes } = options
    this.indices = triangulate(boundaries, areaCount, points)
    this.shapes = shapes
    this.shapePaths = closedRings(shapes)
    this.insetShapes =
      options.inset === undefined ? undefined : subsetShapes(shapes, options.inset.areas)
    const insetShapes = this.insetShapes
    this.size = { width: container.clientWidth, height: container.clientHeight }
    this.frame = mapFrame(this.size, options.bounds, options.inset?.bounds, PADDING)
    this.shapePixels = projectAll(this.frame.camera, this.size, shapes.lonLat)
    this.shapeBoxes = areaBoxes(shapes, this.shapePixels)
    this.placed = this.placeInset()
    this.palette = readPalette(container)
    this.positionsFrom = boundaries
    this.positionsTo = boundaries
    this.areaFrom = new Uint8Array(areaCount * 4)
    this.areaTo = this.areaFrom
    this.meta = perVertexMeta(new Uint8Array(areaCount), points)
    this.ringColours = memoByIdentity((area) => perVertexColours(area, points))
    this.shapeColours = memoByIdentity((area) => shapeColours(area, shapes.areaOf))
    this.insetColours = memoByIdentity((area) =>
      shapeColours(area, insetShapes?.areaOf ?? new Uint32Array(0)),
    )
    this.shapeMeta = memoByIdentity((styles) => shapeMeta(styles, shapes.areaOf))
    this.insetMeta = memoByIdentity((styles) =>
      shapeMeta(styles, insetShapes?.areaOf ?? new Uint32Array(0)),
    )

    this.deck = new Deck<MapView>({
      parent: container,
      views: new MapView({ repeat: false }),
      viewState: this.viewState(),
      controller: false,
      // The canvas never pans or zooms, so touch scrolling passes through to the page.
      touchAction: 'pan-y',
      // Hit tests run on the CPU against the target shapes, so deck.gl needs no picking pass.
      _pickable: false,
      style: { left: '0', top: '0' },
      layers: [],
      onLoad: () => {
        if (this.destroyed) return
        // deck.gl's event manager makes the canvas focusable with no outline; it is
        // aria-hidden, and keyboard readers reach every area outside it.
        const canvas = this.deck.getCanvas()
        if (canvas !== null) canvas.tabIndex = -1
        this.software = softwareRenderer(canvas)
        this.ready = true
        this.render()
        options.onReady()
        this.cancelIdle = whenIdle(() => this.prepareSkyline())
      },
    })
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    container.addEventListener('pointermove', this.onPointerMove)
    container.addEventListener('pointerleave', this.onPointerLeave)
    container.addEventListener('click', this.onClick)
  }

  /** Apply a new scene. `kind` says what changed, which picks the motion. */
  update(scene: EngineScene, kind: ChangeKind, reduced: boolean): void {
    const previous = this.scene
    this.scene = scene
    const next = this.computeTarget(scene)
    const moves =
      previous === undefined ||
      previous.view !== scene.view ||
      (scene.view === 'rank' && previous.rankValues !== scene.rankValues) ||
      (scene.view === 'swarm' && previous.swarmXY !== scene.swarmXY)
    const recolours =
      previous === undefined ||
      previous.bins !== scene.bins ||
      previous.scaleKind !== scene.scaleKind ||
      previous.styles !== scene.styles
    if (previous?.styles !== scene.styles)
      this.meta = perVertexMeta(scene.styles, this.options.points)
    const colours = areaColours(scene.bins, scene.scaleKind, this.palette)
    if (previous === undefined) {
      this.jumpTo(next, colours)
    } else if (moves || recolours) {
      this.transition(
        next,
        colours,
        moves,
        recolours,
        previous.view === scene.view ? kind : 'view',
        reduced,
      )
    } else {
      this.target = next
      this.render()
    }
  }

  /** Raise every area's real shape to `heights` (0 to 1) with a pitched camera, or settle flat. */
  setSkyline(skyline: SkylineInput | undefined): void {
    this.cameraTimeline?.kill()
    const rising = skyline !== undefined
    if (rising) {
      this.skyline = skyline.heights
      this.mainExtrusion ??= extrusion(this.shapes)
      if (this.placed !== undefined && this.insetShapes !== undefined) {
        this.placed.extrusion ??= extrusion(this.insetShapes, this.placed.lonLat)
      }
    }
    this.cameraTimeline = gsap
      .timeline({
        onUpdate: () => this.applyCamera(),
        onComplete: () => {
          if (!rising) this.skyline = undefined
          this.applyCamera()
          if (this.target !== undefined) this.options.onLayout(this.target.layout)
        },
      })
      .to(this.camAnim, {
        pitch: rising ? PITCH : 0,
        bearing: rising ? BEARING : 0,
        pull: rising ? PULL_BACK : 0,
        duration: MOTION.camera,
        ease: CAMERA_EASE,
      })
      .to(
        this.camAnim,
        { elevation: rising ? 1 : 0, duration: MOTION.camera * 0.75, ease: EASE },
        rising ? MOTION.camera * 0.35 : 0,
      )
  }

  /** Re-read the colour tokens after a theme change. */
  refreshTheme(): void {
    this.palette = readPalette(this.container)
    const scene = this.scene
    if (scene === undefined) return
    const colours = areaColours(scene.bins, scene.scaleKind, this.palette)
    this.areaFrom = colours
    this.areaTo = colours
    this.render()
  }

  /** Build the skyline's geometry and GPU buffers before the reader asks for it. */
  private prepareSkyline(): void {
    if (this.destroyed || this.skylineIdle !== undefined) return
    const { areaCount } = this.options
    this.skylineIdle = {
      heights: new Float32Array(areaCount),
      colours: new Uint8Array(areaCount * 4),
    }
    this.render()
  }

  destroy(): void {
    this.destroyed = true
    this.cancelIdle()
    this.timeline?.kill()
    this.cameraTimeline?.kill()
    this.resizeObserver.disconnect()
    this.container.removeEventListener('pointermove', this.onPointerMove)
    this.container.removeEventListener('pointerleave', this.onPointerLeave)
    this.container.removeEventListener('click', this.onClick)
    this.deck.finalize()
  }

  /** The inset's shapes and frames for the current camera, or undefined without an inset. */
  private placeInset(): PlacedInset | undefined {
    const frame = this.frame.inset
    const shapes = this.insetShapes
    if (frame === undefined || shapes === undefined) return undefined
    const { camera } = this.frame
    const pixels = allIntoInset(frame, projectAll(camera, this.size, shapes.lonLat))
    const lonLat = unprojectAll(camera, this.size, pixels)
    const box = (rect: Rect) =>
      unprojectAll(
        camera,
        this.size,
        Float32Array.of(
          rect.x,
          rect.y,
          rect.x + rect.width,
          rect.y,
          rect.x + rect.width,
          rect.y + rect.height,
          rect.x,
          rect.y + rect.height,
          rect.x,
          rect.y,
        ),
      )
    return {
      frame,
      lonLat,
      pixels,
      boxes: areaBoxes(shapes, pixels),
      paths: closedRings(shapes, lonLat),
      frames: [box(frame.rect), box(frame.source)],
      extrusion: undefined,
    }
  }

  private computeTarget(scene: EngineScene): Target {
    const { size } = this
    const { camera } = this.frame
    const { points, areaCount, boundaries } = this.options
    if (scene.view === 'map') {
      const layout = mapLayout(boundaries, camera, size, areaCount, points)
      const centres = layout.centres
      const placed = this.placed
      const insetShapes = this.insetShapes
      if (placed !== undefined && insetShapes !== undefined) {
        this.options.inset?.areas.forEach((area, k) => {
          const [x, y] = areaAnchor(insetShapes, placed.pixels, k)
          centres[area * 2] = x
          centres[area * 2 + 1] = y
        })
      }
      return {
        pixels: layout.rings,
        lonLat: boundaries,
        layout: {
          view: 'map',
          size,
          centres,
          ...(placed === undefined ? {} : { inset: placed.frame }),
        },
      }
    }
    if (scene.view === 'hex') {
      const layout = hexLayout(scene.hex, insetOf(size, PADDING), points)
      return {
        pixels: layout.rings,
        lonLat: unprojectAll(camera, size, layout.rings),
        layout: { view: 'hex', size, centres: layout.centres },
      }
    }
    if (scene.view === 'swarm') {
      // A tall canvas (a phone held upright) runs the value axis up the stage.
      const vertical = size.height > size.width * 1.2
      const stage = vertical
        ? {
            x: PADDING + AXIS_LEFT,
            y: PADDING + 8,
            width: size.width - 2 * PADDING - AXIS_LEFT,
            height: size.height - 2 * PADDING - 16,
          }
        : {
            x: PADDING + 8,
            y: PADDING,
            width: size.width - 2 * (PADDING + 8),
            height: size.height - 2 * PADDING - AXIS_ROOM,
          }
      const layout = swarmLayout(scene.swarmXY, scene.swarmRadius, stage, points, vertical)
      const rule = vertical ? stage.x - 10 : stage.y + stage.height + 10
      return {
        pixels: layout.rings,
        lonLat: unprojectAll(camera, size, layout.rings),
        layout: { view: 'swarm', size, centres: layout.centres, swarm: { ...layout.axis, rule } },
      }
    }
    const stage = {
      x: PADDING,
      y: PADDING + 12,
      width: size.width - 2 * PADDING,
      height: size.height - 2 * PADDING - 12 - AXIS_ROOM,
    }
    const layout = rankLayout(scene.rankValues, stage, points)
    return {
      pixels: layout.rings,
      lonLat: unprojectAll(camera, size, layout.rings),
      layout: {
        view: 'rank',
        size,
        centres: layout.centres,
        rank: {
          baseline: layout.baseline,
          top: stage.y,
          bottom: stage.y + stage.height,
          domain: layout.domain,
        },
      },
    }
  }

  private jumpTo(target: Target, colours: Uint8Array): void {
    this.timeline?.kill()
    this.target = target
    this.positionsFrom = target.lonLat
    this.positionsTo = target.lonLat
    this.areaFrom = colours
    this.areaTo = colours
    this.anim.tPosition = 1
    this.anim.tColour = 1
    this.anim.opacity = 1
    const map = target.layout.view === 'map' ? 1 : 0
    this.anim.outline = map
    this.anim.shapes = map
    this.render()
    this.options.onLayout(target.layout)
  }

  private transition(
    target: Target,
    colours: Uint8Array,
    moves: boolean,
    recolours: boolean,
    kind: ChangeKind,
    reduced: boolean,
  ): void {
    this.timeline?.kill()
    // Start from wherever the marks are now, so an interrupted morph retargets smoothly.
    const from = new Float32Array(this.positionsTo.length)
    mixInto(from, this.positionsFrom, this.positionsTo, this.anim.tPosition)
    const coloursNow = new Uint8Array(this.areaTo.length)
    mixBytesInto(coloursNow, this.areaFrom, this.areaTo, this.anim.tColour)
    this.positionsFrom = from
    this.positionsTo = target.lonLat
    this.areaFrom = coloursNow
    this.areaTo = colours
    this.target = target
    this.anim.tPosition = 0
    this.anim.tColour = 0
    this.hovered = -1
    this.options.onHover(-1, 0, 0)

    const map = target.layout.view === 'map' ? 1 : 0
    // Hairlines and real shapes belong to the map at rest: they leave as the marks move.
    if (moves) this.anim.outline = 0
    const timeline = gsap.timeline({
      onUpdate: () => this.render(),
      onComplete: () => {
        this.render()
        this.options.onLayout(target.layout)
      },
    })
    if (reduced) {
      timeline
        .to(this.anim, { opacity: 0, duration: MOTION.fade / 2, ease: 'none' })
        .set(this.anim, { tPosition: 1, tColour: 1, outline: map, shapes: map })
        .to(this.anim, { opacity: 1, duration: MOTION.fade / 2, ease: 'none' })
    } else {
      for (const stage of stagePlan(kind, moves, recolours, false)) {
        const key = stage.name === 'positions' ? 'tPosition' : 'tColour'
        timeline.to(this.anim, { [key]: 1, duration: stage.duration, ease: EASE }, stage.start)
      }
      if (!moves) this.anim.tPosition = 1
      if (!recolours) this.anim.tColour = 1
      // The shapes do not morph: they give way to the rings at once, and return once they land.
      if (moves && this.anim.shapes > 0) {
        timeline.to(this.anim, { shapes: 0, duration: MOTION.fade, ease: 'none' }, 0)
      }
      const settled = timeline.duration()
      if (map === 1 && this.anim.outline < 1) {
        timeline.to(this.anim, { outline: 1, duration: MOTION.colour, ease: EASE }, settled)
      }
      if (map === 1 && (moves || this.anim.shapes < 1)) {
        timeline.to(this.anim, { shapes: 1, duration: MOTION.colour, ease: EASE }, settled)
      }
    }
    this.timeline = timeline
  }

  private resize(): void {
    const size = { width: this.container.clientWidth, height: this.container.clientHeight }
    if (size.width === this.size.width && size.height === this.size.height) return
    if (size.width === 0 || size.height === 0) return
    this.size = size
    this.frame = mapFrame(size, this.options.bounds, this.options.inset?.bounds, PADDING)
    this.shapePixels = projectAll(this.frame.camera, size, this.shapes.lonLat)
    this.shapeBoxes = areaBoxes(this.shapes, this.shapePixels)
    this.placed = this.placeInset()
    if (this.placed !== undefined && this.skyline !== undefined && this.insetShapes !== undefined) {
      this.placed.extrusion = extrusion(this.insetShapes, this.placed.lonLat)
    }
    this.deck.setProps({ viewState: this.viewState() })
    const scene = this.scene
    if (scene === undefined) return
    const target = this.computeTarget(scene)
    this.timeline?.progress(1)
    this.target = target
    this.positionsFrom = target.lonLat
    this.positionsTo = target.lonLat
    this.anim.tPosition = 1
    this.render()
    this.options.onLayout(target.layout)
  }

  /** The fixed camera, tilted only for the skyline. */
  private viewState() {
    const { camera } = this.frame
    return {
      longitude: camera.longitude,
      latitude: camera.latitude,
      zoom: camera.zoom - this.camAnim.pull,
      pitch: this.camAnim.pitch,
      bearing: this.camAnim.bearing,
    }
  }

  private applyCamera(): void {
    this.deck.setProps({ viewState: this.viewState() })
    this.render()
  }

  private get moving(): boolean {
    return (
      this.anim.tPosition < 1 ||
      this.camAnim.pitch > 0 ||
      this.timeline?.isActive() === true ||
      this.cameraTimeline?.isActive() === true
    )
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.target === undefined || this.moving) return
    const box = this.container.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    const area = this.hitAt(x, y)
    if (area !== this.hovered) {
      this.hovered = area
      this.render()
    }
    this.options.onHover(area, x, y)
    this.container.style.cursor = area >= 0 ? 'pointer' : ''
  }

  private readonly onPointerLeave = (): void => {
    if (this.hovered === -1) return
    this.hovered = -1
    this.options.onHover(-1, 0, 0)
    this.render()
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (this.target === undefined || this.moving) return
    const box = this.container.getBoundingClientRect()
    this.options.onSelect(this.hitAt(event.clientX - box.left, event.clientY - box.top))
  }

  /** The area under pixel (x, y): in the map at rest its real shape, in the inset or on the map. */
  private hitAt(x: number, y: number): number {
    const { areaCount, points } = this.options
    if (this.scene?.view === 'map' && this.anim.shapes >= 1) {
      const placed = this.placed
      if (
        placed !== undefined &&
        this.insetShapes !== undefined &&
        inRect(placed.frame.rect, x, y)
      ) {
        return hitShapes(this.insetShapes, placed.pixels, placed.boxes, x, y)
      }
      return hitShapes(this.shapes, this.shapePixels, this.shapeBoxes, x, y)
    }
    return this.target === undefined ? -1 : hitTest(this.target.pixels, areaCount, points, x, y)
  }

  /** The ring of one area where it is drawn now, as a closed flat [lon, lat, ...] path. */
  private currentRing(area: number): Float32Array {
    const { points } = this.options
    const t = this.anim.tPosition
    const path = new Float32Array((points + 1) * 2)
    for (let k = 0; k <= points; k++) {
      const i = (area * points + (k % points)) * 2
      const x0 = this.positionsFrom[i] ?? 0
      const y0 = this.positionsFrom[i + 1] ?? 0
      path[k * 2] = x0 + ((this.positionsTo[i] ?? 0) - x0) * t
      path[k * 2 + 1] = y0 + ((this.positionsTo[i + 1] ?? 0) - y0) * t
    }
    return path
  }

  /** Outlines for the selected and emphasised areas, on the shapes at rest or the moving rings. */
  private emphasisPaths(outlined: readonly number[]): { area: number; path: Float32Array }[] {
    if (this.anim.shapes < 1 || this.scene?.view !== 'map') {
      return outlined.map((area) => ({ area, path: this.currentRing(area) }))
    }
    const out: { area: number; path: Float32Array }[] = []
    const insetAreas = this.options.inset?.areas ?? []
    for (const area of outlined) {
      for (const path of areaPaths(this.shapes, this.shapes.lonLat, area)) out.push({ area, path })
      const k = insetAreas.indexOf(area)
      if (k >= 0 && this.placed !== undefined && this.insetShapes !== undefined) {
        for (const path of areaPaths(this.insetShapes, this.placed.lonLat, k)) {
          out.push({ area, path })
        }
      }
    }
    return out
  }

  private render(): void {
    if (!this.ready || this.destroyed) return
    const scene = this.scene
    const selected = scene?.selected ?? -1
    const emphasised = this.hovered >= 0 ? this.hovered : (scene?.focused ?? -1)
    const skyline = this.skyline
    const dimOthers = selected >= 0 && skyline === undefined
    const flat = { depthCompare: 'always', depthWriteEnabled: false } as const
    const common = {
      tColour: this.anim.tColour,
      selected,
      hovered: emphasised,
      dimOthers,
      pixelRatio: window.devicePixelRatio || 1,
      paperColour: this.palette.paper,
      hatchColour: this.palette.inkMuted,
      parameters: flat,
    }
    const coloursFrom = this.areaFrom
    const coloursTo = this.areaTo
    const shapesShown = this.anim.shapes * this.anim.opacity
    const layers: Layer[] = [
      new MorphLayer({
        ...common,
        id: 'areas',
        positionsFrom: this.positionsFrom,
        positionsTo: this.positionsTo,
        coloursFrom: this.ringColours(coloursFrom),
        coloursTo: this.ringColours(coloursTo),
        meta: this.meta,
        indices: this.indices,
        tPosition: this.anim.tPosition,
        // Under the real shapes once they have fully faded in.
        visible: this.anim.shapes < 1,
        opacity: this.anim.opacity,
      }),
    ]
    // Drawn once, invisibly, on the first frame so their shaders compile before they are needed.
    const warming = !this.warmed
    if (scene !== undefined && (shapesShown > 0 || warming)) {
      const styles = scene.styles
      layers.push(
        new MorphLayer({
          ...common,
          id: 'shapes',
          positionsFrom: this.shapes.lonLat,
          positionsTo: this.shapes.lonLat,
          coloursFrom: this.shapeColours(coloursFrom),
          coloursTo: this.shapeColours(coloursTo),
          meta: this.shapeMeta(styles),
          indices: this.shapes.indices,
          tPosition: 1,
          opacity: shapesShown,
        }),
      )
      const placed = this.placed
      if (placed !== undefined && this.insetShapes !== undefined) {
        layers.push(
          new MorphLayer({
            ...common,
            id: 'inset-shapes',
            positionsFrom: placed.lonLat,
            positionsTo: placed.lonLat,
            coloursFrom: this.insetColours(coloursFrom),
            coloursTo: this.insetColours(coloursTo),
            meta: this.insetMeta(styles),
            indices: this.insetShapes.indices,
            tPosition: 1,
            opacity: shapesShown,
          }),
        )
      }
    }
    const mapAtRest = scene?.view === 'map' && this.anim.tPosition === 1
    const outline = mapAtRest ? this.anim.outline * this.anim.opacity : 0
    // A software renderer draws 43,000 hairline segments at a few frames a second, so it skips them.
    const hairlines = (mapAtRest || warming) && !this.software
    layers.push(
      new PathLayer({
        id: 'boundaries',
        data: this.shapePaths,
        positionFormat: 'XY',
        _pathType: 'open',
        getColor: rgba(this.palette.paper, 230),
        visible: hairlines,
        opacity: outline,
        widthUnits: 'pixels',
        getWidth: 0.6,
        parameters: flat,
      }),
    )
    const placed = this.placed
    if (placed !== undefined && (mapAtRest || warming)) {
      layers.push(
        new PathLayer({
          id: 'inset-boundaries',
          visible: hairlines,
          data: placed.paths,
          positionFormat: 'XY',
          _pathType: 'open',
          getColor: rgba(this.palette.paper, 230),
          opacity: outline * this.anim.shapes,
          widthUnits: 'pixels',
          getWidth: 0.75,
          parameters: flat,
        }),
        new PathLayer({
          id: 'inset-frame',
          data: placed.frames,
          positionFormat: 'XY',
          getPath: (path: Float32Array) => path,
          getColor: rgba(this.palette.inkMuted, 200),
          opacity: outline * this.anim.shapes,
          widthUnits: 'pixels',
          getWidth: 1,
          parameters: flat,
        }),
      )
    }
    const outlined = [selected, emphasised].filter(
      (area, i, all) => area >= 0 && all.indexOf(area) === i,
    )
    if (outlined.length > 0 && skyline === undefined) {
      layers.push(
        new PathLayer({
          id: 'emphasis',
          data: this.emphasisPaths(outlined),
          positionFormat: 'XY',
          getPath: (d: { path: Float32Array }) => d.path,
          getColor: (d: { area: number }) =>
            d.area === selected ? rgba(this.palette.ink, 255) : rgba(this.palette.inkMuted, 230),
          widthUnits: 'pixels',
          getWidth: (d: { area: number }) => (d.area === selected ? 2.25 : 1.5),
          opacity: this.anim.opacity,
          parameters: flat,
        }),
      )
    }
    if (skyline !== undefined && scene?.view === 'map') {
      layers.push(...this.skylineLayers(skyline, coloursTo, true))
    } else if (this.skylineIdle !== undefined) {
      // Built in idle time and kept hidden, so the reveal only sets heights.
      layers.push(...this.skylineLayers(this.skylineIdle.heights, this.skylineIdle.colours, false))
    } else if (warming) {
      // One triangle compiles the extrusion's shaders without building the whole map's walls.
      layers.push(
        new SolidPolygonLayer({
          id: 'skyline-warm',
          data: [0],
          getPolygon: (): [number, number][] =>
            [0, 1, 2].map((v) => [
              this.shapes.lonLat[v * 2] ?? 0,
              this.shapes.lonLat[v * 2 + 1] ?? 0,
            ]),
          extruded: true,
          opacity: 0,
          getElevation: 0,
        }),
      )
    }
    this.deck.setProps({ layers })
    if (warming) {
      this.warmed = true
      requestAnimationFrame(() => this.render())
    }
  }

  /** The map's shapes, and the inset's, extruded to their heights. */
  private skylineLayers(heights: Float32Array, colours: Uint8Array, visible: boolean): Layer[] {
    const { camera } = this.frame
    const metresPerPixel =
      (40_075_016.686 * Math.cos((camera.latitude * Math.PI) / 180)) / (512 * 2 ** camera.zoom)
    const tallest = this.size.height * TALLEST * metresPerPixel
    const layer = (id: string, solid: Extrusion) =>
      new SolidPolygonLayer({
        id,
        data: solid,
        _normalize: false,
        _windingOrder: 'CCW',
        positionFormat: 'XY',
        extruded: true,
        visible,
        getElevation: (_: unknown, { index }: { index: number }) => {
          const h = heights[solid.areaOfRing[index] ?? 0] ?? 0
          return Number.isFinite(h) ? h * tallest : 0
        },
        getFillColor: (_: unknown, { index }: { index: number }) => {
          const area = solid.areaOfRing[index] ?? 0
          return [
            colours[area * 4] ?? 0,
            colours[area * 4 + 1] ?? 0,
            colours[area * 4 + 2] ?? 0,
            255,
          ]
        },
        elevationScale: this.camAnim.elevation,
        updateTriggers: { getElevation: [heights, tallest], getFillColor: colours },
      })
    const solid = this.mainExtrusion ?? extrusion(this.shapes)
    this.mainExtrusion = solid
    const out: Layer[] = [layer('skyline', solid)]
    const placed = this.placed
    if (placed !== undefined && this.insetShapes !== undefined) {
      placed.extrusion ??= extrusion(this.insetShapes, placed.lonLat)
      out.push(layer('skyline-inset', placed.extrusion))
    }
    return out
  }
}
