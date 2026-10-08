import { describe, expect, it } from 'vitest'
import { captionWords, spokenText, type CharacterAlignment } from './alignment.ts'

function align(text: string, step = 0.1): CharacterAlignment {
  const characters = Array.from(text)
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * step),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * step),
  }
}

describe('spokenText', () => {
  it('drops audio tags and collapses the space they leave', () => {
    expect(spokenText('[measured] Each grain [pause] is £1 million.')).toBe(
      'Each grain is £1 million.',
    )
  })
})

describe('captionWords', () => {
  it('times each word from its first to its last character, skipping tags', () => {
    expect(captionWords(align('[calm] Each grain.'))).toEqual([
      { text: 'Each', startMs: 700, endMs: 1100 },
      { text: 'grain.', startMs: 1200, endMs: 1800 },
    ])
  })

  it('splits a tag that touches a word without joining the halves', () => {
    expect(captionWords(align('one[sighs]two')).map((word) => word.text)).toEqual(['one', 'two'])
  })

  it('rejects arrays of different lengths', () => {
    expect(() =>
      captionWords({
        characters: ['a'],
        character_start_times_seconds: [],
        character_end_times_seconds: [0.1],
      }),
    ).toThrow('alignment arrays differ in length')
  })
})
