/**
 * Design tokens resolved to RGB bytes for the GPU. Tokens are `light-dark()`
 * pairs, so they are read from a probe element's computed colour each time
 * the theme changes.
 */
import {
  DIVERGING_TOKENS,
  NO_VALUE,
  NO_VALUE_TOKEN,
  parseColour,
  SEQUENTIAL_TOKENS,
  type ScaleKind,
} from '../colour.ts'

export type Rgb = readonly [number, number, number]

export interface Palette {
  readonly sequential: readonly Rgb[]
  readonly diverging: readonly Rgb[]
  readonly noValue: Rgb
  readonly paper: Rgb
  readonly ink: Rgb
  readonly inkMuted: Rgb
}

const FALLBACK: Rgb = [128, 128, 128]

export function readPalette(host: HTMLElement): Palette {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  host.appendChild(probe)
  const read = (token: string): Rgb => {
    probe.style.color = `var(${token})`
    return parseColour(getComputedStyle(probe).color) ?? FALLBACK
  }
  const palette: Palette = {
    sequential: SEQUENTIAL_TOKENS.map(read),
    diverging: DIVERGING_TOKENS.map(read),
    noValue: read(NO_VALUE_TOKEN),
    paper: read('--paper'),
    ink: read('--ink'),
    inkMuted: read('--ink-muted'),
  }
  probe.remove()
  return palette
}

/** Per-area RGBA bytes for binned values. */
export function areaColours(bins: Uint8Array, kind: ScaleKind, palette: Palette): Uint8Array {
  const ramp = kind === 'sequential' ? palette.sequential : palette.diverging
  const out = new Uint8Array(bins.length * 4)
  bins.forEach((bin, i) => {
    const [r, g, b] = bin === NO_VALUE ? palette.noValue : (ramp[bin] ?? FALLBACK)
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255
  })
  return out
}
