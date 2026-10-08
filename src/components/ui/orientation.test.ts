import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const UI = new URL('./', import.meta.url)

/**
 * Radix primitives mark orientation with `data-orientation`. The shadcn
 * registry's `data-horizontal` and `data-vertical` variants target another
 * primitive library, so they never match here and the styles they carry
 * silently vanish.
 */
describe('vendored shadcn/ui components', () => {
  const files = readdirSync(UI).filter((name) => name.endsWith('.tsx'))

  it.each(files)('%s styles orientation through data-orientation', (name) => {
    const source = readFileSync(new URL(name, UI), 'utf8')

    expect(source.match(/\bdata-(?:horizontal|vertical)\b/g) ?? []).toEqual([])
  })
})
