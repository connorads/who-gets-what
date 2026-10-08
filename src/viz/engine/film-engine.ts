/**
 * The film's canvas: the explorer's stack (one deck.gl `Deck` with a
 * `MapView` and no basemap, ADR 0003) with grains added. The film
 * hands it a `FilmDraw` for every scroll position and it draws exactly that,
 * so the engine keeps no clock of its own. Area marks reuse the explorer's
 * MorphLayer: every layout is one ring per area, registered once per size.
 */
import { PathLayer, SolidPolygonLayer } from '@deck.gl/layers'
import { Deck, MapView, type Layer } from '@deck.gl/core'
import { boundsOf, fitCamera, type Camera, type Size } from '../layout/projection.ts'
import { perVertexColours, perVertexMeta, triangulate } from './geometry.ts'
import { GrainLayer, type PixelFrame } from './grain-layer.ts'
import { MorphLayer } from './morph-layer.ts'
import { readPalette, type Palette, type Rgb } from './palette.ts'

export interface GrainDraw {
  readonly from: string
  readonly to: string
  readonly fromFrame: PixelFrame
  readonly toFrame: PixelFrame
  readonly t: number
  readonly stagger: number
  /** Peak arc height in pixels. */
  readonly arc: number
  readonly fall: boolean
  readonly fade: number
  readonly radius: number
  /** Guess layer boundaries as key fractions. */
  readonly guess: readonly [number, number]
  readonly guessTint: number
  readonly familyTint: number
}

export interface AreaDraw {
  readonly from: string
  readonly to: string
  readonly t: number
  readonly opacity: number
  /** Boundary hairlines, 0 to 1: drawn only when the marks are real land at rest. */
  readonly outline: number
  /** Area index, or -1. */
  readonly selected: number
}

export interface SkylineDraw {
  /** The layout whose rings are extruded: the reader's shape, real land or equal-size hexes. */
  readonly layout: string
  /** 0 to 1 per area. */
  readonly heights: Float32Array
  /** RGBA bytes per area. */
  readonly colours: Uint8Array
  readonly elevation: number
}

export interface CameraPose extends Camera {
  readonly pitch: number
  readonly bearing: number
}

export interface FilmDraw {
  readonly grains?: GrainDraw
  readonly areas?: AreaDraw
  readonly skyline?: SkylineDraw
  readonly camera: CameraPose
}

export interface FilmEngineOptions {
  /** `rings.bin` boundaries, packed [lon, lat]. */
  readonly boundaries: Float32Array
  readonly areaCount: number
  readonly points: number
  /** Pixels kept clear round Great Britain at the resting camera: the letterbox and a margin. */
  readonly padding: number
  readonly onReady: () => void
  /** The stage changed size: every pixel layout must be computed again. */
  readonly onResize: (size: Size, home: Camera) => void
}

/** deck.gl binary polygon data: one ring per area, which deck.gl closes, winds and triangulates. */
function ringPolygons(rings: Float32Array, areaCount: number, points: number) {
  return {
    length: areaCount,
    startIndices: Uint32Array.from({ length: areaCount }, (_, area) => area * points),
    attributes: { getPolygon: { value: rings, size: 2 } },
  } as const
}

/** deck.gl binary path data: no per-path objects for the GPU upload. */
function closedPaths(rings: Float32Array, areaCount: number, points: number) {
  const value = new Float32Array(areaCount * (points + 1) * 2)
  const startIndices = new Uint32Array(areaCount)
  for (let area = 0; area < areaCount; area++) {
    const at = area * (points + 1)
    startIndices[area] = at
    value.set(rings.subarray(area * points * 2, (area + 1) * points * 2), at * 2)
    value[(at + points) * 2] = rings[area * points * 2] ?? 0
    value[(at + points) * 2 + 1] = rings[area * points * 2 + 1] ?? 0
  }
  return {
    length: areaCount,
    startIndices,
    attributes: { getPath: { value, size: 2 } },
  } as const
}

const NO_GUESS: readonly [Rgb, Rgb, Rgb] = [
  [201, 163, 94],
  [206, 124, 86],
  [66, 135, 135],
]

export class FilmEngine {
  private readonly deck: Deck<MapView>
  private readonly container: HTMLDivElement
  private readonly options: FilmEngineOptions
  private readonly indices: Uint32Array
  private readonly meta: Float32Array
  private readonly boundaryPaths: ReturnType<typeof closedPaths>
  private readonly bounds: ReturnType<typeof boundsOf>
  private readonly resizeObserver: ResizeObserver
  private readonly scenes = new Map<string, Uint16Array>()
  private readonly layouts = new Map<string, Float32Array>()
  /** Polygon data per layout array, so a frame that keeps the layout keeps its triangles. */
  private readonly polygons = new WeakMap<Float32Array, ReturnType<typeof ringPolygons>>()
  private grainKeys: Uint16Array = new Uint16Array(0)
  private grainColours: Uint8Array = new Uint8Array(0)
  private areaColours: Uint8Array
  private guessColours: readonly [Rgb, Rgb, Rgb] = NO_GUESS
  private palette: Palette
  private readonly brass: Rgb
  private last: FilmDraw | undefined
  private pose: CameraPose | undefined
  private ready = false
  private destroyed = false
  /** Every layer is drawn once, invisibly, before it is needed, so no chapter compiles a shader mid-scroll. */
  private warmed = false
  size: Size
  home: Camera

  constructor(container: HTMLDivElement, options: FilmEngineOptions) {
    this.container = container
    this.options = options
    const { boundaries, areaCount, points } = options
    this.indices = triangulate(boundaries, areaCount, points)
    this.meta = perVertexMeta(new Uint8Array(areaCount), points)
    this.boundaryPaths = closedPaths(boundaries, areaCount, points)
    this.bounds = boundsOf(boundaries)
    this.size = { width: container.clientWidth, height: container.clientHeight }
    this.home = fitCamera(this.bounds, this.size, options.padding)
    this.palette = readPalette(container)
    this.brass = this.token('--brass')
    this.areaColours = new Uint8Array(areaCount * points * 4)
    this.deck = new Deck<MapView>({
      parent: container,
      views: new MapView({ repeat: false }),
      viewState: { ...this.home, pitch: 0, bearing: 0 },
      controller: false,
      // The film scrolls the page, so touch scrolling passes through the canvas.
      touchAction: 'pan-y',
      // Nothing on the film's canvas is picked, so deck.gl needs no picking pass.
      _pickable: false,
      style: { left: '0', top: '0' },
      layers: [],
      onLoad: () => {
        if (this.destroyed) return
        // deck.gl's event manager makes the canvas focusable with no outline; it is
        // aria-hidden, and keyboard readers reach every area outside it.
        const canvas = this.deck.getCanvas()
        if (canvas !== null) canvas.tabIndex = -1
        this.ready = true
        if (this.last !== undefined) this.draw(this.last)
        options.onReady()
      },
    })
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
  }

  /** Reads the theme's paper, ink and ramp again, and redraws the last frame. */
  refreshTheme(): void {
    this.palette = readPalette(this.container)
    if (this.last !== undefined) this.draw(this.last)
  }

  /** A design token's colour, read where the canvas sits. */
  token(name: string): Rgb {
    const probe = document.createElement('span')
    probe.style.display = 'none'
    probe.style.color = `var(${name})`
    this.container.appendChild(probe)
    const match = /(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(getComputedStyle(probe).color)
    probe.remove()
    return match === null ? [128, 128, 128] : [Number(match[1]), Number(match[2]), Number(match[3])]
  }

  get sequential(): readonly Rgb[] {
    return this.palette.sequential
  }

  setGrains(keys: Uint16Array, colours: Uint8Array): void {
    this.grainKeys = keys
    this.grainColours = colours
    this.scenes.clear()
  }

  setScene(key: string, positions: Uint16Array): void {
    this.scenes.set(key, positions)
  }

  hasScene(key: string): boolean {
    return this.scenes.has(key)
  }

  /** One ring per area in [lon, lat], for the area marks to morph between. */
  setLayout(key: string, lonLat: Float32Array): void {
    this.layouts.set(key, lonLat)
  }

  /** RGBA bytes per area. */
  setAreaColours(colours: Uint8Array): void {
    this.areaColours = perVertexColours(colours, this.options.points)
  }

  setGuessColours(colours: readonly [Rgb, Rgb, Rgb]): void {
    this.guessColours = colours
  }

  draw(frame: FilmDraw): void {
    this.last = frame
    if (!this.ready || this.destroyed) return
    this.applyCamera(frame.camera)
    const layers: Layer[] = []
    const { areas, grains, skyline } = frame
    const from = areas === undefined ? undefined : this.layouts.get(areas.from)
    const to = areas === undefined ? undefined : this.layouts.get(areas.to)
    if (areas !== undefined && from !== undefined && to !== undefined && areas.opacity > 0) {
      layers.push(
        new MorphLayer({
          id: 'film-areas',
          positionsFrom: from,
          positionsTo: to,
          coloursFrom: this.areaColours,
          coloursTo: this.areaColours,
          meta: this.meta,
          indices: this.indices,
          tPosition: areas.t,
          tColour: 1,
          selected: areas.selected,
          hovered: -1,
          dimOthers: areas.selected >= 0,
          pixelRatio: window.devicePixelRatio || 1,
          paperColour: this.palette.paper,
          hatchColour: this.palette.inkMuted,
          opacity: areas.opacity,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
        }),
        new PathLayer({
          id: 'film-boundaries',
          data: this.boundaryPaths,
          positionFormat: 'XY',
          _pathType: 'open',
          getColor: [...this.palette.paper, 200],
          visible: areas.outline > 0,
          opacity: areas.outline * areas.opacity,
          widthUnits: 'pixels',
          getWidth: 0.6,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
        }),
      )
    }
    const skylineLayer =
      skyline !== undefined && skyline.elevation > 0 ? this.skylineLayer(skyline) : undefined
    if (skylineLayer !== undefined) layers.push(skylineLayer)
    if (!this.warmed) layers.push(...this.warmLayers(layers))
    if (grains !== undefined && grains.fade > 0) {
      const fromPositions = this.scenes.get(grains.from)
      const toPositions = this.scenes.get(grains.to)
      if (fromPositions !== undefined && toPositions !== undefined) {
        layers.push(
          new GrainLayer({
            id: 'film-grains',
            fromPositions,
            toPositions,
            keys: this.grainKeys,
            colours: this.grainColours,
            fromFrame: grains.fromFrame,
            toFrame: grains.toFrame,
            viewport: [this.size.width, this.size.height],
            t: grains.t,
            stagger: grains.stagger,
            arc: grains.arc,
            fall: grains.fall,
            radius: grains.radius,
            guess: grains.guess,
            guessColours: this.guessColours,
            brass: this.brass,
            guessTint: grains.guessTint,
            familyTint: grains.familyTint,
            fade: grains.fade,
            resident: [...this.scenes.values()],
            parameters: { depthCompare: 'always', depthWriteEnabled: false },
          }),
        )
      }
    }
    this.deck.setProps({ layers })
    if (!this.warmed && this.layouts.has('shape')) {
      this.warmed = true
      requestAnimationFrame(() => {
        if (this.last !== undefined) this.draw(this.last)
      })
    }
  }

  destroy(): void {
    this.destroyed = true
    this.resizeObserver.disconnect()
    this.deck.finalize()
  }

  private applyCamera(pose: CameraPose): void {
    const last = this.pose
    if (
      last !== undefined &&
      last.longitude === pose.longitude &&
      last.latitude === pose.latitude &&
      last.zoom === pose.zoom &&
      last.pitch === pose.pitch &&
      last.bearing === pose.bearing
    ) {
      return
    }
    this.pose = pose
    this.deck.setProps({
      viewState: {
        longitude: pose.longitude,
        latitude: pose.latitude,
        zoom: pose.zoom,
        pitch: pose.pitch,
        bearing: pose.bearing,
      },
    })
  }

  private resize(): void {
    const size = { width: this.container.clientWidth, height: this.container.clientHeight }
    if (size.width === this.size.width && size.height === this.size.height) return
    if (size.width === 0 || size.height === 0) return
    this.size = size
    this.home = fitCamera(this.bounds, size, this.options.padding)
    this.pose = undefined
    this.options.onResize(size, this.home)
  }

  /** Transparent stand-ins, under the ids the real layers use, for the layers this frame lacks. */
  private warmLayers(present: readonly Layer[]): Layer[] {
    const ids = new Set(present.map((layer) => layer.id))
    const shape = this.layouts.get('shape')
    const out: Layer[] = []
    if (shape !== undefined && !ids.has('film-areas')) {
      out.push(
        new MorphLayer({
          id: 'film-areas',
          positionsFrom: shape,
          positionsTo: shape,
          coloursFrom: this.areaColours,
          coloursTo: this.areaColours,
          meta: this.meta,
          indices: this.indices,
          tPosition: 1,
          tColour: 1,
          selected: -1,
          hovered: -1,
          dimOthers: false,
          pixelRatio: window.devicePixelRatio || 1,
          paperColour: this.palette.paper,
          hatchColour: this.palette.inkMuted,
          opacity: 0,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
        }),
        new PathLayer({
          id: 'film-boundaries',
          data: this.boundaryPaths,
          positionFormat: 'XY',
          _pathType: 'open',
          getColor: [...this.palette.paper, 200],
          opacity: 0,
          widthUnits: 'pixels',
          getWidth: 0.6,
          parameters: { depthCompare: 'always', depthWriteEnabled: false },
        }),
      )
    }
    if (!ids.has('film-skyline')) {
      const n = this.options.areaCount
      const skyline = this.skylineLayer({
        layout: 'shape',
        heights: new Float32Array(n),
        colours: new Uint8Array(n * 4),
        elevation: 0,
      })
      if (skyline !== undefined) out.push(skyline)
    }
    return out
  }

  /** Each area's ring in the layout, extruded to its height: real shapes on the map, prisms on hexes. */
  private skylineLayer(skyline: SkylineDraw): Layer | undefined {
    const rings = this.layouts.get(skyline.layout)
    if (rings === undefined) return undefined
    let data = this.polygons.get(rings)
    if (data === undefined) {
      data = ringPolygons(rings, this.options.areaCount, this.options.points)
      this.polygons.set(rings, data)
    }
    const metresPerPixel =
      (40_075_016.686 * Math.cos((this.home.latitude * Math.PI) / 180)) /
      (512 * 2 ** this.home.zoom)
    const tallest = this.size.height * 0.3 * metresPerPixel
    return new SolidPolygonLayer({
      id: 'film-skyline',
      data,
      positionFormat: 'XY',
      extruded: true,
      getElevation: (_: unknown, { index }: { index: number }) => {
        const h = skyline.heights[index] ?? 0
        return Number.isFinite(h) ? h * tallest : 0
      },
      getFillColor: (_: unknown, { index }: { index: number }) => [
        skyline.colours[index * 4] ?? 0,
        skyline.colours[index * 4 + 1] ?? 0,
        skyline.colours[index * 4 + 2] ?? 0,
        255,
      ],
      elevationScale: skyline.elevation,
      updateTriggers: {
        getElevation: [skyline.heights, tallest],
        getFillColor: skyline.colours,
      },
    })
  }
}
