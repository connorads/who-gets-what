/**
 * The player's surface in Read mode, for reduced motion and browsers without
 * WebGL2: the film plays as stepped stills with the voice. Each chapter cuts
 * to its still and words as its narration starts, with no scrolling motion,
 * and the caption follows the words.
 */
import { drawCaption, type CaptionState } from './captions.ts'
import type { PlayerSurface } from './player.ts'
import { CHAPTER_ANCHOR } from './script.ts'
import { locate, type Span } from './timeline.ts'

export function stillsSurface(
  root: HTMLElement,
  all: readonly Span[],
  caption: (ms: number) => CaptionState | undefined,
): PlayerSurface {
  let shown = -1
  let line = ''
  const sections = (): (HTMLElement | null)[] =>
    all.map((span) => root.querySelector<HTMLElement>(`#${CHAPTER_ANCHOR[span.id]}`))
  return {
    show(progress, ms) {
      const { index } = locate(all, progress)
      if (index !== shown) {
        shown = index
        sections().forEach((section, i) => {
          if (section === null) return
          if (i === index) {
            section.dataset['current'] = 'true'
            section.scrollIntoView({ block: 'start', behavior: 'instant' })
          } else {
            delete section.dataset['current']
          }
        })
      }
      const host = root.querySelector<HTMLElement>('.film-player__caption')
      const state = caption(ms)
      const key = state === undefined ? '' : `${state.cue.beat}|${state.spoken}`
      if (host === null || key === line) return
      line = key
      drawCaption(host, state)
    },
    progress() {
      // The chapter whose top has passed the upper part of the screen.
      const mark = window.innerHeight * 0.4
      const index = sections().findLastIndex(
        (section) => section !== null && section.getBoundingClientRect().top <= mark,
      )
      return all[Math.max(index, 0)]?.start ?? 0
    },
  }
}
