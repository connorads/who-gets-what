/**
 * Watch mode. One GSAP timeline carries `progress` from 0 to 1 across the
 * reel; every update hands the canvas `drawFor(frameAt(progress))` and moves
 * the captions and overlays. The viewer's scroll scrubs it through
 * ScrollTrigger; a playing film sets it directly through `show`, the
 * player's surface, and scrolls the page to match. Data loads after first
 * paint, grain buffers stream in from a worker scene by scene, and the
 * reader's own inputs (guess, shape, postcode) re-render the current frame.
 */
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { parseBundle } from '#/domain/bundle.ts'
import { dataPath } from '#/domain/contract.ts'
import { createSiteData } from '#/data/site-data.ts'
import { dataSource, RELEASE, required } from '#/data/source.ts'
import { binAll, colourDomain } from '#/viz/colour.ts'
import { FilmEngine, type CameraPose } from '#/viz/engine/film-engine.ts'
import { beeswarm } from '#/viz/layout/beeswarm.ts'
import {
  boundsOf,
  fitCamera,
  project,
  unproject,
  unprojectAll,
  worldX,
  worldY,
  type Camera,
  type Rect,
  type Size,
} from '#/viz/layout/projection.ts'
import { mixInto } from '#/viz/layout/rings.ts'
import { hexLayout, mapLayout, swarmLayout, type SwarmAxis } from '#/viz/layout/views.ts'
import { CAMERA_EASE, EASE, MOTION } from '#/viz/motion.ts'
import type { FilmAudio } from './audio.ts'
import {
  captionAt,
  chapterCues,
  drawCaption,
  orderedBeats,
  scrollClockMs,
  type CaptionState,
  type Cue,
} from './captions.ts'
import { loadFilmData, type FilmData } from './data.ts'
import type { FilmFacts } from './facts.ts'
import { dividers, type Shares } from './guess.ts'
import type { GrainBlock } from './grains/allocate.ts'
import { readWorkerOut } from './grains/messages.ts'
import { hexFrame, hexGrid, type HexGrid, type WallLayout } from './grains/scenes.ts'
import type { Landing } from './PostcodeLanding.tsx'
import { CHAPTER_ANCHOR, SCRIPT, type ChapterId, type SkylineId } from './script.ts'
import type { FilmSearch } from './search.ts'
import { drawFor, wallRect, WALL_ROWS, type SkylineData, type StageContext } from './stage.ts'
import { classify, GRAIN_UNIT, readHints, tierOverride } from './tier.ts'
import {
  BEAT_STARTS,
  frameAt,
  locate,
  phase,
  restProgress,
  spans,
  type FilmFrame,
  type Span,
} from './timeline.ts'

export interface StageSignals {
  readonly onReady: () => void
  readonly onFail: (error: unknown) => void
  readonly onWall: (wall: WallReading | undefined) => void
}

/** What the wall shows under the middle of the screen: the block there and the running total to it. */
export interface WallReading {
  readonly label: string
  readonly block: number
  readonly total: number
}

export interface ControllerInputs {
  readonly guess: Shares
  readonly locked: boolean
  readonly shape: 'hex' | 'map'
  readonly landed: Landing | undefined
}

/** One-off sound cues as the film moves forwards past a point. */
const CUES: readonly { readonly chapter: ChapterId; readonly at: number; readonly cue: string }[] =
  [
    { chapter: 'the-pour', at: 0.05, cue: 'pour' },
    { chapter: 'the-pour', at: 0.7, cue: 'settle' },
    { chapter: 'the-wall', at: 0.02, cue: 'stack-loop' },
    { chapter: 'the-wall', at: 0.3, cue: 'settle' },
    { chapter: 'the-wall', at: 0.36, cue: 'pan' },
    { chapter: 'the-rain', at: 0.03, cue: 'rain' },
    { chapter: 'the-rain', at: 0.6, cue: 'morph' },
    { chapter: 'two-skylines', at: 0.02, cue: 'tilt' },
    { chapter: 'two-skylines', at: 0.12, cue: 'rise' },
    { chapter: 'north-south-or-age', at: 0.16, cue: 'morph' },
    { chapter: 'north-south-or-age', at: 0.58, cue: 'morph' },
  ]

const SWARM_RADIUS = 0.0058

const SKYLINE_MEASURE: Readonly<Record<SkylineId, string>> = {
  pensioner: 'pensioner benefits for each person aged 66 and over',
  'working-age': 'working-age benefits for each person aged 16 to 64',
}

/** Column heights from 0 to 1: values over the 98th percentile, so one outlier does not flatten the rest. */
function heights(values: Float32Array): Float32Array {
  const sorted = Array.from(values)
    .filter(Number.isFinite)
    .toSorted((a, b) => a - b)
  const top = sorted[Math.floor(sorted.length * 0.98)] ?? 1
  return Float32Array.from(values, (v) => (Number.isFinite(v) ? Math.min(v / top, 1) : 0))
}

/** Every ring in the unit frame of the rings' bounds (0 to 1, y down), in Web Mercator. */
function landRings(lonLat: Float32Array): Float32Array {
  const [[west, south], [east, north]] = boundsOf(lonLat)
  const x0 = worldX(west)
  const y0 = worldY(north)
  const w = worldX(east) - x0
  const h = worldY(south) - y0
  const out = new Float32Array(lonLat.length)
  for (let i = 0; i < lonLat.length; i += 2) {
    out[i] = (worldX(lonLat[i] ?? 0) - x0) / w
    out[i + 1] = (worldY(lonLat[i + 1] ?? 0) - y0) / h
  }
  return out
}

/** The rings' bounds as a pixel rectangle at `camera`. */
function boundsRect(camera: Camera, size: Size, lonLat: Float32Array): Rect {
  const [[west, south], [east, north]] = boundsOf(lonLat)
  const [x0, y0] = project(camera, size, west, north)
  const [x1, y1] = project(camera, size, east, south)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

interface Layouts {
  readonly size: Size
  readonly home: Camera
  readonly grid: HexGrid
  readonly hexFrame: Rect
  readonly hexLonLat: Float32Array
  readonly hexCentres: Float32Array
  readonly mapCentres: Float32Array
  /** The rings' bounds on the stage: the map grain scene's frame. */
  readonly mapFrame: Rect
  readonly swarmAxis: SwarmAxis
}

export class FilmController {
  private readonly root: HTMLElement
  private readonly signals: StageSignals
  private readonly search: FilmSearch
  private readonly facts: FilmFacts
  private readonly audio: FilmAudio
  private readonly spans: readonly Span[] = spans(SCRIPT)
  private readonly skylineOrder: readonly [SkylineId, SkylineId]
  private readonly proxy = { p: 0 }
  private readonly shapeAnim = { mix: 0 }
  private readonly flight = { t: 0 }
  private inputs: ControllerInputs
  private engine: FilmEngine | undefined
  private worker: Worker | undefined
  private data: FilmData | undefined
  private boundaries: Float32Array = new Float32Array(0)
  private points = 64
  private layouts: Layouts | undefined
  private shapeLonLat: Float32Array = new Float32Array(0)
  private areaX: Float32Array = new Float32Array(0)
  private skylines: Record<SkylineId, SkylineData> | undefined
  private unit = GRAIN_UNIT.light
  private grainCount = 0
  private blocks: readonly GrainBlock[] = []
  private wall: WallLayout | undefined
  private posterStamp = 0
  private readonly ready = { engine: false, heap: false, poster: false }
  private timeline: gsap.core.Timeline | undefined
  private trigger: ScrollTrigger | undefined
  private scrub: gsap.core.Tween | undefined
  /** The progress `show` last set, so the scroll it causes is not scrubbed again. */
  private shown: number | undefined
  private split: SplitText | undefined
  private flightTween: gsap.core.Tween | undefined
  private shapeTween: gsap.core.Tween | undefined
  private cameraFrom: Camera | undefined
  private cameraTo: Camera | undefined
  private chapter = -1
  private landingAt: number | undefined
  private caption = ''
  private wallShown = ''
  private lastProgress = 0
  private readonly cues = new Map<ChapterId, readonly Cue[]>()
  private posterTimer = 0
  private destroyed = false

  constructor(
    root: HTMLElement,
    options: {
      readonly signals: StageSignals
      readonly search: FilmSearch
      readonly facts: FilmFacts
      readonly inputs: ControllerInputs
      /** The player's sound: cues here, and beat lengths for the captions. */
      readonly audio: FilmAudio
      readonly skylineOrder: readonly [SkylineId, SkylineId]
    },
  ) {
    this.root = root
    this.signals = options.signals
    this.search = options.search
    this.facts = options.facts
    this.inputs = options.inputs
    this.audio = options.audio
    this.skylineOrder = options.skylineOrder
    this.shapeAnim.mix = options.inputs.shape === 'map' ? 1 : 0
  }

  /** Letterbox height plus a margin: what every map layout keeps clear top and bottom. */
  private margin(): number {
    const bar = this.root.querySelector('.film-bar')
    return (bar instanceof HTMLElement ? bar.offsetHeight : 40) + 12
  }

  /** The stage less the letterbox, where Great Britain is drawn. */
  private clear(size: Size): Rect {
    const margin = this.margin()
    return {
      x: 16,
      y: margin,
      width: size.width - 32,
      height: Math.max(size.height - 2 * margin, 1),
    }
  }

  private element(selector: string): HTMLElement {
    const found = this.root.querySelector(selector)
    if (!(found instanceof HTMLElement)) throw new Error(`Film needs ${selector}`)
    return found
  }

  async start(): Promise<void> {
    gsap.registerPlugin(ScrollTrigger, SplitText)
    const source = dataSource()
    const site = createSiteData(source, RELEASE)
    const [data, meta, ringBytes] = await Promise.all([
      loadFilmData(site, SCRIPT),
      site.areas('constituency'),
      required(source.bytes(dataPath.rings(RELEASE, 'constituency'))),
    ])
    if (this.destroyed) return
    const rings = parseBundle(ringBytes, meta.areaOrderHash)
    if (!rings.ok || rings.value.kind !== 'rings')
      throw new Error('rings.bin is not a rings bundle')
    this.data = data
    this.boundaries = rings.value.lonLat
    this.points = rings.value.header.pointsPerRing

    const probe = document.createElement('canvas').getContext('webgl2')
    if (probe === null) throw new Error('WebGL2 is not available')
    const tier = tierOverride(this.search.grain) ?? classify(readHints(probe))
    this.unit = GRAIN_UNIT[tier]
    this.element('.film-key').textContent =
      `Each dot = £${this.unit / 1e6}m · ${this.facts.period} · ${this.facts.priceBase} prices`

    const host = this.element('.film-canvas')
    if (!(host instanceof HTMLDivElement)) throw new Error('Film needs .film-canvas as a div')
    host.addEventListener('webglcontextlost', this.onContextLost, true)
    const engine = new FilmEngine(host, {
      boundaries: this.boundaries,
      areaCount: data.areas.length,
      points: this.points,
      padding: this.margin(),
      onReady: () => {
        this.ready.engine = true
        this.checkReady()
      },
      onResize: () => {
        this.relayout()
        this.requestPoster()
        this.render(this.proxy.p)
      },
    })
    this.engine = engine
    engine.setGuessColours([
      engine.token('--family-state-pension'),
      engine.token('--family-personal-independence'),
      engine.token('--family-universal-credit'),
    ])
    this.colourAreas()
    this.relayout()

    const worker = new Worker(new URL('./grains/worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    worker.addEventListener('message', (event: MessageEvent<unknown>) => this.onWorker(event.data))
    worker.postMessage(
      {
        type: 'build',
        data,
        unit: this.unit,
        rows: WALL_ROWS,
        cells: data.areas.map(({ q, r }) => ({ q, r })),
        land: landRings(this.boundaries),
        points: this.points,
      },
      [],
    )

    void this.audio.load().then(() => {
      this.cues.clear()
      this.render(this.proxy.p)
    })
    await document.fonts.ready
    if (this.destroyed) return
    this.buildTimeline()
  }

  update(inputs: ControllerInputs): void {
    const previous = this.inputs
    this.inputs = inputs
    if (previous.shape !== inputs.shape) this.tweenShape(inputs.shape)
    if (previous.landed?.code !== inputs.landed?.code && inputs.landed !== undefined) {
      this.fly(inputs.landed.code)
      this.audio.cue('land')
    }
    this.render(this.proxy.p)
  }

  /** The player's surface: show `progress` now, with no scrub smoothing, and scroll the page there. */
  show(progress: number): void {
    this.scrollToProgress(progress, false)
  }

  /** Scroll progress at the page's scroll position, before any smoothing. */
  progress(): number {
    const trigger = this.trigger
    if (trigger === undefined || trigger.end <= trigger.start) return 0
    return Math.min(
      Math.max((window.scrollY - trigger.start) / (trigger.end - trigger.start), 0),
      1,
    )
  }

  /** Fly back to Great Britain, for the hand-off to the explorer's first frame. */
  home(): Promise<void> {
    return new Promise((resolve) => {
      if (this.cameraTo === undefined) {
        resolve()
        return
      }
      this.flightTween?.kill()
      this.flightTween = gsap.to(this.flight, {
        t: 0,
        duration: 0.6,
        ease: CAMERA_EASE,
        onUpdate: () => this.render(this.proxy.p),
        onComplete: () => resolve(),
      })
    })
  }

  /** The site theme changed: recolour the areas from its ramp and redraw. */
  refreshTheme(): void {
    if (this.engine === undefined) return
    this.engine.refreshTheme()
    this.colourAreas()
    this.render(this.proxy.p)
  }

  destroy(): void {
    this.destroyed = true
    this.root.removeEventListener('click', this.onChapterLink)
    window.clearTimeout(this.posterTimer)
    this.trigger?.kill()
    this.scrub?.kill()
    this.timeline?.kill()
    this.split?.revert()
    this.flightTween?.kill()
    this.shapeTween?.kill()
    this.worker?.terminate()
    this.engine?.destroy()
  }

  private readonly onContextLost = (): void => {
    this.signals.onFail(new Error('WebGL context lost'))
  }

  private checkReady(): void {
    if (!this.ready.engine || !this.ready.heap || !this.ready.poster) return
    // A `?frame=` or chapter link scrolls once everything is drawn, after the router's own scroll restoration.
    const at = this.landingAt
    if (at !== undefined && this.timeline !== undefined) {
      this.landingAt = undefined
      this.scrollToProgress(at, false)
    }
    this.render(this.proxy.p)
    this.signals.onReady()
  }

  private onWorker(raw: unknown): void {
    const message = readWorkerOut(raw)
    const engine = this.engine
    const data = this.data
    if (message === undefined || engine === undefined || data === undefined) return
    if (message.unit !== this.unit) return
    if (message.type === 'grains') {
      const colours = new Uint8Array(message.keys.length * 4)
      const rgb = data.families.map((family) => engine.token(`--family-${family}`))
      message.family.forEach((f, i) => {
        const [r, g, b] = rgb[f] ?? [201, 163, 94]
        colours[i * 4] = r
        colours[i * 4 + 1] = g
        colours[i * 4 + 2] = b
        colours[i * 4 + 3] = 255
      })
      engine.setGrains(message.keys, colours)
      this.grainCount = message.keys.length
      this.blocks = message.blocks
      this.wall = message.wall
      this.requestPoster()
      return
    }
    if (message.id === 'poster' && message.stamp !== this.posterStamp) return
    engine.setScene(message.id, message.positions)
    if (message.id === 'heap') this.ready.heap = true
    if (message.id === 'poster') this.ready.poster = true
    this.checkReady()
    this.render(this.proxy.p)
  }

  /** Draw the poster figure into an alpha mask at stage size, for the worker to sample grains from. */
  private requestPoster(): void {
    window.clearTimeout(this.posterTimer)
    this.posterTimer = window.setTimeout(() => {
      const engine = this.engine
      if (engine === undefined || this.grainCount === 0) return
      const { width, height } = engine.size
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(Math.round(width), 1)
      canvas.height = Math.max(Math.round(height), 1)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context === null) return
      const figure = this.element('.film-figure')
      const stage = this.element('.film-stage').getBoundingClientRect()
      const style = getComputedStyle(figure)
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      context.textBaseline = 'alphabetic'
      context.fillStyle = '#fff'
      const chars = this.split?.chars ?? [figure]
      for (const char of chars) {
        const box = char.getBoundingClientRect()
        const metrics = context.measureText(char.textContent)
        const ascent = metrics.fontBoundingBoxAscent
        const descent = metrics.fontBoundingBoxDescent
        const baseline = box.top - stage.top + (box.height - (ascent + descent)) / 2 + ascent
        context.fillText(char.textContent, box.left - stage.left, baseline)
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      const alpha = new Uint8Array(canvas.width * canvas.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3] ?? 0
      this.posterStamp += 1
      this.worker?.postMessage(
        {
          type: 'poster',
          unit: this.unit,
          stamp: this.posterStamp,
          alpha,
          width: canvas.width,
          height: canvas.height,
        },
        [alpha.buffer],
      )
    }, 60)
  }

  private colourAreas(): void {
    const engine = this.engine
    const data = this.data
    if (engine === undefined || data === undefined) return
    const ramp = engine.sequential
    const rgba = (values: Float32Array): Uint8Array => {
      const bins = binAll(values, colourDomain(values, 'sequential'), 'sequential')
      const out = new Uint8Array(values.length * 4)
      bins.forEach((bin, i) => {
        const [r, g, b] = ramp[bin] ?? [74, 74, 83]
        out.set([r, g, b, 255], i * 4)
      })
      return out
    }
    engine.setAreaColours(rgba(data.perResident))
    this.skylines = {
      pensioner: {
        heights: heights(data.pensionerPerAged66Plus),
        colours: rgba(data.pensionerPerAged66Plus),
      },
      'working-age': {
        heights: heights(data.workingAgePerAged16To64),
        colours: rgba(data.workingAgePerAged16To64),
      },
    }
  }

  /** Every pixel layout for the current stage size, as map coordinates for the area marks. */
  private relayout(): void {
    const engine = this.engine
    const data = this.data
    if (engine === undefined || data === undefined) return
    const { size, home } = engine
    const n = data.areas.length
    const hexStage = this.clear(size)
    const hex = hexLayout(data.areas, hexStage, this.points)
    const map = mapLayout(this.boundaries, home, size, n, this.points)
    const grid = hexGrid(data.areas)
    const vertical = size.height > size.width * 1.2
    const stage: Rect = vertical
      ? {
          x: 16 + 58,
          y: size.height * 0.24,
          width: size.width - 32 - 58,
          height: size.height * 0.58,
        }
      : {
          x: size.width * 0.08,
          y: size.height * 0.3,
          width: size.width * 0.84,
          height: size.height * 0.5,
        }
    const swarm = (values: Float32Array) =>
      swarmLayout(beeswarm(values, SWARM_RADIUS).xy, SWARM_RADIUS, stage, this.points, vertical)
    const latitude = swarm(Float32Array.from(data.areas, (area) => area.lat))
    const age = swarm(data.shareAged66Plus)
    engine.setLayout('swarm-latitude', unprojectAll(home, size, latitude.rings))
    engine.setLayout('swarm-age', unprojectAll(home, size, age.rings))
    this.layouts = {
      size,
      home,
      grid,
      hexFrame: hexFrame(grid, hexStage),
      hexLonLat: unprojectAll(home, size, hex.rings),
      hexCentres: hex.centres,
      mapCentres: map.centres,
      mapFrame: boundsRect(home, size, this.boundaries),
      swarmAxis: age.axis,
    }
    this.shapeLonLat = new Float32Array(this.boundaries.length)
    this.areaX = new Float32Array(n)
    this.mixShape()
  }

  /** The reader's shape: hexes, real land or the tween between, and each area's place across it. */
  private mixShape(): void {
    const layouts = this.layouts
    const engine = this.engine
    if (layouts === undefined || engine === undefined) return
    const t = this.shapeAnim.mix
    mixInto(this.shapeLonLat, layouts.hexLonLat, this.boundaries, t)
    this.shapeLonLat = this.shapeLonLat.slice()
    engine.setLayout('shape', this.shapeLonLat)
    const centres = new Float32Array(layouts.hexCentres.length)
    mixInto(centres, layouts.hexCentres, layouts.mapCentres, t)
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < centres.length; i += 2) {
      min = Math.min(min, centres[i] ?? 0)
      max = Math.max(max, centres[i] ?? 0)
    }
    this.areaX = Float32Array.from({ length: centres.length / 2 }, (_, i) =>
      max > min ? ((centres[i * 2] ?? 0) - min) / (max - min) : 0,
    )
  }

  private tweenShape(shape: 'hex' | 'map'): void {
    this.shapeTween?.kill()
    this.audio.cue('morph')
    this.shapeTween = gsap.to(this.shapeAnim, {
      mix: shape === 'map' ? 1 : 0,
      duration: MOTION.morph * 1.4,
      ease: EASE,
      onUpdate: () => {
        this.mixShape()
        this.render(this.proxy.p)
      },
    })
  }

  private fly(code: string): void {
    const data = this.data
    const layouts = this.layouts
    if (data === undefined || layouts === undefined) return
    const index = data.areas.findIndex((area) => area.code === code)
    if (index < 0) return
    const ring = this.boundaries.subarray(index * this.points * 2, (index + 1) * this.points * 2)
    const padding = Math.min(layouts.size.width, layouts.size.height) * 0.36
    const close = fitCamera(boundsOf(ring), layouts.size, padding)
    this.cameraFrom = layouts.home
    // A small urban seat would fill the screen; stop where its neighbours are still in view.
    const zoomed = { ...close, zoom: Math.min(close.zoom, layouts.home.zoom + 3.2) }
    // Centre the area in the stage below the landing card, so the card never covers it.
    const card = this.root.querySelector(`#${CHAPTER_ANCHOR['the-landing']} .film-panel`)
    const cardBottom =
      card instanceof HTMLElement
        ? Number.parseFloat(getComputedStyle(card).top) + card.offsetHeight
        : 0
    const { width, height } = layouts.size
    const shift = Math.max((cardBottom + height - this.margin()) / 2 - height / 2, 0)
    const [longitude, latitude] = unproject(zoomed, layouts.size, width / 2, height / 2 - shift)
    this.cameraTo = { ...zoomed, longitude, latitude }
    const landing = this.spans.find((span) => span.id === 'the-landing')
    if (landing !== undefined && this.chapter !== this.spans.indexOf(landing)) {
      this.scrollToProgress(restProgress(landing), false)
    }
    this.flightTween?.kill()
    this.flight.t = 0
    // About 1.8 s, the creative direction's landing; a new postcode retargets from here.
    this.flightTween = gsap.to(this.flight, {
      t: 1,
      duration: 1.8,
      ease: CAMERA_EASE,
      onUpdate: () => this.render(this.proxy.p),
    })
  }

  private camera(): CameraPose | undefined {
    const from = this.cameraFrom
    const to = this.cameraTo
    if (from === undefined || to === undefined || this.flight.t === 0) return undefined
    const t = this.flight.t
    return {
      longitude: from.longitude + (to.longitude - from.longitude) * t,
      latitude: from.latitude + (to.latitude - from.latitude) * t,
      zoom: from.zoom + (to.zoom - from.zoom) * t,
      pitch: 0,
      bearing: 0,
    }
  }

  private buildTimeline(): void {
    const reel = this.element('.film-reel')
    const pour = this.spans[0]
    if (pour === undefined) return
    const figure = this.element('.film-figure')
    this.split = SplitText.create(figure, { type: 'chars', charsClass: 'char' })
    const chrome = [...this.root.querySelectorAll('.film-title, .film-sub, .film-start')]
    const length = pour.end - pour.start
    const timeline = gsap.timeline({ defaults: { ease: 'none' }, paused: true })
    timeline.to(this.proxy, { p: 1, duration: 1, onUpdate: () => this.render(this.proxy.p) }, 0)
    timeline.to(chrome, { autoAlpha: 0, duration: length * 0.06 }, pour.start + length * 0.005)
    timeline.to(
      this.split.chars,
      {
        opacity: 0,
        yPercent: 18,
        duration: length * 0.1,
        stagger: { amount: length * 0.1, from: 'center' },
      },
      pour.start + length * 0.02,
    )
    this.timeline = timeline
    this.trigger = ScrollTrigger.create({
      trigger: reel,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => this.onScroll(self.progress),
    })
    this.requestPoster()
    this.root.addEventListener('click', this.onChapterLink)
    const hash = window.location.hash.slice(1)
    const linked = this.spans.find((span) => CHAPTER_ANCHOR[span.id] === hash)
    this.landingAt = this.search.frame ?? (linked === undefined ? undefined : restProgress(linked))
    this.checkReady()
    this.render(this.proxy.p)
  }

  /** A chapter link in the page lands on that chapter's rest frame, as a link from outside does. */
  private readonly onChapterLink = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null
    if (!(link instanceof HTMLAnchorElement)) return
    const span = this.spans.find((s) => `#${CHAPTER_ANCHOR[s.id]}` === link.hash)
    if (span === undefined) return
    // The URL keeps its hash: the router watches history and would scroll to the chapter's top.
    event.preventDefault()
    this.scrollToProgress(restProgress(span), true)
  }

  /**
   * The viewer's scroll scrubs the timeline, catching up over 0.35 s as
   * ScrollTrigger's own scrub does; a pinned `?frame=` follows at once. The
   * scroll a `show` caused is already drawn.
   */
  private onScroll(progress: number): void {
    const timeline = this.timeline
    if (timeline === undefined) return
    if (this.shown !== undefined && Math.abs(progress - this.shown) < 1e-3) return
    this.shown = undefined
    if (this.search.frame !== undefined) {
      timeline.progress(progress)
      return
    }
    this.scrub = gsap.to(timeline, {
      progress,
      duration: 0.35,
      ease: 'expo.out',
      overwrite: true,
    })
  }

  private scrollToProgress(progress: number, smooth: boolean): void {
    const trigger = this.trigger
    if (trigger === undefined) return
    const top = trigger.start + (trigger.end - trigger.start) * progress
    window.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' })
    if (!smooth) {
      this.scrub?.kill()
      this.shown = progress
      this.timeline?.progress(progress)
      this.proxy.p = progress
    }
  }

  private context(): StageContext | undefined {
    const layouts = this.layouts
    if (layouts === undefined) return undefined
    const landed = this.inputs.landed
    const selected =
      landed === undefined ? -1 : (this.data?.areas.findIndex((a) => a.code === landed.code) ?? -1)
    return {
      size: layouts.size,
      home: layouts.home,
      hexFrame: layouts.hexFrame,
      mapFrame: layouts.mapFrame,
      shapeMix: this.shapeAnim.mix,
      wallColumns: this.wall?.columns ?? 1,
      grainCount: this.grainCount,
      guess: this.inputs.guess,
      selected,
      skylines: this.skylines,
      areaX: this.areaX,
      camera: this.camera(),
      outline: this.shapeAnim.mix === 1 ? 1 : 0,
    }
  }

  private render(progress: number): void {
    const engine = this.engine
    const context = this.context()
    if (engine === undefined || context === undefined || this.destroyed) return
    const frame = frameAt(this.spans, progress, { skylineOrder: this.skylineOrder })
    engine.draw(drawFor(frame, context))
    this.onChapter(frame)
    this.cueSounds(progress)
    this.renderCaptions(frame)
    this.renderWall(frame, context)
    this.renderAxes(frame)
    // The poster hides the grains resting on its ink, so the key waits for it to fade.
    this.element('.film-key').style.opacity = String(
      (frame.grains?.opacity ?? 0) * (1 - frame.poster),
    )
    this.renderScale(frame)
    this.lastProgress = progress
  }

  private onChapter(frame: FilmFrame): void {
    const index = this.spans.findIndex((span) => span.id === frame.chapter)
    if (index === this.chapter) return
    this.chapter = index
    if (frame.chapter !== 'the-landing' && this.flight.t > 0) {
      this.flightTween?.kill()
      this.flightTween = gsap.to(this.flight, {
        t: 0,
        duration: 0.6,
        ease: CAMERA_EASE,
        onUpdate: () => this.render(this.proxy.p),
      })
    }
  }

  private cueSounds(progress: number): void {
    if (progress <= this.lastProgress) return
    for (const cue of CUES) {
      const span = this.spans.find((s) => s.id === cue.chapter)
      if (span === undefined) continue
      const at = span.start + (span.end - span.start) * cue.at
      if (this.lastProgress < at && progress >= at) this.audio.cue(cue.cue)
    }
  }

  private cuesFor(id: ChapterId): readonly Cue[] {
    const hit = this.cues.get(id)
    if (hit !== undefined) return hit
    const chapter = SCRIPT.chapters.find((c) => c.id === id)
    const cues =
      chapter === undefined
        ? []
        : chapterCues(orderedBeats(chapter.beats, this.skylineOrder), this.audio.beatTimings())
    this.cues.set(id, cues)
    return cues
  }

  private renderCaptions(frame: FilmFrame): void {
    const { rest } = locate(this.spans, this.proxy.p).span
    const cues = this.cuesFor(frame.chapter)
    const clock = scrollClockMs(frame.local, rest, cues, BEAT_STARTS[frame.chapter])
    const state: CaptionState | undefined = captionAt(cues, clock)
    const key = state === undefined ? '' : `${state.cue.beat}|${state.spoken}`
    if (key === this.caption) return
    this.caption = key
    drawCaption(this.element('.film-captions'), state)
  }

  /** The running total under the middle of the screen as the wall pans, and the reader's ghost. */
  private renderWall(frame: FilmFrame, context: StageContext): void {
    const overlay = this.element('.film-overlay')
    const wall = this.wall
    const onWall = frame.chapter === 'the-wall' && frame.grains !== undefined && wall !== undefined
    let ghost = overlay.querySelector<HTMLElement>('.film-ghosts')
    if (ghost === null) {
      ghost = document.createElement('div')
      ghost.className = 'film-ghosts'
      for (const group of this.facts.groups) {
        const box = document.createElement('div')
        box.className = 'film-ghost'
        const label = document.createElement('span')
        label.textContent = `Your guess: ${group.label}`
        box.appendChild(label)
        ghost.appendChild(box)
      }
      overlay.appendChild(ghost)
    }
    const boxes = [...ghost.querySelectorAll<HTMLElement>('.film-ghost')]
    if (!onWall || frame.grains === undefined) {
      for (const box of boxes) box.style.opacity = '0'
      if (this.wallShown !== '') {
        this.wallShown = ''
        this.signals.onWall(undefined)
      }
      return
    }
    const rect = wallRect(context.size, wall.columns, frame.grains.pan)
    const pitch = rect.height / wall.rows
    const centre = (context.size.width / 2 - rect.x) / pitch
    const index = Math.max(
      wall.blocks.findLastIndex((span) => span.start <= centre),
      0,
    )
    const span = wall.blocks[index]
    const block = this.blocks[index]
    if (span !== undefined && block !== undefined) {
      const inBlock = Math.min(Math.max(centre - span.start, 0) * wall.rows, block.count)
      const value = (block.start + inBlock) * this.unit
      const family = this.facts.families.find((f) => f.family === this.data?.families[block.family])
      const shown = `${family?.label ?? ''}|${Math.round(value / 1e9)}`
      if (shown !== this.wallShown) {
        this.wallShown = shown
        this.signals.onWall({ label: family?.label ?? '', block: family?.value ?? 0, total: value })
      }
    }
    const visible = phase(frame.local, 0.3, 0.36) * (this.inputs.locked ? 1 : 0)
    const [first, second] = dividers(this.inputs.guess)
    const edges = [0, first / 100, second / 100, 1]
    boxes.forEach((box, i) => {
      const a = edges[i] ?? 0
      const b = edges[i + 1] ?? 1
      box.style.opacity = String(visible)
      box.style.left = `${rect.x + a * rect.width}px`
      box.style.width = `${Math.max((b - a) * rect.width - 2, 0)}px`
      box.style.top = `${rect.y - 4}px`
      box.style.height = `${rect.height + 8}px`
    })
  }

  /** What the area marks' shade, and a skyline's height, measure: ADR 0004 names every denominator. */
  private renderScale(frame: FilmFrame): void {
    const scale = this.element('.film-scale')
    const grains = frame.grains?.opacity ?? 0
    const shown = frame.areas === undefined ? 0 : frame.areas.opacity * (1 - grains)
    scale.style.opacity = String(shown)
    const skyline = frame.skyline
    const measure =
      skyline !== undefined && skyline.elevation > 0
        ? `Height and colour: ${SKYLINE_MEASURE[skyline.mix < 0.5 ? skyline.first : skyline.second]}`
        : 'Colour: benefit spending per resident'
    const label = this.element('.film-scale__label')
    if (label.textContent !== measure) label.textContent = measure
  }

  private renderAxes(frame: FilmFrame): void {
    const overlay = this.element('.film-overlay')
    const axis = this.layouts?.swarmAxis
    let labels = overlay.querySelector<HTMLElement>('.film-axes')
    if (labels === null) {
      labels = document.createElement('div')
      labels.className = 'film-axes'
      const texts = [
        'South',
        'North',
        'Fewer residents aged 66 and over',
        'More residents aged 66 and over',
      ]
      for (const text of texts) {
        const label = document.createElement('span')
        label.className = 'film-axis'
        label.textContent = text
        labels.appendChild(label)
      }
      overlay.appendChild(labels)
    }
    const items = [...labels.querySelectorAll<HTMLElement>('.film-axis')]
    const swarm = frame.chapter === 'north-south-or-age'
    const latitude = swarm ? phase(frame.local, 0.3, 0.38) * (1 - phase(frame.local, 0.5, 0.56)) : 0
    const age = swarm ? phase(frame.local, 0.74, 0.8) : 0
    items.forEach((span, i) => {
      const startSide = i % 2 === 0
      span.style.opacity = String(i < 2 ? latitude : age)
      if (axis === undefined) return
      if (axis.vertical) {
        // Upright phones run the axis up the stage: labels sit at its foot and head, from the left edge.
        span.style.left = '1rem'
        span.style.right = 'auto'
        span.style.top = `${startSide ? axis.start + 8 : axis.end - 24}px`
      } else {
        span.style.left = startSide ? `${axis.start}px` : 'auto'
        span.style.right = startSide ? 'auto' : `${(this.layouts?.size.width ?? 0) - axis.end}px`
        span.style.top = `${axis.cross + 70}px`
      }
    })
  }
}
