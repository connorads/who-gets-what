/**
 * What the audio build reads from the film script (src/film/script.json):
 * narrated beats in playing order and the sound cues each chapter plays.
 * Other fields belong to the film and are ignored here.
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod/mini'

export interface Beat {
  readonly id: string
  readonly chapter: string
  /** Narration as the script writes it; may carry v4 audio tags. */
  readonly text: string
  /** The skyline beats play in a random order per session, so they swap places. */
  readonly swappable: boolean
  /** Read on its own: no context either side, and none given to its neighbours. */
  readonly standalone: boolean
}

export interface FilmAudio {
  readonly beats: readonly Beat[]
  /** Every cue id the chapters play, first use first. */
  readonly cues: readonly string[]
}

const Script = z.object({
  chapters: z.array(
    z.object({
      id: z.string(),
      sfx: z.array(z.string()),
      beats: z.array(
        z.object({ id: z.string(), narration: z.string(), skyline: z.optional(z.string()) }),
      ),
    }),
  ),
})

export function readFilmAudio(path: string, standalone: ReadonlySet<string>): FilmAudio {
  const { chapters } = Script.parse(JSON.parse(readFileSync(path, 'utf8')))
  return {
    beats: chapters.flatMap((chapter) =>
      chapter.beats.map((beat) => ({
        id: beat.id,
        chapter: chapter.id,
        text: beat.narration,
        swappable: beat.skyline !== undefined,
        standalone: standalone.has(beat.id),
      })),
    ),
    cues: [...new Set(chapters.flatMap((chapter) => chapter.sfx))],
  }
}

/**
 * The beats heard either side of `index`. A swappable beat skips its
 * partner to reach the fixed beats around the pair; a fixed beat next to the
 * pair has no known neighbour on that side, since either partner may play there.
 * Standalone beats are skipped, and get no neighbours themselves.
 */
export function heardBeside(
  beats: readonly Beat[],
  index: number,
): { previous?: Beat; next?: Beat } {
  if (beats[index]?.standalone === true) return {}
  const swappable = beats[index]?.swappable === true
  const neighbour = (step: -1 | 1): Beat | undefined => {
    let at = index + step
    const skipped = (beat: Beat | undefined): boolean =>
      beat !== undefined && (beat.standalone || (swappable && beat.swappable))
    while (skipped(beats[at])) at += step
    const beat = beats[at]
    return beat?.swappable === true ? undefined : beat
  }
  const previous = neighbour(-1)
  const next = neighbour(1)
  return {
    ...(previous === undefined ? {} : { previous }),
    ...(next === undefined ? {} : { next }),
  }
}
