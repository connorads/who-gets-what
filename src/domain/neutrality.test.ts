import { describe, expect, it } from 'vitest'
import { BANNED_PHRASES, STYLE_PHRASES, findBannedPhrases, findStylePhrases } from './neutrality.ts'

describe('findBannedPhrases', () => {
  it('finds every listed phrase, whatever its case', () => {
    expect(BANNED_PHRASES).toContain('net contributor')
    for (const phrase of BANNED_PHRASES) {
      expect(findBannedPhrases(`A ${phrase.toUpperCase()} here.`)).toEqual([phrase])
    }
  })

  it('matches whole words only', () => {
    expect(findBannedPhrases('Drainage, mergers and a deservingly long table.')).toEqual([])
  })

  it('matches across line breaks and curly apostrophes', () => {
    expect(findBannedPhrases('net\n  contributor and taxpayers’ money')).toEqual([
      'net contributor',
      "taxpayers' money",
    ])
  })

  it('passes neutral comparative copy', () => {
    expect(findBannedPhrases('Higher than 82% of constituencies, income tax only.')).toEqual([])
  })
})

describe('findStylePhrases', () => {
  it('finds every listed phrase, whatever its case', () => {
    expect(STYLE_PHRASES).toContain('lands')
    for (const phrase of STYLE_PHRASES) {
      expect(findStylePhrases(`A ${phrase.toUpperCase()} here.`)).toEqual([phrase])
    }
  })

  it('matches whole words only, so code-like names and longer words pass', () => {
    expect(findStylePhrases('Fine-grained, pouring-free, Highlands and Rainham.')).toEqual([])
  })

  it('passes plain copy about benefit money', () => {
    expect(
      findStylePhrases('Each dot is £1 million. Enter your postcode to find your area.'),
    ).toEqual([])
  })
})
