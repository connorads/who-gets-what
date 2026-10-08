/** WCAG 2.2 contrast between two sRGB hex colours (`#rgb` or `#rrggbb`). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function linear(channel: number): number {
  const s = channel / 255
  return s <= 0.040_45 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)?.[1]
  if (digits === undefined) throw new Error(`Not a hex colour: ${hex}`)
  const full = digits.length === 3 ? digits.replace(/./g, '$&$&') : digits
  const channel = (i: number) => Number.parseInt(full.slice(i, i + 2), 16)
  return { r: channel(0), g: channel(2), b: channel(4) }
}
