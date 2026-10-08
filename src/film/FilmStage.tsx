/**
 * The film chunk's React side: it owns one FilmController for the life of
 * Watch mode and passes the reader's inputs to it. Everything that moves per
 * frame happens in the controller, outside React. The handle is the player's
 * surface, and flies the camera home for the hand-off to the explorer.
 */
import { useEffect, useImperativeHandle, useRef, type Ref, type RefObject } from 'react'
import { DARK_QUERY, THEME_EVENT } from '#/lib/preferences.ts'
import type { FilmAudio } from './audio.ts'
import { FilmController, type ControllerInputs, type StageSignals } from './controller.ts'
import type { FilmFacts } from './facts.ts'
import type { PlayerSurface } from './player.ts'
import type { SkylineId } from './script.ts'
import type { FilmSearch } from './search.ts'

export type { StageSignals, WallReading } from './controller.ts'

export interface StageHandle extends PlayerSurface {
  readonly home: () => Promise<void>
}

export interface FilmStageProps extends ControllerInputs {
  readonly handle: Ref<StageHandle>
  readonly root: RefObject<HTMLElement | null>
  readonly search: FilmSearch
  readonly facts: FilmFacts
  readonly signals: StageSignals
  readonly audio: FilmAudio
  readonly skylineOrder: readonly [SkylineId, SkylineId]
}

export default function FilmStage(props: FilmStageProps) {
  const controller = useRef<FilmController | null>(null)
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })
  const { handle, root, search, facts, signals, audio, skylineOrder } = props
  const { guess, locked, shape, landed } = props

  useImperativeHandle(
    handle,
    () => ({
      show: (progress) => controller.current?.show(progress),
      progress: () => controller.current?.progress() ?? 0,
      home: () => controller.current?.home() ?? Promise.resolve(),
    }),
    [],
  )

  useEffect(() => {
    const element = root.current
    if (element === null) return undefined
    const { guess: g, locked: l, shape: s, landed: d } = latest.current
    const created = new FilmController(element, {
      signals,
      search,
      facts,
      audio,
      skylineOrder,
      inputs: { guess: g, locked: l, shape: s, landed: d },
    })
    controller.current = created
    created.start().catch((error: unknown) => {
      console.error('The film did not start', error)
      signals.onFail(error)
    })
    return () => {
      created.destroy()
      controller.current = null
    }
  }, [root, search, facts, signals, audio, skylineOrder])

  useEffect(() => {
    controller.current?.update({ guess, locked, shape, landed })
  }, [guess, locked, shape, landed])

  // The film plays on the site's paper, so a theme change recolours the canvas.
  useEffect(() => {
    const refresh = () => controller.current?.refreshTheme()
    const media = window.matchMedia(DARK_QUERY)
    window.addEventListener(THEME_EVENT, refresh)
    media.addEventListener('change', refresh)
    return () => {
      window.removeEventListener(THEME_EVENT, refresh)
      media.removeEventListener('change', refresh)
    }
  }, [])

  return null
}
