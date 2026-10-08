/**
 * The film's grains: one instanced quad per grain, drawn as a soft disc. Each
 * grain reads its position in two baked scenes (`fromPositions`, `toPositions`,
 * 16-bit unit coordinates) and the vertex shader maps each scene's unit frame
 * to a pixel rectangle, then mixes the two by `t`. Each grain waits for its
 * own key before it moves, and can travel on an arc, so a pour or a rain
 * reads as many grains rather than one block. GSAP owns `t` (ADR 0003).
 *
 * Grains live in screen pixels, not map coordinates: the film keeps the map
 * camera still while grains are on screen.
 */
import { Layer, project32, type DefaultProps, type UpdateParameters } from '@deck.gl/core'
import { Buffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import type { ShaderModule } from '@luma.gl/shadertools'

type Vec4 = [number, number, number, number]

interface GrainUniforms {
  fromFrame: Vec4
  toFrame: Vec4
  brass: Vec4
  guessA: Vec4
  guessB: Vec4
  guessC: Vec4
  viewport: [number, number]
  guess: [number, number]
  t: number
  stagger: number
  arc: number
  fall: number
  radius: number
  guessTint: number
  familyTint: number
  fade: number
}

const uniformBlock = /* glsl */ `\
layout(std140) uniform grainUniforms {
  vec4 fromFrame;
  vec4 toFrame;
  vec4 brass;
  vec4 guessA;
  vec4 guessB;
  vec4 guessC;
  vec2 viewport;
  vec2 guess;
  float t;
  float stagger;
  float arc;
  float fall;
  float radius;
  float guessTint;
  float familyTint;
  float fade;
} grain;
`

const grainUniforms = {
  name: 'grain',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    fromFrame: 'vec4<f32>',
    toFrame: 'vec4<f32>',
    brass: 'vec4<f32>',
    guessA: 'vec4<f32>',
    guessB: 'vec4<f32>',
    guessC: 'vec4<f32>',
    viewport: 'vec2<f32>',
    guess: 'vec2<f32>',
    t: 'f32',
    stagger: 'f32',
    arc: 'f32',
    fall: 'f32',
    radius: 'f32',
    guessTint: 'f32',
    familyTint: 'f32',
    fade: 'f32',
  },
} as const satisfies ShaderModule<GrainUniforms>

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME grain-layer-vertex-shader

in vec2 corners;
in vec2 fromPositions;
in vec2 toPositions;
in float keys;
in vec4 colours;

out vec4 vColour;
out vec2 vCorner;

void main(void) {
  float delay = keys * grain.stagger;
  float local = clamp((grain.t - delay) / max(1.0 - grain.stagger, 1e-4), 0.0, 1.0);
  float eased = grain.fall > 0.5 ? local * local : local * local * (3.0 - 2.0 * local);
  vec2 a = grain.fromFrame.xy + fromPositions * grain.fromFrame.zw;
  vec2 b = grain.toFrame.xy + toPositions * grain.toFrame.zw;
  vec2 p = mix(a, b, eased);
  p.y -= grain.arc * 4.0 * eased * (1.0 - eased);
  vec2 pixel = p + corners * grain.radius;
  gl_Position = vec4(
    pixel.x / grain.viewport.x * 2.0 - 1.0,
    1.0 - pixel.y / grain.viewport.y * 2.0,
    0.0,
    1.0
  );

  // Brass, then the reader's guess layers (by key), then each grain's own family colour.
  vec4 guessColour = keys < grain.guess.x ? grain.guessA : (keys < grain.guess.y ? grain.guessB : grain.guessC);
  vec3 colour = mix(grain.brass.rgb, guessColour.rgb, grain.guessTint);
  colour = mix(colour, colours.rgb, grain.familyTint);
  // A small spread of brightness by key, so a heap reads as many grains.
  colour *= 0.86 + 0.28 * fract(keys * 97.31);
  vColour = vec4(colour, grain.fade * layer.opacity);
  vCorner = corners;
}
`

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME grain-layer-fragment-shader

precision highp float;

in vec4 vColour;
in vec2 vCorner;

out vec4 fragColor;

void main(void) {
  float d = length(vCorner);
  float edge = fwidth(d);
  float alpha = 1.0 - smoothstep(1.0 - edge, 1.0, d);
  if (alpha <= 0.0) discard;
  fragColor = vec4(vColour.rgb, vColour.a * alpha);
}
`

/** A rectangle in CSS pixels: [x, y, width, height]. */
export type PixelFrame = readonly [number, number, number, number]

export interface GrainLayerProps {
  /** Packed 16-bit [x, y] per grain in the source scene's unit frame. */
  readonly fromPositions: Uint16Array
  readonly toPositions: Uint16Array
  /** Per grain 0 to 65535: start delay and guess layer. */
  readonly keys: Uint16Array
  /** Per grain RGBA bytes: its benefit family's colour. */
  readonly colours: Uint8Array
  readonly fromFrame: PixelFrame
  readonly toFrame: PixelFrame
  readonly viewport: readonly [number, number]
  readonly t: number
  readonly stagger: number
  /** Peak arc height in pixels. */
  readonly arc: number
  readonly fall: boolean
  /** Grain radius in CSS pixels. */
  readonly radius: number
  /** Guess layer boundaries as key fractions, 0 to 1. */
  readonly guess: readonly [number, number]
  readonly guessColours: readonly [Rgb, Rgb, Rgb]
  readonly brass: Rgb
  readonly guessTint: number
  readonly familyTint: number
  readonly fade: number
  /** Scene buffers to keep on the GPU between moves; any other uploaded buffer is freed. */
  readonly resident: readonly Uint16Array[]
}

type Rgb = readonly [number, number, number]

const defaultProps: DefaultProps<GrainLayerProps> = {
  fromPositions: { type: 'object', value: new Uint16Array(0), compare: true },
  toPositions: { type: 'object', value: new Uint16Array(0), compare: true },
  keys: { type: 'object', value: new Uint16Array(0), compare: true },
  colours: { type: 'object', value: new Uint8Array(0), compare: true },
  fromFrame: { type: 'array', value: [0, 0, 1, 1] },
  toFrame: { type: 'array', value: [0, 0, 1, 1] },
  viewport: { type: 'array', value: [1, 1] },
  t: 0,
  stagger: 0,
  arc: 0,
  fall: false,
  radius: 1,
  guess: { type: 'array', value: [1 / 3, 2 / 3] },
  guessColours: {
    type: 'array',
    value: [
      [201, 163, 94],
      [206, 124, 86],
      [66, 135, 135],
    ],
  },
  brass: { type: 'array', value: [201, 163, 94] },
  guessTint: 0,
  familyTint: 0,
  fade: 1,
  resident: { type: 'array', value: [], compare: false },
}

type BufferName = 'fromPositions' | 'toPositions' | 'keys' | 'colours'
const BUFFER_NAMES: readonly BufferName[] = ['fromPositions', 'toPositions', 'keys', 'colours']

interface Gpu {
  readonly model: Model
  readonly corners: Buffer
  /** Uploaded once per typed array: a scene buffer swaps in by reference, not by copy. */
  readonly uploaded: Map<ArrayBufferView, Buffer>
}

const gpuByState = new WeakMap<object, Gpu>()

const unit = ([r, g, b]: Rgb): Vec4 => [r / 255, g / 255, b / 255, 1]
const frame = ([x, y, w, h]: PixelFrame): Vec4 => [x, y, w, h]

export class GrainLayer extends Layer<GrainLayerProps> {
  static override layerName = 'GrainLayer'
  static override defaultProps = defaultProps

  override getShaders(): { vs: string; fs: string; modules: ShaderModule[] } {
    // oxlint-disable-next-line typescript/no-unsafe-return -- deck.gl 9 types Layer.getShaders as any
    return super.getShaders({ vs, fs, modules: [project32, grainUniforms] })
  }

  /** deck.gl sets each model's instance count from this before it draws. */
  override getNumInstances(): number {
    return this.props.keys.length
  }

  override initializeState() {
    const device = this.context.device
    const corners = device.createBuffer({ data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) })
    const model = new Model(device, {
      ...this.getShaders(),
      id: this.props.id,
      topology: 'triangle-strip',
      vertexCount: 4,
      instanceCount: 0,
      bufferLayout: [
        { name: 'corners', format: 'float32x2', stepMode: 'vertex' },
        { name: 'fromPositions', format: 'unorm16x2', stepMode: 'instance' },
        { name: 'toPositions', format: 'unorm16x2', stepMode: 'instance' },
        { name: 'keys', format: 'unorm16', stepMode: 'instance' },
        { name: 'colours', format: 'unorm8x4', stepMode: 'instance' },
      ],
      attributes: { corners },
    })
    gpuByState.set(this.state, { model, corners, uploaded: new Map() })
    this.setState({ model })
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params)
    const gpu = gpuByState.get(this.state)
    if (gpu === undefined) return
    const { props, oldProps } = params
    const changed: Record<string, Buffer> = {}
    for (const name of BUFFER_NAMES) {
      const data = props[name]
      if (data === oldProps[name] && gpu.uploaded.has(data)) continue
      let buffer = gpu.uploaded.get(data)
      if (buffer === undefined) {
        buffer = this.context.device.createBuffer({ data })
        gpu.uploaded.set(data, buffer)
      }
      changed[name] = buffer
    }
    if (Object.keys(changed).length > 0) gpu.model.setAttributes(changed)
    gpu.model.setInstanceCount(props.keys.length)
    const keep = new Set<ArrayBufferView>([...props.resident, ...BUFFER_NAMES.map((n) => props[n])])
    for (const [data, buffer] of gpu.uploaded) {
      if (keep.has(data)) continue
      buffer.destroy()
      gpu.uploaded.delete(data)
    }
  }

  override draw() {
    const gpu = gpuByState.get(this.state)
    if (gpu === undefined || this.props.keys.length === 0 || this.props.fade <= 0) return
    const { props } = this
    gpu.model.shaderInputs.setProps({
      grain: {
        fromFrame: frame(props.fromFrame),
        toFrame: frame(props.toFrame),
        brass: unit(props.brass),
        guessA: unit(props.guessColours[0]),
        guessB: unit(props.guessColours[1]),
        guessC: unit(props.guessColours[2]),
        viewport: [props.viewport[0], props.viewport[1]],
        guess: [props.guess[0], props.guess[1]],
        t: props.t,
        stagger: props.stagger,
        arc: props.arc,
        fall: props.fall ? 1 : 0,
        radius: props.radius,
        guessTint: props.guessTint,
        familyTint: props.familyTint,
        fade: props.fade,
      } satisfies GrainUniforms,
    })
    gpu.model.draw(this.context.renderPass)
  }

  override finalizeState() {
    const gpu = gpuByState.get(this.state)
    if (gpu === undefined) return
    for (const buffer of gpu.uploaded.values()) buffer.destroy()
    gpu.corners.destroy()
    gpu.model.destroy()
    gpuByState.delete(this.state)
  }
}
