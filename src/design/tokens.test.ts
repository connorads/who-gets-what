import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BenefitFamily } from '#/domain/benefit.ts'
import { contrastRatio } from './contrast.ts'
import { SURFACE_TOKENS, TEXT_TOKENS, UI_TOKENS, readColourTokens } from './tokens.ts'

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
const tokens = readColourTokens(css)

function token(name: string) {
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`Missing token --${name}`)
  return value
}

describe('colour tokens', () => {
  it('keeps the brand constants from the creative direction', () => {
    expect(token('brass')).toEqual({ light: '#c9a35e', dark: '#c9a35e' })
    expect(token('pewter')).toEqual({ light: '#9c9aae', dark: '#9c9aae' })
    expect(token('paper').light).toBe('#fbf5ec')
    expect(token('ink').light).toBe('#2b211c')
    expect(token('brand-film').light).toBe('#0d0e11')
  })

  it.each(['light', 'dark'] as const)(
    'gives every text token 4.5:1 on every surface in %s',
    (theme) => {
      for (const text of TEXT_TOKENS) {
        for (const surface of SURFACE_TOKENS) {
          const ratio = contrastRatio(token(text)[theme], token(surface)[theme])
          expect({ pair: `${text} on ${surface}`, pass: ratio >= 4.5 }).toEqual({
            pair: `${text} on ${surface}`,
            pass: true,
          })
        }
      }
    },
  )

  it.each(['light', 'dark'] as const)('gives control boundaries 3:1 on paper in %s', (theme) => {
    for (const ui of UI_TOKENS) {
      const ratio = contrastRatio(token(ui)[theme], token('paper')[theme])
      expect({ ui, pass: ratio >= 3 }).toEqual({ ui, pass: true })
    }
  })

  it('has one colour per benefit family', () => {
    const families = BenefitFamily.options.map((f) => token(`family-${f}`).light)

    expect(new Set(families).size).toBe(BenefitFamily.options.length)
  })

  it('reads light-dark pairs and single values', () => {
    const parsed = readColourTokens(':root {\n  --a: light-dark(#fff, #000);\n  --b: #123456;\n}')

    expect(parsed.get('a')).toEqual({ light: '#fff', dark: '#000' })
    expect(parsed.get('b')).toEqual({ light: '#123456', dark: '#123456' })
  })
})

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
    expect(contrastRatio('#abc', '#abc')).toBe(1)
  })

  it('rejects a value that is not hex', () => {
    expect(() => contrastRatio('red', '#fff')).toThrow('Not a hex colour')
  })
})
