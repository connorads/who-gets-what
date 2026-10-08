/**
 * The Flip: the page's one headline, a templated comparison sentence. When a
 * new framing changes who leads, the replaced words are struck through and
 * stay visible, and the new words type in beside them; unchanged words keep
 * their place. CSS runs both effects, so reduced motion collapses them.
 */
import { useState, type CSSProperties } from 'react'
import { diffWords, type Segment } from '#/content/sentences.ts'

/** Each typed character waits for the ones before it. */
const charStyle = (i: number): CSSProperties & { '--i': number } => ({ '--i': i })

interface Shown {
  readonly sentence: string
  readonly segments: readonly Segment[]
}

export function FlipHeadline({ sentence }: { readonly sentence: string }) {
  const [shown, setShown] = useState<Shown>({
    sentence,
    segments: [{ text: sentence, kind: 'same' }],
  })
  if (shown.sentence !== sentence) {
    setShown({ sentence, segments: diffWords(shown.sentence, sentence) })
  }
  const changed = shown.segments.some((segment) => segment.kind !== 'same')
  // Keys name each segment by its word offset, which is stable for one diff.
  const words = shown.segments.map(({ text }) => text.split(' ').length)
  const keyed = shown.segments.map(({ text, kind }, i) => {
    const offset = words.slice(0, i).reduce((sum, n) => sum + n, 0)
    return {
      text,
      kind,
      id: `${offset}:${kind}:${shown.sentence}`,
      first: i === 0,
      chars: Array.from(text, (char, at) => ({ char, at })),
    }
  })

  return (
    <h1 className="flip-headline mt-3 font-display text-title text-balance md:text-[2.4rem] md:leading-[1.08]">
      {changed ? <span className="sr-only">{sentence}</span> : null}
      <span aria-hidden={changed ? 'true' : undefined}>
        {keyed.map((segment) => {
          const space = segment.first ? '' : ' '
          if (segment.kind === 'same')
            return <span key={segment.id}>{`${space}${segment.text}`}</span>
          if (segment.kind === 'removed') {
            return (
              <span key={segment.id}>
                {space}
                <s className="flip-out">{segment.text}</s>
              </span>
            )
          }
          return (
            <span key={segment.id}>
              {space}
              <span className="flip-in">
                {segment.chars.map(({ char, at }) => (
                  <span key={at} style={charStyle(at)}>
                    {char}
                  </span>
                ))}
              </span>
            </span>
          )
        })}
      </span>
    </h1>
  )
}
