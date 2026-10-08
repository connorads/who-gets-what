import { describe, expect, it } from 'vitest'
import { formatAreaSegment, nationOf, parseAreaCode, parseAreaSegment } from './geography.ts'

describe('parseAreaCode', () => {
  it('accepts codes of the requested level in each nation', () => {
    for (const code of ['E14001074', 'W07000081', 'S14000021']) {
      expect(parseAreaCode(code, 'constituency').ok).toBe(true)
    }
    for (const code of ['E06000001', 'E09000033', 'W06000015', 'S12000011']) {
      expect(parseAreaCode(code, 'local-authority').ok).toBe(true)
    }
  })

  it('rejects other levels, Northern Ireland and malformed codes', () => {
    expect(parseAreaCode('E06000001', 'constituency').ok).toBe(false)
    expect(parseAreaCode('E14001074', 'local-authority').ok).toBe(false)
    expect(parseAreaCode('N05000001', 'constituency').ok).toBe(false)
    expect(parseAreaCode('E1400107', 'constituency').ok).toBe(false)
  })
})

describe('area URL segment', () => {
  it('round-trips code and slug', () => {
    const segment = parseAreaSegment('E14001074-barnsley-north', 'constituency')

    expect(segment.ok && formatAreaSegment(segment.value)).toBe('E14001074-barnsley-north')
  })

  it('accepts a lower-case code so hand-typed links resolve', () => {
    const segment = parseAreaSegment('s14000021-east-renfrewshire', 'constituency')

    expect(segment.ok && segment.value.code).toBe('S14000021')
  })

  it('rejects a missing or malformed slug', () => {
    expect(parseAreaSegment('E14001074', 'constituency').ok).toBe(false)
    expect(parseAreaSegment('E14001074-Barnsley North', 'constituency').ok).toBe(false)
  })

  it('derives the nation from the code', () => {
    const segment = parseAreaSegment('W07000081-aberafan-maesteg', 'constituency')

    expect(segment.ok && nationOf(segment.value.code)).toBe('wales')
  })
})
