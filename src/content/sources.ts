import type { Catalogue, SourceId } from '#/domain/contract.ts'
import { ValueFlag } from '#/domain/measure.ts'

export interface SourceNote {
  /** Footnote number on the page, from 1 in order of first use. */
  readonly n: number
  readonly id: SourceId
  readonly publisher: string
  readonly title: string
  readonly url: string
  readonly published: string
  readonly licence: string
}

/** Numbers sources in the order a page first cites them, so footnotes read in order. */
export function createSourceNotes(catalogue: Catalogue) {
  const notes = new Map<string, SourceNote>()
  return {
    cite(ids: readonly SourceId[]): readonly number[] {
      return ids.flatMap((id) => {
        const known = notes.get(id)
        if (known !== undefined) return [known.n]
        const source = catalogue.sources.find((entry) => entry.id === id)
        if (source === undefined) return []
        const note = { ...source, n: notes.size + 1 }
        notes.set(id, note)
        return [note.n]
      })
    },
    list(): readonly SourceNote[] {
      return [...notes.values()]
    },
  }
}

export type SourceNotes = ReturnType<typeof createSourceNotes>

/** Derived values carry the halftone and a chip (ADR 0004, rule 6). */
export const DERIVED_FLAGS = ValueFlag.apportioned | ValueFlag.modelled | ValueFlag.survey

export function isDerived(flags: number): boolean {
  return (flags & DERIVED_FLAGS) !== 0
}
