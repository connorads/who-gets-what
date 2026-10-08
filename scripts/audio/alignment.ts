/**
 * Caption timing from ElevenLabs character alignment. Narration text carries
 * bracketed v4 audio tags (`[measured]`) that the voice reads as direction,
 * not words, so captions drop them.
 */

/** The `alignment` object of a `/with-timestamps` response, in seconds. */
export interface CharacterAlignment {
  readonly characters: readonly string[]
  readonly character_start_times_seconds: readonly number[]
  readonly character_end_times_seconds: readonly number[]
}

export interface CaptionWord {
  readonly text: string
  readonly startMs: number
  readonly endMs: number
}

const TAG = /\[[^\]]*\]/g

/** The words a listener hears: tags removed, whitespace collapsed. */
export function spokenText(text: string): string {
  return text.replace(TAG, ' ').replace(/\s+/g, ' ').trim()
}

/** Group aligned characters into words, skipping tags. Times round to whole milliseconds. */
export function captionWords(alignment: CharacterAlignment): CaptionWord[] {
  const { characters, character_start_times_seconds: starts } = alignment
  const ends = alignment.character_end_times_seconds
  if (starts.length !== characters.length || ends.length !== characters.length) {
    throw new Error('alignment arrays differ in length')
  }
  const words: CaptionWord[] = []
  let text = ''
  let start = 0
  let end = 0
  let inTag = false
  const flush = (): void => {
    if (text !== '')
      words.push({ text, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) })
    text = ''
  }
  characters.forEach((char, index) => {
    if (char === '[') {
      flush()
      inTag = true
      return
    }
    if (inTag) {
      if (char === ']') inTag = false
      return
    }
    if (/\s/.test(char)) {
      flush()
      return
    }
    if (text === '') start = starts[index] ?? 0
    text += char
    end = ends[index] ?? end
  })
  flush()
  return words
}
