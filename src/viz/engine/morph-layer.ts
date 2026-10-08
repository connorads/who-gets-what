/**
 * One mark per area, morphing between views on the GPU. Every area is a ring
 * of the same point count with a fixed triangulation; the vertex shader mixes
 * `positionsFrom` and `positionsTo` by `tPosition` and the colours by
 * `tColour`. GSAP owns both uniforms, so this layer never animates itself.
 *
 * Fragment styles: bit 0 draws the halftone screen for apportioned or
 * modelled values (ADR 0004 rule 6); bit 1 hatches an area with no value.
 */
import { Layer, project32, type DefaultProps, type UpdateParameters } from '@deck.gl/core'
import { Buffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import type { ShaderModule } from '@luma.gl/shadertools'

interface MorphUniforms {
  tPosition: number
  tColour: number
  selected: number
  hovered: number
  dimOthers: number
  pixelRatio: number
  paperColour: [number, number, number, number]
  hatchColour: [number, number, number, number]
}

const uniformBlock = /* glsl */ `\
layout(std140) uniform morphUniforms {
  float tPosition;
  float tColour;
  float selected;
  float hovered;
  float dimOthers;
  float pixelRatio;
  vec4 paperColour;
  vec4 hatchColour;
} morph;
`

const morphUniforms = {
  name: 'morph',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    tPosition: 'f32',
    tColour: 'f32',
    selected: 'f32',
    hovered: 'f32',
    dimOthers: 'f32',
    pixelRatio: 'f32',
    paperColour: 'vec4<f32>',
    hatchColour: 'vec4<f32>',
  },
} as const satisfies ShaderModule<MorphUniforms>

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME morph-layer-vertex-shader

in vec2 positionsFrom;
in vec2 positionsTo;
in vec4 coloursFrom;
in vec4 coloursTo;
in vec2 meta;

out vec4 vColour;
flat out float vStyle;

void main(void) {
  vec3 position = vec3(mix(positionsFrom, positionsTo, morph.tPosition), 0.0);
  geometry.worldPosition = position;
  gl_Position = project_position_to_clipspace(position, vec3(0.0), vec3(0.0), geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  vec4 colour = mix(coloursFrom, coloursTo, morph.tColour);
  float picked = max(
    float(abs(meta.x - morph.selected) < 0.5),
    float(abs(meta.x - morph.hovered) < 0.5)
  );
  float alpha = morph.dimOthers > 0.5 ? mix(0.38, 1.0, picked) : 1.0;
  vColour = vec4(colour.rgb, colour.a * alpha * layer.opacity);
  vStyle = meta.y;
  DECKGL_FILTER_COLOR(vColour, geometry);
}
`

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME morph-layer-fragment-shader

precision highp float;

in vec4 vColour;
flat in float vStyle;

out vec4 fragColor;

void main(void) {
  vec4 colour = vColour;
  float cell = 4.0 * morph.pixelRatio;
  if (mod(vStyle, 2.0) >= 1.0) {
    vec2 p = mod(gl_FragCoord.xy, cell) - 0.5 * cell;
    float dotMask = 1.0 - smoothstep(0.26 * cell - 0.6, 0.26 * cell + 0.6, length(p));
    vec3 light = mix(colour.rgb, morph.paperColour.rgb, 0.5);
    colour.rgb = mix(light, colour.rgb * 0.82, dotMask);
  }
  if (vStyle >= 2.0) {
    float stripe = mod(gl_FragCoord.x + gl_FragCoord.y, 5.0 * morph.pixelRatio);
    colour.rgb = mix(colour.rgb, morph.hatchColour.rgb, step(stripe, 1.25 * morph.pixelRatio) * 0.55);
  }
  fragColor = colour;
  geometry.uv = vec2(0.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`

export interface MorphLayerProps {
  /** Per vertex [longitude, latitude]. */
  readonly positionsFrom: Float32Array
  readonly positionsTo: Float32Array
  /** Per vertex RGBA bytes. */
  readonly coloursFrom: Uint8Array
  readonly coloursTo: Uint8Array
  /** Per vertex [area index, style bits]. */
  readonly meta: Float32Array
  /** Triangles over the vertices, fixed for the life of the area order. */
  readonly indices: Uint32Array
  readonly tPosition: number
  readonly tColour: number
  /** Area index, or -1. */
  readonly selected: number
  readonly hovered: number
  readonly dimOthers: boolean
  /** Device pixels per CSS pixel, so the halftone screen keeps its size. */
  readonly pixelRatio: number
  /** RGB bytes. */
  readonly paperColour: readonly [number, number, number]
  readonly hatchColour: readonly [number, number, number]
}

// Buffers compare by identity: the engine passes a new array only when its
// contents change, and a deep compare of 160,000 bytes would cost a frame.
const defaultProps: DefaultProps<MorphLayerProps> = {
  positionsFrom: { type: 'object', value: new Float32Array(0), compare: false },
  positionsTo: { type: 'object', value: new Float32Array(0), compare: false },
  coloursFrom: { type: 'object', value: new Uint8Array(0), compare: false },
  coloursTo: { type: 'object', value: new Uint8Array(0), compare: false },
  meta: { type: 'object', value: new Float32Array(0), compare: false },
  indices: { type: 'object', value: new Uint32Array(0), compare: false },
  tPosition: 1,
  tColour: 1,
  selected: -1,
  hovered: -1,
  dimOthers: false,
  pixelRatio: 1,
  paperColour: { type: 'array', value: [244, 240, 230] },
  hatchColour: { type: 'array', value: [91, 89, 81] },
}

type BufferName = 'positionsFrom' | 'positionsTo' | 'coloursFrom' | 'coloursTo' | 'meta'
const BUFFER_NAMES: readonly BufferName[] = [
  'positionsFrom',
  'positionsTo',
  'coloursFrom',
  'coloursTo',
  'meta',
]

interface Gpu {
  readonly model: Model
  readonly buffers: Map<BufferName | 'indices', Buffer>
}

/** GPU resources per layer state: deck.gl hands the same state object to each new layer instance. */
const gpuByState = new WeakMap<object, Gpu>()

const toUnit = ([r, g, b]: readonly [number, number, number]): [number, number, number, number] => [
  r / 255,
  g / 255,
  b / 255,
  1,
]

export class MorphLayer extends Layer<MorphLayerProps> {
  static override layerName = 'MorphLayer'
  static override defaultProps = defaultProps

  override getShaders(): { vs: string; fs: string; modules: ShaderModule[] } {
    // oxlint-disable-next-line typescript/no-unsafe-return -- deck.gl 9 types Layer.getShaders as any
    return super.getShaders({ vs, fs, modules: [project32, morphUniforms] })
  }

  override initializeState() {
    const model = new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      topology: 'triangle-list',
      bufferLayout: [
        { name: 'positionsFrom', format: 'float32x2' },
        { name: 'positionsTo', format: 'float32x2' },
        { name: 'coloursFrom', format: 'unorm8x4' },
        { name: 'coloursTo', format: 'unorm8x4' },
        { name: 'meta', format: 'float32x2' },
      ],
    })
    gpuByState.set(this.state, { model, buffers: new Map() })
    this.setState({ model })
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params)
    const gpu = gpuByState.get(this.state)
    if (gpu === undefined) return
    const { props, oldProps } = params
    const device = this.context.device
    const upload = (
      name: BufferName | 'indices',
      data: Float32Array | Uint8Array | Uint32Array,
    ) => {
      const existing = gpu.buffers.get(name)
      if (existing !== undefined && existing.byteLength === data.byteLength) {
        existing.write(data)
        return existing
      }
      existing?.destroy()
      const buffer = device.createBuffer(
        name === 'indices' ? { usage: Buffer.INDEX, indexType: 'uint32', data } : { data },
      )
      gpu.buffers.set(name, buffer)
      return buffer
    }
    const changed: Record<string, Buffer> = {}
    for (const name of BUFFER_NAMES) {
      if (props[name] !== oldProps[name] || !gpu.buffers.has(name)) {
        changed[name] = upload(name, props[name])
      }
    }
    if (Object.keys(changed).length > 0) gpu.model.setAttributes(changed)
    if (props.indices !== oldProps.indices || !gpu.buffers.has('indices')) {
      gpu.model.setIndexBuffer(upload('indices', props.indices))
    }
  }

  override draw() {
    const gpu = gpuByState.get(this.state)
    if (gpu === undefined || this.props.indices.length === 0) return
    const { props } = this
    gpu.model.shaderInputs.setProps({
      morph: {
        tPosition: props.tPosition,
        tColour: props.tColour,
        selected: props.selected,
        hovered: props.hovered,
        dimOthers: props.dimOthers ? 1 : 0,
        pixelRatio: props.pixelRatio,
        paperColour: toUnit(props.paperColour),
        hatchColour: toUnit(props.hatchColour),
      } satisfies MorphUniforms,
    })
    gpu.model.draw(this.context.renderPass)
  }

  override finalizeState() {
    const gpu = gpuByState.get(this.state)
    if (gpu !== undefined) {
      for (const buffer of gpu.buffers.values()) buffer.destroy()
      gpu.model.destroy()
      gpuByState.delete(this.state)
    }
  }
}
