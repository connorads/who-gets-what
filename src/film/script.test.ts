import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findBannedPhrases, findStylePhrases } from '#/domain/neutrality.ts'
import { hasPulledRelease, pulledSiteData } from '#/data/testing/file-source.ts'
import { parseCaptionWords, parseManifest } from './audio.ts'
import { loadFilmData } from './data.ts'
import { correlation, decimalsOf, figureValue, filmFigures, topIndices } from './figures.ts'
import { parseScript, SCRIPT, spoken } from './script.ts'
import raw from './script.json' with { type: 'json' }

const allCopy = (): readonly string[] => [
  SCRIPT.title,
  ...SCRIPT.groups.map((group) => group.label),
  ...SCRIPT.chapters.flatMap((chapter) => [
    chapter.title,
    chapter.still,
    ...chapter.beats.map((beat) => spoken(beat.narration)),
  ]),
]

describe('film script', () => {
  it('uses no banned word, no style-list word and no long dash', () => {
    for (const text of allCopy()) {
      expect({ text, banned: findBannedPhrases(text) }).toEqual({ text, banned: [] })
      expect({ text, style: findStylePhrases(text) }).toEqual({ text, style: [] })
      expect(text).not.toMatch(/[\u2013\u2014]/)
    }
  })

  it('rejects chapters out of order and a family in two groups', () => {
    const reversed = { ...raw, chapters: raw.chapters.toReversed() }
    expect(() => parseScript(reversed)).toThrow('chapters: expected')
    const [first, ...rest] = raw.groups
    const doubled = {
      ...raw,
      groups: [{ ...first, families: [...(first?.families ?? []), 'universal-credit'] }, ...rest],
    }
    expect(() => parseScript(doubled)).toThrow('every benefit family belongs to exactly one group')
  })

  it('drops audio tags from what a listener hears', () => {
    expect(spoken('[measured] Each grain  [pause] falls.')).toBe('Each grain falls.')
  })

  it('pairs each skyline with one beat', () => {
    const skylines = SCRIPT.chapters.flatMap((chapter) =>
      chapter.beats.flatMap((beat) => (beat.skyline === undefined ? [] : [beat.skyline])),
    )
    expect(skylines.toSorted()).toEqual(['pensioner', 'working-age'])
  })
})

describe('figure helpers', () => {
  it('computes Pearson correlation over finite pairs', () => {
    expect(correlation([1, 2, 3, Number.NaN], [2, 4, 6, 1])).toBeCloseTo(1)
    expect(correlation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1)
  })

  it('ranks the highest finite values first and keeps area order on ties', () => {
    expect(topIndices([3, Number.NaN, 5, 5, 1], 3)).toEqual([2, 3, 0])
  })

  it('reads the decimals a narrated number was written with', () => {
    expect([decimalsOf(299), decimalsOf(51.5), decimalsOf(0.44)]).toEqual([0, 1, 2])
  })
})

describe.runIf(hasPulledRelease)('narrated figures against the pulled release', () => {
  it('match every check in the script', async () => {
    const figures = filmFigures(await loadFilmData(pulledSiteData(), SCRIPT))
    const checks = SCRIPT.chapters.flatMap((chapter) =>
      chapter.beats.flatMap((beat) => beat.checks ?? []),
    )
    expect(checks.length).toBeGreaterThan(5)
    for (const check of checks) {
      const actual = figureValue(figures, check.figure) ?? Number.NaN
      const rounded = Number(actual.toFixed(decimalsOf(check.value)))
      expect({ figure: check.figure, value: rounded }).toEqual(check)
    }
  })

  it('adds the groups up to the total', async () => {
    const figures = filmFigures(await loadFilmData(pulledSiteData(), SCRIPT))
    const groups = [...figures.byGroup.values()].reduce((sum, value) => sum + value, 0)
    const areas = figures.byArea.reduce((sum, value) => sum + value, 0)
    expect(groups / figures.total).toBeCloseTo(1, 9)
    expect(areas / figures.total).toBeCloseTo(1, 6)
  })
})

describe('committed film audio', () => {
  const audio = new URL('../../public/audio/', import.meta.url)
  const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, audio), 'utf8'))
  const items = parseManifest(read('manifest.json'))
  const byId = new Map(items.map((item) => [item.id, item]))

  it('records every beat in the words of the script, with captions that read the same', () => {
    for (const beat of SCRIPT.chapters.flatMap((chapter) => chapter.beats)) {
      const item = byId.get(beat.id)
      expect(item?.kind).toBe('narration')
      const captions = item?.captions?.replace(/^\/audio\//, '') ?? ''
      const words = parseCaptionWords(read(captions)).map((word) => word.text)
      expect({ beat: beat.id, words: words.join(' ') }).toEqual({
        beat: beat.id,
        words: spoken(beat.narration),
      })
    }
  })

  it('has a sound for every cue a chapter names, and files where the manifest points', () => {
    for (const cue of SCRIPT.chapters.flatMap((chapter) => chapter.sfx)) {
      expect({ cue, kind: byId.get(cue)?.kind }).toEqual({ cue, kind: 'sfx' })
    }
    for (const item of items) {
      for (const file of [item.file, item.fallback]) {
        expect({ file, found: existsSync(new URL(file.replace(/^\/audio\//, ''), audio)) }).toEqual(
          { file, found: true },
        )
      }
    }
  })
})
