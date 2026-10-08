/**
 * The handful of figures the page needs before any canvas loads: the poster
 * total, the real split for the guess, and each block of the wall. Plain data,
 * so the server can send it with the page.
 */
import type { BenefitFamily } from '#/domain/benefit.ts'
import type { FilmData } from './data.ts'
import type { FilmFigures } from './figures.ts'
import type { GroupId, Script } from './script.ts'

export interface FilmFacts {
  readonly period: string
  readonly priceBase: string
  /** Real pounds at the price base. */
  readonly total: number
  readonly groups: readonly {
    readonly id: GroupId
    readonly label: string
    readonly value: number
    readonly share: number
  }[]
  /** In wall order: by group, then largest first. */
  readonly families: readonly {
    readonly family: BenefitFamily
    readonly label: string
    readonly group: GroupId
    readonly value: number
  }[]
  readonly areaCount: number
  readonly correlationLatitude: number
  readonly correlationAged66Plus: number
}

export function filmFacts(
  script: Script,
  data: FilmData,
  figures: FilmFigures,
  labels: ReadonlyMap<BenefitFamily, string>,
): FilmFacts {
  const groupOrder = script.groups.map((group) => group.id)
  const families = data.families
    .map((family, f) => ({
      family,
      label: labels.get(family) ?? family,
      group: data.familyGroup[f] ?? 'working-age-housing',
      value: figures.byFamily.get(family) ?? 0,
    }))
    .toSorted(
      (a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || b.value - a.value,
    )
  return {
    period: data.period,
    priceBase: data.priceBase,
    total: figures.total,
    groups: script.groups.map((group) => {
      const value = figures.byGroup.get(group.id) ?? 0
      return { id: group.id, label: group.label, value, share: value / figures.total }
    }),
    families,
    areaCount: figures.areaCount,
    correlationLatitude: figures.correlationLatitude,
    correlationAged66Plus: figures.correlationAged66Plus,
  }
}

/** Whole billions for a tight label: £299bn. */
export function billions(value: number): string {
  return `£${Math.round(value / 1e9).toLocaleString('en-GB')}bn`
}

/** Whole billions for a sentence, as the narration says them: £299 billion. */
export function billionsInWords(value: number): string {
  return `£${Math.round(value / 1e9).toLocaleString('en-GB')} billion`
}
