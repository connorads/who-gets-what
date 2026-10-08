/**
 * The film's script: chapters, their narrated beats and the figures each beat
 * states. `script.json` is the one source for captions, the transcript and
 * the narration the audio build records, so every reader gets the same words.
 * A beat's `checks` name the release figures its words quote; a test
 * recomputes each one from the pinned release.
 */
import { z } from 'zod/mini'
import { BenefitFamily } from '#/domain/benefit.ts'
import raw from './script.json' with { type: 'json' }

const Slug = z.string().check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
const Text = z.string().check(z.minLength(1))

export const GroupId = z.enum(['pensioners', 'disability-carers', 'working-age-housing'])
export type GroupId = z.infer<typeof GroupId>

export const SkylineId = z.enum(['pensioner', 'working-age'])
export type SkylineId = z.infer<typeof SkylineId>

const Check = z.strictObject({ figure: Text, value: z.number() })
export type Check = z.infer<typeof Check>

const Beat = z.strictObject({
  id: Slug,
  /** What the narrator reads. Bracketed audio tags are direction, not words. */
  narration: Text,
  /** For the paired skylines: the beat that introduces one skyline, played in the session's order. */
  skyline: z.optional(SkylineId),
  checks: z.optional(z.array(Check)),
})
export type Beat = z.infer<typeof Beat>

export const ChapterId = z.enum([
  'the-pour',
  'your-split',
  'the-wall',
  'the-rain',
  'two-skylines',
  'north-south-or-age',
  'the-landing',
])
export type ChapterId = z.infer<typeof ChapterId>

/**
 * Each chapter's anchor in the page address, in the words of its title.
 * Chapter ids key the script and its recordings, so they stay as they are.
 */
export const CHAPTER_ANCHOR = {
  'the-pour': 'one-year',
  'your-split': 'your-guess',
  'the-wall': 'benefit-by-benefit',
  'the-rain': 'every-constituency',
  'two-skylines': 'spending-per-person',
  'north-south-or-age': 'north-south-or-age',
  'the-landing': 'your-area',
} as const satisfies Record<ChapterId, string>

const Chapter = z.strictObject({
  id: ChapterId,
  title: Text,
  /** Scroll length in viewport heights, rest frame included. */
  scroll: z.number().check(z.positive()),
  /** Alt text for the chapter's still. */
  still: Text,
  sfx: z.array(Slug),
  beats: z.array(Beat).check(z.minLength(1)),
})
export type Chapter = z.infer<typeof Chapter>

const Script = z.strictObject({
  title: Text,
  /** The data release the narrated figures were checked against. */
  release: Text,
  period: Text,
  priceBase: Text,
  groups: z.array(z.strictObject({ id: GroupId, label: Text, families: z.array(BenefitFamily) })),
  chapters: z.array(Chapter),
})
export type Script = z.infer<typeof Script>

/** Parse a script and check the rules a schema cannot state: chapter order, unique beats, whole groups. */
export function parseScript(input: unknown): Script {
  const script = Script.parse(input)
  const problems: string[] = []
  const ids = script.chapters.map((chapter) => chapter.id)
  if (ids.join() !== ChapterId.options.join()) {
    problems.push(`chapters: expected ${ChapterId.options.join(', ')}`)
  }
  const beats = script.chapters.flatMap((chapter) => chapter.beats.map((beat) => beat.id))
  if (new Set(beats).size !== beats.length) problems.push('beats: ids must be unique')
  const families = script.groups.flatMap((group) => group.families)
  if (
    new Set(families).size !== families.length ||
    families.length !== BenefitFamily.options.length
  ) {
    problems.push('groups: every benefit family belongs to exactly one group')
  }
  if (problems.length > 0) throw new Error(`script.json: ${problems.join('; ')}`)
  return script
}

export const SCRIPT: Script = parseScript(raw)

const TAG = /\[[^\]]*\]/g

/** The words a listener hears: audio tags removed, whitespace collapsed. */
export function spoken(narration: string): string {
  return narration.replace(TAG, ' ').replace(/\s+/g, ' ').trim()
}

export function chapterOf(script: Script, id: ChapterId): Chapter {
  const chapter = script.chapters.find((c) => c.id === id)
  if (chapter === undefined) throw new Error(`No chapter ${id}`)
  return chapter
}
