import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RELEASE } from '#/data/source.ts'
import { hasPulledRelease } from '#/data/testing/file-source.ts'
import { parseCatalogue, type Catalogue } from '#/domain/contract.ts'
import { findBannedPhrases, findStylePhrases } from '#/domain/neutrality.ts'
import { denominatorLabel, ValueFlag } from '#/domain/measure.ts'
import { fixtureCatalogue } from '#/domain/testing/fixtures.ts'
import {
  comparison,
  denominatorSentence,
  diffWords,
  LEADER_SENTENCE_MAX_WORDS,
  leaderSentence,
  measurePhrase,
  modelSentence,
  rankSentence,
  rankText,
  taxRatioSentence,
  unrankedReason,
} from './sentences.ts'

/** The pulled release's catalogue when present; the contract fixture always. */
function catalogues(): readonly Catalogue[] {
  const all = [fixtureCatalogue()]
  if (!hasPulledRelease) return all
  const path = new URL(`../../public/data/${RELEASE}/meta/catalogue.json`, import.meta.url)
  const parsed = parseCatalogue(JSON.parse(readFileSync(path, 'utf8')))
  if (parsed.ok) all.push(parsed.value)
  return all
}

const words = (text: string) => text.split(/\s+/).length

describe('leaderSentence', () => {
  // The longest name of an area that leads any measure in the 2026-10-07.2 release.
  const area = "Queen's Park and Maida Vale"

  it('names the measure, denominator and period in 25 words or fewer for every metric', () => {
    const tooLong: string[] = []
    for (const catalogue of catalogues()) {
      for (const metric of catalogue.metrics) {
        const period = metric.periodKind === 'month' ? 'September 2026' : '2024-25'
        for (const denominator of metric.denominators) {
          const sentence = leaderSentence({ metric, denominator, area, period })
          expect(findBannedPhrases(sentence)).toEqual([])
          expect(findStylePhrases(sentence)).toEqual([])
          if (words(sentence) > LEADER_SENTENCE_MAX_WORDS) tooLong.push(sentence)
          // A ratio has no denominator band; every other sentence names one.
          const named =
            metric.unit === 'ratio'
              ? 'for each £1 of income tax'
              : denominator === 'total'
                ? 'total'
                : denominatorLabel(denominator, metric.rateScale)
          expect(sentence).toContain(named)
          expect(sentence).toMatch(new RegExp(`^${area} (?:has|is) .* in ${period}\\.$`))
        }
      }
    }
    expect(tooLong).toEqual([])
  })

  it('names the age band once for a rate in the same band', () => {
    const sentence = leaderSentence({
      metric: {
        id: 'claimants-universal-credit',
        label: 'People aged 16 to 64 on Universal Credit',
        unit: 'people',
        rateScale: 1000,
      },
      denominator: 'per-aged-16-64',
      area: 'Birmingham Ladywood',
      period: 'May 2026',
    })

    expect(sentence).toBe(
      'Birmingham Ladywood has the most people on Universal Credit per 1,000 people aged 16 to 64 in May 2026.',
    )
  })

  it('labels the income tax comparison as income tax only', () => {
    const sentence = leaderSentence({
      metric: { id: 'spend-to-income-tax', label: 'x', unit: 'ratio', rateScale: 1 },
      denominator: 'total',
      area: 'Example',
      period: '2023-24',
    })

    expect(sentence).toBe(
      'Example has the highest benefit spending for each £1 of income tax (income tax only) in 2023-24.',
    )
  })
})

describe('diffWords', () => {
  it('diffs words so that unchanged words keep their place', () => {
    const before = 'Clacton has the highest spending per resident of the 632'
    const after = 'Liverpool Walton has the highest spending per person aged 16 to 64 of the 632'

    expect(diffWords(before, after)).toEqual([
      { text: 'Clacton', kind: 'removed' },
      { text: 'Liverpool Walton', kind: 'added' },
      { text: 'has the highest spending per', kind: 'same' },
      { text: 'resident', kind: 'removed' },
      { text: 'person aged 16 to 64', kind: 'added' },
      { text: 'of the 632', kind: 'same' },
    ])
    const rebuilt = (kind: 'removed' | 'added') =>
      diffWords(before, after)
        .filter((s) => s.kind !== kind)
        .map((s) => s.text)
        .join(' ')
    expect(rebuilt('added')).toBe(before)
    expect(rebuilt('removed')).toBe(after)
  })
})

describe('comparison', () => {
  it('names the top and bottom of the ranking', () => {
    expect(comparison({ rank: 1, rankOf: 631 }, 'constituency')).toBe(
      'the highest of 631 constituencies',
    )
    expect(comparison({ rank: 348, rankOf: 348 }, 'local-authority')).toBe(
      'the lowest of 348 local authorities',
    )
  })

  it('counts the other ranked areas and rounds the share down', () => {
    expect(comparison({ rank: 2, rankOf: 631 }, 'constituency')).toBe(
      'higher than in 99% of constituencies',
    )
    expect(comparison({ rank: 592, rankOf: 631 }, 'constituency')).toBe(
      'lower than in 93% of constituencies',
    )
    expect(comparison({ rank: 316, rankOf: 631 }, 'constituency')).toBe(
      'higher than in 50% of constituencies',
    )
  })

  it('handles a ranking of one', () => {
    expect(comparison({ rank: 1, rankOf: 1 }, 'constituency')).toBe('the only ranked constituency')
  })
})

describe('templated sentences', () => {
  const sentences = [
    rankSentence({
      areaName: 'Aldershot',
      level: 'constituency',
      metricLabel: 'Spending on pensioner benefits',
      denominatorText: 'per person aged 66 and over',
      periodText: '2024-25',
      standing: { rank: 588, rankOf: 631 },
    }),
    denominatorSentence({
      areaName: 'Aldershot',
      level: 'constituency',
      total: { rank: 449, rankOf: 631 },
      perHead: { rank: 592, rankOf: 631 },
      perHeadText: 'per resident',
    }),
    modelSentence({ measure: 'spending per resident', differenceText: '£117', residual: -117 }),
    modelSentence({ measure: 'spending per resident', differenceText: '£40', residual: 40 }),
    taxRatioSentence({ areaName: 'Aldershot', valueText: '£0.88', periodText: '2023-24' }),
  ]

  it('compare and name the denominator and period', () => {
    expect(sentences).toEqual([
      'In Aldershot, spending on pensioner benefits per person aged 66 and over was lower than in 93% of constituencies in 2024-25.',
      'On total spending, Aldershot is 449th of 631 constituencies. Per resident, it is 592nd.',
      'Spending per resident was £117 below the level we would expect from age, deprivation and pay.',
      'Spending per resident was £40 above the level we would expect from age, deprivation and pay.',
      'In 2023-24, people in Aldershot received £0.88 in benefits for each £1 of income tax that residents paid.',
    ])
  })

  it('use no banned words', () => {
    expect(findBannedPhrases(sentences.join(' '))).toEqual([])
  })

  it('count people for caseload totals', () => {
    expect(measurePhrase('People receiving Pension Credit', 'total')).toBe(
      'the number of people receiving Pension Credit',
    )
    expect(measurePhrase('Spending on State Pension', 'total')).toBe(
      'total spending on State Pension',
    )
  })
})

describe('rank text', () => {
  it('uses ordinals with the count', () => {
    expect(rankText({ rank: 1, rankOf: 631 })).toBe('1st of 631')
    expect(rankText({ rank: 112, rankOf: 1_000 })).toBe('112th of 1,000')
    expect(rankText({ rank: 23, rankOf: 348 })).toBe('23rd of 348')
  })

  it('states why a value is unranked', () => {
    expect(unrankedReason(ValueFlag.smallPopulation)).toBe(
      'Not ranked: fewer than 1,000 people in the group',
    )
    expect(unrankedReason(ValueFlag.partialCoverage | ValueFlag.harmonised)).toBe(
      'Not ranked: covers only some benefits',
    )
  })
})
