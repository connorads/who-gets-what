/**
 * Colour tokens live once, in `src/styles.css`. This module reads them back
 * from the stylesheet source so tests and the styleguide check the values the
 * browser actually gets.
 */

export interface ThemedColour {
  readonly light: string
  readonly dark: string
}

const HEX = String.raw`#[0-9a-fA-F]{3,6}`
const DECLARATION = new RegExp(
  String.raw`--([a-z0-9-]+):\s*(?:light-dark\(\s*(${HEX})\s*,\s*(${HEX})\s*\)|(${HEX}))\s*;`,
  'g',
)

/** Every hex colour token declared in the stylesheet's first `:root` block. */
export function readColourTokens(css: string): ReadonlyMap<string, ThemedColour> {
  const start = css.indexOf(':root {')
  if (start === -1) throw new Error('No :root block in stylesheet')
  const end = css.indexOf('\n}', start)
  const block = css.slice(start, end)
  const tokens = new Map<string, ThemedColour>()
  for (const m of block.matchAll(DECLARATION)) {
    const [, name, light, dark, both] = m
    if (name === undefined) continue
    if (both !== undefined) tokens.set(name, { light: both, dark: both })
    else if (light !== undefined && dark !== undefined) tokens.set(name, { light, dark })
  }
  return tokens
}

/** Text tokens and the surfaces they sit on: each pair needs 4.5:1 in both themes. */
export const TEXT_TOKENS = ['ink', 'ink-muted', 'brass-ink', 'pewter-ink', 'alert'] as const
export const SURFACE_TOKENS = ['paper', 'surface', 'sunken'] as const

/** Non-text tokens that identify a control or focus state: 3:1 against paper. */
export const UI_TOKENS = ['rule-strong'] as const
