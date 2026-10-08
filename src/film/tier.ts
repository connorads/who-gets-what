/**
 * How much each grain is worth on this device. A capable desktop GPU draws
 * one grain per £1 million (about 300,000 grains); anything else, or anything
 * the browser will not name, draws one per £10 million (about 30,000). Phones
 * stay on the lighter tier: iOS can drop a WebGL context under memory
 * pressure, and the film would fall back to its poster.
 */

export type Tier = 'light' | 'full'

export const GRAIN_UNIT: Readonly<Record<Tier, number>> = { light: 10_000_000, full: 1_000_000 }

export interface DeviceHints {
  /** `UNMASKED_RENDERER_WEBGL`, or '' when the browser hides it. */
  readonly renderer: string
  readonly maxTextureSize: number
  readonly coarsePointer: boolean
  /** `navigator.deviceMemory` in GiB, where the browser reports it. */
  readonly deviceMemory?: number
  readonly cores?: number
  readonly saveData?: boolean
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i
const CAPABLE =
  /apple m\d|apple gpu|nvidia|geforce|quadro|rtx|radeon|amd|iris xe|intel\(r\) arc|intel arc/i

export function classify(hints: DeviceHints): Tier {
  if (hints.coarsePointer || hints.saveData === true) return 'light'
  if (SOFTWARE.test(hints.renderer) || !CAPABLE.test(hints.renderer)) return 'light'
  if (hints.maxTextureSize < 16_384) return 'light'
  if (hints.deviceMemory !== undefined && hints.deviceMemory < 8) return 'light'
  if (hints.cores !== undefined && hints.cores < 8) return 'light'
  return 'full'
}

/** `?grain=1m` or `?grain=10m` overrides the detected tier, for testing both. */
export function tierOverride(param: string | undefined): Tier | undefined {
  if (param === '1m') return 'full'
  if (param === '10m') return 'light'
  return undefined
}

/** Read the hints from a WebGL2 context the caller already holds. */
export function readHints(gl: WebGL2RenderingContext): DeviceHints {
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer: unknown = info === null ? '' : gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
  const size: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE)
  const memory: unknown = Reflect.get(navigator, 'deviceMemory')
  const connection: unknown = Reflect.get(navigator, 'connection')
  const saveData: unknown =
    typeof connection === 'object' && connection !== null
      ? Reflect.get(connection, 'saveData')
      : undefined
  return {
    renderer: typeof renderer === 'string' ? renderer : '',
    maxTextureSize: typeof size === 'number' ? size : 0,
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    ...(typeof memory === 'number' ? { deviceMemory: memory } : {}),
    cores: navigator.hardwareConcurrency,
    ...(typeof saveData === 'boolean' ? { saveData } : {}),
  }
}
