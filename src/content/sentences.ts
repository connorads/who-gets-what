/**
 * Templated copy (ADR 0004, rule 9): every sentence compares an area with the
 * other areas of its level and names the measure, denominator and period. No
 * template judges a value; `findBannedPhrases` runs over every output in tests.
 */
import type { GeoLevel } from '#/domain/geography.ts'
import {
  denominatorLabel,
  ValueFlag,
  type Denominator,
  type RateScale,
  type Unit,
} from '#/domain/measure.ts'
import { formatShare, ordinal } from '#/lib/format.ts'
import { LEVEL_LABEL } from './labels.ts'

export interface Standing {
  /** 1 is the highest value in Great Britain. */
  readonly rank: number
  /** Areas of the level with a ranked value. */
  readonly rankOf: number
}

/**
 * Where a rank sits among the ranked areas, as a comparison:
 * "the highest of 631 constituencies", "higher than in 93% of local authorities",
 * "lower than in 61% of constituencies". The share counts the other ranked
 * areas and rounds down, so it never overstates.
 */
export function comparison(standing: Standing, level: GeoLevel): string {
  const { rank, rankOf } = standing
  const many = LEVEL_LABEL[level].many
  if (rankOf <= 1) return `the only ranked ${LEVEL_LABEL[level].one}`
  if (rank === 1) return `the highest of ${rankOf.toLocaleString('en-GB')} ${many}`
  if (rank === rankOf) return `the lowest of ${rankOf.toLocaleString('en-GB')} ${many}`
  const others = rankOf - 1
  const below = rankOf - rank
  const above = rank - 1
  return below >= above
    ? `higher than in ${formatShare(Math.floor((100 * below) / others) / 100)} of ${many}`
    : `lower than in ${formatShare(Math.floor((100 * above) / others) / 100)} of ${many}`
}

/** "449th of 631". */
export function rankText(standing: Standing): string {
  return `${ordinal(standing.rank)} of ${standing.rankOf.toLocaleString('en-GB')}`
}

/** Why a value carries no rank, from its flags (ADR 0004, rule 8). */
export function unrankedReason(flags: number): string {
  if (flags & ValueFlag.suppressed) return 'Not ranked: the source does not publish it'
  if (flags & ValueFlag.smallPopulation) return 'Not ranked: fewer than 1,000 people in the group'
  if (flags & ValueFlag.partialCoverage) return 'Not ranked: covers only some benefits'
  return 'Not ranked'
}

/** A measure as the subject of a sentence: "spending on pensioner benefits per person aged 66 and over". */
export function measurePhrase(metricLabel: string, denominatorText: string): string {
  const subject = inSentence(metricLabel)
  if (denominatorText !== 'total') return `${subject} ${denominatorText}`
  return subject.startsWith('people ') ? `the number of ${subject}` : `total ${subject}`
}

export interface RankSentenceInput {
  readonly areaName: string
  readonly level: GeoLevel
  readonly metricLabel: string
  readonly denominatorText: string
  readonly periodText: string
  readonly standing: Standing
}

/** "In Aldershot, benefit spending per resident was lower than in 93% of constituencies in 2024-25." */
export function rankSentence(input: RankSentenceInput): string {
  const measure = measurePhrase(input.metricLabel, input.denominatorText)
  return `In ${input.areaName}, ${measure} was ${comparison(input.standing, input.level)} in ${input.periodText}.`
}

/**
 * The same spending ranked two ways: "On total spending, Aldershot is 449th
 * of 631 constituencies. Per resident, it is 592nd." Which area comes first
 * depends on the denominator, so pages show both.
 */
export function denominatorSentence(input: {
  readonly areaName: string
  readonly level: GeoLevel
  readonly total: Standing
  readonly perHead: Standing
  readonly perHeadText: string
}): string {
  const many = LEVEL_LABEL[input.level].many
  return `On total spending, ${input.areaName} is ${rankText(input.total)} ${many}. ${capitalise(input.perHeadText)}, it is ${ordinal(input.perHead.rank)}.`
}

/** "Benefit spending per resident was £117 below the level we would expect from age, deprivation and pay." */
export function modelSentence(input: {
  readonly measure: string
  readonly differenceText: string
  readonly residual: number
}): string {
  if (input.residual === 0) return `${capitalise(input.measure)} matched the expected level.`
  const direction = input.residual > 0 ? 'above' : 'below'
  return `${capitalise(input.measure)} was ${input.differenceText} ${direction} the level we would expect from age, deprivation and pay.`
}

/**
 * The benefits-to-income-tax ratio in words (rule 4): "In 2023-24, people in
 * Aldershot received £0.88 in benefits for each £1 of income tax that residents paid."
 */
export function taxRatioSentence(input: {
  readonly areaName: string
  readonly valueText: string
  readonly periodText: string
}): string {
  return `In ${input.periodText}, people in ${input.areaName} received ${input.valueText} in benefits for each £1 of income tax that residents paid.`
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Lower-case the first letter of a catalogue label for use inside a sentence. */
export function inSentence(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1)
}

export interface SentenceMetric {
  readonly id: string
  readonly label: string
  readonly unit: Unit
  readonly rateScale: RateScale
}

export interface LeaderSentence {
  readonly metric: SentenceMetric
  readonly denominator: Denominator
  readonly area: string
  readonly period: string
}

const MODELLED_SUFFIX = /, compared with the expected level$/

/**
 * Shorter subjects for the explorer headline, where a benefit and its
 * Scottish replacement share a long name that would push the sentence past
 * 25 words. The measure picker below the headline shows the full name.
 */
const HEADLINE_SUBJECT: Readonly<Record<string, string>> = {
  'spend-winter-fuel': 'spending on winter heating payments',
  'claimants-attendance-allowance': 'people on pension age disability benefits',
  'claimants-carers': 'people aged 16 to 64 on carer benefits',
}

/** The longest headline the explorer shows, in words. */
export const LEADER_SENTENCE_MAX_WORDS = 25

/** What the leader leads on, as a verb phrase. */
function leadPhrase(metric: SentenceMetric, denominator: Denominator): string {
  if (metric.unit === 'ratio') {
    return 'has the highest benefit spending for each £1 of income tax (income tax only)'
  }
  const total = denominator === 'total'
  const per = total ? '' : ` ${denominatorLabel(denominator, metric.rateScale)}`
  const subject =
    HEADLINE_SUBJECT[metric.id] ?? inSentence(metric.label.replace(MODELLED_SUFFIX, ''))
  if (metric.id.endsWith('-vs-model'))
    return `is furthest above the expected level of ${subject}${per}`
  if (metric.unit === 'people') {
    // "people aged 16 to 64 on Universal Credit per 1,000 people aged 16 to 64" names the band once.
    const band = per.replace(/^ per 1,000 /, '')
    const people =
      !total && subject.startsWith(`${band} `)
        ? `people ${subject.slice(band.length + 1)}`
        : subject
    return total ? `has the highest total number of ${subject}` : `has the most ${people}${per}`
  }
  return total ? `has the highest total ${subject}` : `has the highest ${subject}${per}`
}

/** "Clacton has the highest benefit spending per resident in 2024-25." */
export function leaderSentence(input: LeaderSentence): string {
  return `${input.area} ${leadPhrase(input.metric, input.denominator)} in ${input.period}.`
}

export interface Segment {
  readonly text: string
  readonly kind: 'same' | 'removed' | 'added'
}

/**
 * Word-level difference from `before` to `after` (longest common
 * subsequence). Unchanged words keep their place; the explorer's headline
 * strikes through the removed words and types in the added ones.
 */
export function diffWords(before: string, after: string): readonly Segment[] {
  const a = before.split(/\s+/).filter(Boolean)
  const b = after.split(/\s+/).filter(Boolean)
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    const row = lcs[i] ?? []
    const below = lcs[i + 1] ?? []
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const segments: Segment[] = []
  const push = (text: string, kind: Segment['kind']) => {
    const last = segments.at(-1)
    if (last?.kind === kind) segments[segments.length - 1] = { text: `${last.text} ${text}`, kind }
    else segments.push({ text, kind })
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const wordA = a[i]
    const wordB = b[j]
    if (wordA !== undefined && wordA === wordB) {
      push(wordA, 'same')
      i += 1
      j += 1
    } else if (
      wordB === undefined ||
      (wordA !== undefined && (lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0))
    ) {
      if (wordA !== undefined) push(wordA, 'removed')
      i += 1
    } else {
      push(wordB, 'added')
      j += 1
    }
  }
  return segments
}
