/**
 * The home page film. The server renders the page as Read mode: the poster (its
 * figure is the LCP element), then each chapter's still and words, which
 * work with no script and no WebGL. In the browser, Watch mode pins the stage
 * and loads the film chunk after first paint; reduced motion, `?mode=read`
 * or a browser without WebGL2 keep Read mode, with stills cross-fading in.
 * Play runs the film like a video in either mode (player.ts): the canvas
 * scrolls itself under the narration in Watch mode, and Read mode steps
 * through the stills with the voice.
 */
import NumberFlow from '@number-flow/react'
import { useNavigate } from '@tanstack/react-router'
import { Play, RotateCcw } from 'lucide-react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { REDUCE_QUERY } from '#/lib/preferences.ts'
import { useReducedMotion } from '#/lib/preferences-dom.ts'
import type { ServerMarkup } from '#/lib/server-markup.ts'
import { billions, type FilmFacts } from './facts.ts'
import { EVEN_GUESS, GUESS_KEY, parseStoredGuess, serialiseGuess, type Shares } from './guess.ts'
import { GuessReveal, GuessTape } from './GuessTape.tsx'
import { Player, SEEN_KEY, SERVER_SNAPSHOT } from './player.ts'
import { PlayerBar, type PlayerActions } from './PlayerBar.tsx'
import { PostcodeLanding, type Landing } from './PostcodeLanding.tsx'
import { CHAPTER_ANCHOR, SCRIPT, spoken, type Chapter, type ChapterId } from './script.ts'
import type { StageHandle, StageSignals, WallReading } from './FilmStage.tsx'
import type { FilmSearch } from './search.ts'
import { stillsSurface } from './stills-surface.ts'
import { spans } from './timeline.ts'

// The server never renders the canvas, so its build leaves the film chunk out.
const FilmStage = import.meta.env.SSR ? () => null : lazy(() => import('./FilmStage.tsx'))

export interface FilmProps {
  readonly facts: FilmFacts
  readonly stills: Readonly<Record<ChapterId, ServerMarkup>>
  readonly search: FilmSearch
}

type Mode = 'read' | 'watch'

const SPANS = spans(SCRIPT)

/** Beats that tell a viewer how to work the player; Read mode leaves them out under the still. */
const WATCH_ONLY_BEATS: ReadonlySet<string> = new Set(['pour-3'])

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
/** One to nine as words, 10 and over as figures. */
const countWords = (n: number): string => NUMBER_WORDS[n] ?? n.toLocaleString('en-GB')

const PANEL: Partial<Record<ChapterId, { readonly top: string; readonly centre?: boolean }>> = {
  'your-split': { top: '9svh', centre: true },
  'the-wall': { top: '8svh' },
  'the-landing': { top: '22svh', centre: true },
}

let webGl2: boolean | undefined

/** Whether this browser can draw the film; asked once. */
function hasWebGl2(): boolean {
  if (webGl2 === undefined) {
    try {
      webGl2 = document.createElement('canvas').getContext('webgl2') !== null
    } catch {
      webGl2 = false
    }
  }
  return webGl2
}

const noSubscription = () => () => undefined
const serverSnapshot = () => SERVER_SNAPSHOT

const GUESS_EVENT = 'wgw-film-guess-change'
/** The guess when storage is blocked: it then lasts for this page only. */
let guessInMemory = ''

function storedGuess(): string {
  try {
    return window.localStorage.getItem(GUESS_KEY) ?? guessInMemory
  } catch {
    return guessInMemory
  }
}

function writeGuess(shares: Shares, locked: boolean): void {
  guessInMemory = serialiseGuess({ shares, locked })
  try {
    window.localStorage.setItem(GUESS_KEY, guessInMemory)
  } catch {
    // Kept in memory instead.
  }
  window.dispatchEvent(new Event(GUESS_EVENT))
}

function subscribeGuess(onChange: () => void) {
  window.addEventListener(GUESS_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(GUESS_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

const NO_GUESS = { shares: EVEN_GUESS, locked: false } as const

/** Least time between guess ticks, and from the lock to the reveal, in milliseconds. */
const TICK_GAP_MS = 90
const REVEAL_DELAY_MS = 350

/**
 * Runs as the article is parsed, before first paint. It marks that script
 * runs (Play needs it), greets a viewer who has played the film before with
 * Watch again, and gives a reader who will get Watch mode its layout, so the
 * switch from the server's Read layout shifts nothing. WebGL2 is checked
 * after hydration; without it the film falls back to Read.
 */
const BEFORE_PAINT = `(function(){try{var a=document.currentScript.parentElement;a.setAttribute('data-script','true');try{if(localStorage.getItem('${SEEN_KEY}'))a.setAttribute('data-returning','true')}catch(e){}var d=document.documentElement.getAttribute('data-motion');var r=d==='reduce'||(d!=='full'&&matchMedia('${REDUCE_QUERY}').matches);if(new URLSearchParams(location.search).get('mode')!=='read'&&!r)a.setAttribute('data-mode','watch')}catch(e){}})()`

/** Server markup kept as the server sent it (ADR 0007). */
function Markup({ markup }: { markup: ServerMarkup }) {
  return (
    <div
      className="contents"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: markup.html }}
    />
  )
}

export function Film({ facts, stills, search }: FilmProps) {
  const reduced = useReducedMotion()
  const navigate = useNavigate()
  const [engine, setEngine] = useState<'waiting' | 'ready' | 'failed'>('waiting')
  const webgl = useSyncExternalStore(noSubscription, hasWebGl2, () => false)
  const mode: Mode =
    search.mode !== 'read' && !reduced && engine !== 'failed' && webgl ? 'watch' : 'read'
  const rawGuess = useSyncExternalStore(subscribeGuess, storedGuess, () => '')
  const guess = useMemo(() => parseStoredGuess(rawGuess || null) ?? NO_GUESS, [rawGuess])
  // One player for the page's life, made in the browser only.
  const [player] = useState(() => (typeof window === 'undefined' ? undefined : new Player()))
  const snapshot = useSyncExternalStore(
    player?.subscribe ?? noSubscription,
    player?.getSnapshot ?? serverSnapshot,
    serverSnapshot,
  )
  const [shape, setShape] = useState<'hex' | 'map'>('map')
  const [landed, setLanded] = useState<Landing | undefined>()
  const [wall, setWall] = useState<WallReading | undefined>()
  const [open, setOpen] = useState(false)
  // The film chunk waits for an idle moment after load, so the poster, its font and the page come first.
  const [idle, setIdle] = useState(false)
  const root = useRef<HTMLElement>(null)
  const stage = useRef<StageHandle>(null)
  const modeNow = useRef(mode)

  useEffect(() => {
    modeNow.current = mode
  }, [mode])

  useEffect(() => {
    if (player === undefined) return undefined
    // Space and the arrows belong to the film in Watch mode, and in Read mode once it plays.
    const detach = player.attach(() => modeNow.current === 'watch' || player.getSnapshot().started)
    return () => {
      detach()
      player.destroy()
    }
  }, [player])

  useEffect(() => {
    player?.setLocked(guess.locked)
  }, [player, guess.locked])

  // The player shows the film on the canvas once it is drawn, or on the stills in Read mode.
  useEffect(() => {
    const element = root.current
    const handle = stage.current
    if (player === undefined || element === null) return undefined
    if (mode === 'read') {
      player.setSurface(stillsSurface(element, SPANS, (ms) => player.caption(ms)))
    } else if (engine === 'ready' && handle !== null) {
      player.setSurface(handle)
    } else {
      return undefined
    }
    return () => player.setSurface(undefined)
  }, [player, mode, engine])

  // Waits for the fonts and the load event too: the film's chunks and data
  // would otherwise share the network with the poster's display font.
  useEffect(() => {
    if (idle) return undefined
    let cancel: () => void = () => undefined
    let live = true
    const start = () => setIdle(true)
    const schedule = () => {
      if (!live) return
      if ('requestIdleCallback' in window) {
        const id = window.requestIdleCallback(start, { timeout: 1500 })
        cancel = () => window.cancelIdleCallback(id)
      } else {
        const id = setTimeout(start, 300)
        cancel = () => clearTimeout(id)
      }
    }
    const loaded =
      document.readyState === 'complete'
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            window.addEventListener('load', () => resolve(), { once: true })
          })
    void Promise.all([loaded, document.fonts.ready]).then(schedule)
    return () => {
      live = false
      cancel()
    }
  }, [idle])

  useEffect(() => {
    if (idle) void player?.prepare()
  }, [idle, player])

  // The inline script can set Watch before hydration; React's own value may then be stale.
  useEffect(() => {
    root.current?.setAttribute('data-mode', mode)
  }, [mode])

  // Read mode: stills cross-fade in as they reach the screen.
  useEffect(() => {
    const element = root.current
    if (element === null || mode !== 'read') return undefined
    const stillsOnPage = [...element.querySelectorAll<HTMLElement>('.film-still')]
    for (const still of stillsOnPage) still.dataset['seen'] = 'false'
    element.dataset['reveal'] = 'true'
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue
          entry.target.dataset['seen'] = 'true'
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    for (const still of stillsOnPage) observer.observe(still)
    return () => {
      observer.disconnect()
      element.dataset['reveal'] = 'false'
    }
  }, [mode])

  const cue = useCallback((id: string) => player?.audio.cue(id), [player])

  // A drag moves the tape on every pointer event; ticks come at most every TICK_GAP_MS.
  const lastTick = useRef(0)
  const changeGuess = useCallback(
    (shares: Shares) => {
      writeGuess(shares, false)
      const now = performance.now()
      if (now - lastTick.current < TICK_GAP_MS) return
      lastTick.current = now
      cue('tick')
    },
    [cue],
  )
  const lockGuess = useCallback(() => {
    writeGuess(guess.shares, true)
    player?.setLocked(true)
    cue('lock')
    // The real split appears beside the guess as the latch closes.
    window.setTimeout(() => cue('reveal'), REVEAL_DELAY_MS)
    player?.guessed()
  }, [guess.shares, player, cue])
  const resetGuess = useCallback(() => writeGuess(guess.shares, false), [guess.shares])

  const play = useCallback(() => {
    if (player === undefined) return
    const { status } = player.getSnapshot().state
    // A viewing from the start asks for a new guess, starting from the last one.
    if ((status === 'idle' || status === 'ended') && guess.locked) {
      writeGuess(guess.shares, false)
      player.setLocked(false)
    }
    setIdle(true)
    player.toggle()
  }, [player, guess])

  const actions: PlayerActions = useMemo(
    () => ({
      toggle: play,
      skip: (direction) => player?.skip(direction),
      seek: (ms) => player?.seek(ms),
      chapter: (index) => {
        const chapter = player?.getSnapshot().programme.chapters[index]
        if (chapter !== undefined) player?.seek(chapter.startMs)
      },
      skipGuess: () => player?.guessed(),
      captions: () => player?.setCaptions(!player.getSnapshot().captions),
      mute: () => player?.setMuted(!player.getSnapshot().muted),
    }),
    [player, play],
  )

  const handOff = useCallback(
    (landing: Landing) => {
      setOpen(true)
      cue('open')
      const go = () =>
        void navigate({
          to: '/explore',
          search: { view: 'map', sel: landing.code },
          viewTransition: true,
        })
      if (stage.current === null) go()
      else void stage.current.home().then(go)
    },
    [navigate, cue],
  )

  const signals: StageSignals = useMemo(
    () => ({
      onReady: () => setEngine('ready'),
      onFail: () => setEngine('failed'),
      onWall: setWall,
    }),
    [],
  )

  const status = snapshot.state.status
  const barShown = snapshot.started || (mode === 'watch' && status === 'manual')
  const chapters = SCRIPT.chapters
  return (
    <article
      ref={root}
      className="film"
      data-mode={mode}
      data-engine={engine}
      data-open={open ? 'true' : 'false'}
      data-player={status}
      data-bar={barShown ? 'true' : 'false'}
      data-captions={snapshot.captions ? 'on' : 'off'}
      aria-labelledby="film-title"
      // The inline script may switch Read to Watch before first paint; React then agrees.
      suppressHydrationWarning
    >
      <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />
      <div className="film-reel">
        <div className="film-stage">
          <div className="film-canvas" aria-hidden="true" />
          <div className="film-overlay" aria-hidden="true" />
          <div className="film-bar film-bar--top" aria-hidden="true" />
          <div className="film-bar film-bar--bottom" aria-hidden="true" />
          <header className="film-poster">
            <h1 id="film-title">
              <span className="film-title">{SCRIPT.title}</span>
              <span className="film-figure">{billions(facts.total)}</span>
            </h1>
            <p className="film-sub">
              in benefits went to people in Great Britain in{' '}
              <span className="whitespace-nowrap">{facts.period}</span>, in{' '}
              <span className="whitespace-nowrap">{facts.priceBase}</span> prices to allow for
              inflation. See who received it and where they live, in {countWords(chapters.length)}{' '}
              short chapters with narration.
            </p>
            <div className="film-start">
              <div className="film-start__first">
                <button type="button" className="film-play" onClick={play}>
                  <span className="film-play__icon film-play__icon--play" aria-hidden="true">
                    <Play size={24} strokeWidth={1.75} />
                  </span>
                  Play the film
                </button>
                <a className="film-start__link" href="/explore">
                  Skip to the map
                </a>
              </div>
              <div className="film-start__again">
                <button type="button" className="film-play" onClick={play}>
                  <span className="film-play__icon" aria-hidden="true">
                    <RotateCcw size={24} strokeWidth={2} />
                  </span>
                  Watch again
                </button>
                <a className="film-play film-play--quiet" href="/explore">
                  Explore the map
                </a>
              </div>
              <p className="film-start__note">
                With sound and captions.{' '}
                {search.mode === 'read' ? (
                  <a href="/">Play it with sound</a>
                ) : (
                  <a href="/?mode=read">Read it instead</a>
                )}
              </p>
            </div>
          </header>
          <p className="film-key" aria-hidden="true" />
          <div className="film-scale" aria-hidden="true">
            <span className="film-scale__label" />
            <span className="film-scale__basis">
              {facts.period} · {facts.priceBase} prices
            </span>
            <span className="film-scale__ramp">
              lower
              <span className="film-scale__steps">
                {[1, 2, 3, 4, 5, 6].map((step) => (
                  <i key={step} style={{ background: `var(--seq-brass-${step})` }} />
                ))}
              </span>
              higher
            </span>
          </div>
          <div className="film-captions" aria-hidden="true" />
          {mode === 'watch' && idle && player !== undefined ? (
            <Suspense fallback={null}>
              <FilmStage
                handle={stage}
                root={root}
                search={search}
                facts={facts}
                guess={guess.shares}
                locked={guess.locked}
                shape={shape}
                landed={landed}
                signals={signals}
                audio={player.audio}
                skylineOrder={player.skylineOrder}
              />
            </Suspense>
          ) : null}
        </div>
        <div className="film-chapters">
          {chapters.map((chapter, i) => (
            <ChapterSection key={chapter.id} chapter={chapter} index={i} still={stills[chapter.id]}>
              {chapter.id === 'your-split' ? (
                <GuessTape
                  facts={facts}
                  shares={guess.shares}
                  locked={guess.locked}
                  onChange={changeGuess}
                  onLock={lockGuess}
                  onReset={resetGuess}
                />
              ) : null}
              {chapter.id === 'the-wall' && mode === 'watch' ? (
                <WallReadout wall={wall} facts={facts} guess={guess} />
              ) : null}
              {chapter.id === 'the-rain' ? (
                <ShapeChoice shape={shape} onShape={setShape} disabled={mode === 'read'} />
              ) : null}
              {chapter.id === 'the-landing' ? (
                <PostcodeLanding
                  landed={landed}
                  onLand={(landing) => {
                    setLanded(landing)
                    setShape('map')
                  }}
                  onHandOff={mode === 'watch' ? handOff : undefined}
                />
              ) : null}
            </ChapterSection>
          ))}
          <div className="film-tail" />
        </div>
        {/* Sticky at the foot of the reel with no height, so the bar never changes the reel's scroll length. */}
        <div className="film-dock">
          <PlayerBar snapshot={snapshot} hidden={!barShown} actions={actions} />
        </div>
      </div>
      <details className="film-transcript-full" id="transcript">
        <summary>Full transcript</summary>
        {chapters.map((chapter) => (
          <section key={chapter.id} aria-label={chapter.title}>
            <h2 className="film-still__title">{chapter.title}</h2>
            {chapter.beats.map((beat) => (
              <p key={beat.id}>{spoken(beat.narration)}</p>
            ))}
          </section>
        ))}
        <p className="film-note">
          Figures are for {facts.period}, in {facts.priceBase} prices to allow for inflation. They
          cover benefits paid by the Department for Work and Pensions (DWP) and Social Security
          Scotland to people in Great Britain. Money paid to people who live abroad is not counted
          in any area. <a href="/methods">How we worked this out</a>
          {' · '}
          <a href="/explore">Explore the map</a>
        </p>
      </details>
    </article>
  )
}

const sectionStyle = (
  scroll: number,
  top: string | undefined,
): CSSProperties & { '--scroll': number; '--panel-top'?: string } =>
  top === undefined ? { '--scroll': scroll } : { '--scroll': scroll, '--panel-top': top }

function ChapterSection({
  chapter,
  index,
  still,
  children,
}: {
  chapter: Chapter
  index: number
  still: ServerMarkup | undefined
  children: ReactNode
}) {
  const panel = PANEL[chapter.id]
  const anchor = CHAPTER_ANCHOR[chapter.id]
  return (
    <section
      id={anchor}
      className="film-chapter"
      aria-labelledby={`${anchor}-title`}
      data-panel={panel?.centre === true ? 'centre' : undefined}
      style={sectionStyle(chapter.scroll, panel?.top)}
    >
      <div className="film-panel">
        <h2 id={`${anchor}-title`}>
          <span className="film-number">{String(index + 1).padStart(2, '0')}</span>
          {chapter.title}
        </h2>
        {children}
      </div>
      <div className="film-read">
        {still === undefined ? null : chapter.id === 'your-split' ? (
          <details>
            <summary>Show the real split</summary>
            <Markup markup={still} />
          </details>
        ) : (
          <Markup markup={still} />
        )}
        <div className="film-transcript">
          {chapter.beats
            .filter((beat) => !WATCH_ONLY_BEATS.has(beat.id))
            .map((beat) => (
              <p key={beat.id}>{spoken(beat.narration)}</p>
            ))}
        </div>
      </div>
    </section>
  )
}

function WallReadout({
  wall,
  facts,
  guess,
}: {
  wall: WallReading | undefined
  facts: FilmFacts
  guess: { shares: Shares; locked: boolean }
}) {
  const reduced = useReducedMotion()
  return (
    <div>
      <div className="film-readout">
        <span className="film-readout__label">Running total</span>
        <span className="film-readout__value">
          <NumberFlow
            value={Math.round((wall?.total ?? 0) / 1e9)}
            locales="en-GB"
            format={{ style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }}
            suffix="bn"
            animated={!reduced}
            willChange
          />
        </span>
        <span className="film-readout__label">
          {wall === undefined
            ? 'The columns fill one benefit at a time.'
            : `${wall.label}: ${billions(wall.block)}`}
        </span>
      </div>
      {guess.locked ? (
        <GuessReveal facts={facts} shares={guess.shares} />
      ) : (
        <p className="film-note">You did not lock in a guess. Go back to Your guess to make one.</p>
      )}
    </div>
  )
}

function ShapeChoice({
  shape,
  onShape,
  disabled,
}: {
  shape: 'hex' | 'map'
  onShape: (shape: 'hex' | 'map') => void
  disabled: boolean
}) {
  return (
    <fieldset className="film-chips film-watch-only">
      <legend className="sr-only">Map style</legend>
      <button
        type="button"
        className="film-button"
        aria-pressed={shape === 'map'}
        disabled={disabled}
        onClick={() => onShape('map')}
      >
        Real map
      </button>
      <button
        type="button"
        className="film-button"
        aria-pressed={shape === 'hex'}
        disabled={disabled}
        onClick={() => onShape('hex')}
      >
        Equal-size areas
      </button>
    </fieldset>
  )
}
