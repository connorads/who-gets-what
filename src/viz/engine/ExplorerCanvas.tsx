/**
 * The lazily loaded engine island. It reads the level's morph rings and map
 * shapes, owns one ExplorerEngine for the life of the level, and hands it
 * each new scene. The route keeps rendering its SVG and tables, so nothing
 * depends on this chunk arriving.
 */
import { useEffect, useRef, useState } from 'react'
import { parseBundle } from '#/domain/bundle.ts'
import { dataPath, type AreaOrderHash } from '#/domain/contract.ts'
import type { GeoLevel } from '#/domain/geography.ts'
import { DARK_QUERY, THEME_EVENT } from '#/lib/preferences.ts'
import { dataSource, RELEASE, required } from '#/data/source.ts'
import type { ExploreMap } from '#/explore/load.ts'
import type { ChangeKind } from '../motion.ts'
import { ExplorerEngine, type EngineLayout, type EngineScene, type SkylineInput } from './engine.ts'
import { mapShapes } from './shapes.ts'

export interface ExplorerCanvasProps {
  readonly level: GeoLevel
  readonly areaOrderHash: AreaOrderHash
  readonly map: ExploreMap
  readonly scene: EngineScene
  /** The measure the scene shows, without its denominator: a denominator change within it is Four rulers. */
  readonly measureKey: string
  readonly denominator: string
  readonly reduced: boolean
  /** The skyline's columns, or undefined for flat. */
  readonly skyline: SkylineInput | undefined
  readonly onHover: (area: number, x: number, y: number) => void
  readonly onSelect: (area: number) => void
  readonly onLayout: (layout: EngineLayout) => void
  readonly onReady: () => void
  readonly onError: (error: unknown) => void
}

export default function ExplorerCanvas(props: ExplorerCanvasProps) {
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<ExplorerEngine | null>(null)
  const callbacks = useRef(props)
  useEffect(() => {
    callbacks.current = props
  })
  const [ready, setReady] = useState(false)
  const applied = useRef<{ measureKey: string; denominator: string } | null>(null)
  const { level, areaOrderHash } = props

  useEffect(() => {
    const element = host.current
    if (element === null) return undefined
    let cancelled = false
    const ringsPath = dataPath.rings(RELEASE, level)
    const shapesPath = dataPath.shapes(RELEASE, level)
    Promise.all([required(dataSource().bytes(ringsPath)), required(dataSource().bytes(shapesPath))])
      .then(([ringBytes, shapeBytes]) => {
        if (cancelled) return
        const rings = parseBundle(ringBytes, areaOrderHash)
        if (!rings.ok || rings.value.kind !== 'rings')
          throw new Error(`${ringsPath}: not a rings bundle`)
        const shapes = parseBundle(shapeBytes, areaOrderHash)
        if (!shapes.ok || shapes.value.kind !== 'shapes')
          throw new Error(`${shapesPath}: not a shapes bundle`)
        const { header, lonLat } = rings.value
        const { map } = callbacks.current
        engine.current = new ExplorerEngine(element, {
          boundaries: lonLat,
          areaCount: header.areaCount,
          points: header.pointsPerRing,
          shapes: mapShapes(shapes.value),
          bounds: map.bounds,
          inset: map.inset,
          onHover: (area, x, y) => callbacks.current.onHover(area, x, y),
          onSelect: (area) => callbacks.current.onSelect(area),
          onLayout: (layout) => callbacks.current.onLayout(layout),
          onReady: () => {
            setReady(true)
            callbacks.current.onReady()
          },
        })
        const { scene, measureKey, denominator, reduced } = callbacks.current
        applied.current = { measureKey, denominator }
        engine.current.update(scene, 'values', reduced)
      })
      .catch((error: unknown) => callbacks.current.onError(error))
    return () => {
      cancelled = true
      engine.current?.destroy()
      engine.current = null
      setReady(false)
    }
  }, [level, areaOrderHash])

  const { scene, measureKey, denominator, reduced, skyline } = props
  useEffect(() => {
    const current = engine.current
    if (current === null) return
    const before = applied.current
    applied.current = { measureKey, denominator }
    const kind: ChangeKind =
      before?.measureKey === measureKey && before.denominator !== denominator ? 'rulers' : 'values'
    current.update(scene, kind, reduced)
  }, [scene, measureKey, denominator, reduced])

  useEffect(() => {
    if (ready) engine.current?.setSkyline(skyline)
  }, [skyline, ready])

  useEffect(() => {
    const refresh = () => engine.current?.refreshTheme()
    const media = window.matchMedia(DARK_QUERY)
    window.addEventListener(THEME_EVENT, refresh)
    media.addEventListener('change', refresh)
    return () => {
      window.removeEventListener(THEME_EVENT, refresh)
      media.removeEventListener('change', refresh)
    }
  }, [])

  return (
    <div
      ref={host}
      className="explore-canvas absolute inset-0"
      data-ready={ready ? 'true' : 'false'}
      aria-hidden="true"
    />
  )
}
