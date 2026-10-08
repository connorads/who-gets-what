/**
 * Plays the film like a video. The narration's clock drives it: each frame
 * reads the audio context's time, schedules the beats coming up, and shows
 * the frame the programme puts at that time through a surface, the canvas in
 * Watch mode or the stills in Read mode. The viewer's own wheel, touch,
 * scroll keys or scrollbar hand the film back to them and the voice fades;
 * Resume picks up the beat on screen. States and moves are in playback.ts.
 */
import { FilmAudio, readMuted } from './audio.ts'
import { captionAt, chapterCues, orderedBeats, type CaptionState, type Cue } from './captions.ts'
import { IDLE, reduce, toggleEvent, type PlayerEvent, type PlayerState } from './playback.ts'
import {
  beatAfter,
  beatBefore,
  buildProgramme,
  chapterAt,
  msAt,
  progressAt,
  sessionSkylineOrder,
  type Programme,
} from './programme.ts'
import { chapterOf, SCRIPT, type ChapterId, type SkylineId } from './script.ts'
import { spans, type Span } from './timeline.ts'

/** Where the player shows the film: the canvas, or the stills. */
export interface PlayerSurface {
  /** Show the film at `progress`, `ms` into the programme, with no smoothing. */
  show(progress: number, ms: number): void
  /** Scroll progress where the viewer is now. */
  progress(): number
}

export interface PlayerSnapshot {
  readonly state: PlayerState
  readonly programme: Programme
  /** Film clock for the progress bar, in quarter seconds. */
  readonly ms: number
  readonly chapter: number
  /** Playing, but waiting for the picture or the first words. */
  readonly waiting: boolean
  readonly muted: boolean
  readonly captions: boolean
  /** The viewer has pressed Play at least once on this page. */
  readonly started: boolean
}

/** localStorage key set once a viewer has played the film; the poster then offers to watch again. */
export const SEEN_KEY = 'wgw-film-seen'
const CAPTIONS_KEY = 'wgw-film-captions'

/** The voice fades over this when the viewer takes over. */
const FADE_MS = 300
/** Beats are scheduled this far ahead of the clock. */
const LOOKAHEAD_MS = 600
/** Time from pressing Play to the first sound, so the first beat is not clipped. */
const LEAD_S = 0.12
/** The longest the clock waits for a beat to decode before playing on without it. */
const STALL_LIMIT_MS = 4000
/** Scroll further than this from where the player put it is the viewer's own. */
const DRIFT_PX = 8
const UI_STEP_MS = 250
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'])

function readCaptions(): boolean {
  try {
    return window.localStorage.getItem(CAPTIONS_KEY) !== 'off'
  } catch {
    return true
  }
}

function writeCaptions(on: boolean): void {
  try {
    window.localStorage.setItem(CAPTIONS_KEY, on ? 'on' : 'off')
  } catch {
    // The choice then lasts for this page only.
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // Storage can be blocked; the poster then greets the viewer as new.
  }
}

const closest = (target: EventTarget | null, selector: string): boolean =>
  target instanceof Element && target.closest(selector) !== null

/** Elements whose own gestures are not the viewer scrolling the film. */
const OWN_GESTURES = 'input, textarea, select, .film-tape, [data-own-scroll]'

export class Player {
  readonly audio = new FilmAudio()
  readonly skylineOrder: readonly [SkylineId, SkylineId] = sessionSkylineOrder()
  private readonly spans: readonly Span[] = spans(SCRIPT)
  private readonly cues = new Map<ChapterId, readonly Cue[]>()
  private programme: Programme
  private timed = false
  private state: PlayerState = IDLE
  private snapshot: PlayerSnapshot
  private readonly listeners = new Set<() => void>()
  private surface: PlayerSurface | undefined
  private surfaceWaiters: (() => void)[] = []
  private enabling: Promise<void> = Promise.resolve()
  private locked = false
  private captions = readCaptions()
  private started = false
  private waiting = false
  private run = 0
  /** Clock seconds at film time 0, for this run. */
  private origin = 0
  private clock: () => number = () => performance.now() / 1000
  private raf = 0
  private readonly scheduled = new Set<string>()
  private stallSince: number | undefined
  private expectedTop: number | undefined
  private ignoreScrollUntil = 0
  private prefetched = -1
  private playhead = 0

  constructor() {
    this.audio.muted = readMuted()
    this.programme = this.build()
    this.snapshot = this.makeSnapshot()
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): PlayerSnapshot => this.snapshot

  /** Read the recordings' lengths so the programme and the progress bar use them. */
  prepare(): Promise<void> {
    return this.audio.load().then(() => {
      // Times in a run, a pause or the guess belong to the programme they were taken on.
      const status = this.state.status
      if (this.timed || !(status === 'idle' || status === 'manual' || status === 'ended')) return
      this.retime()
      this.publish(true)
    })
  }

  /**
   * Listen for the viewer taking over and for keyboard shortcuts: space plays
   * and pauses, the left and right arrows step between beats. `shortcuts`
   * says whether the keys belong to the film right now.
   */
  attach(shortcuts: () => boolean): () => void {
    const takeOver = (): void => {
      if (this.state.status !== 'manual') this.dispatch({ type: 'scroll' })
    }
    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) + Math.abs(event.deltaX) < 1) return
      if (closest(event.target, '[data-own-scroll]')) return
      takeOver()
    }
    const onTouch = (event: TouchEvent): void => {
      if (!closest(event.target, OWN_GESTURES)) takeOver()
    }
    const onScroll = (): void => {
      const expected = this.expectedTop
      if (
        expected !== undefined &&
        performance.now() > this.ignoreScrollUntil &&
        Math.abs(window.scrollY - expected) > DRIFT_PX
      ) {
        takeOver()
      }
      if (this.state.status === 'manual') this.publish(false)
    }
    const onResize = (): void => {
      // A resize moves the page under the player; that is not the viewer scrolling.
      this.ignoreScrollUntil = performance.now() + 400
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (!shortcuts() || closest(event.target, 'input, textarea, select, [contenteditable]')) {
        return
      }
      if (event.key === ' ') {
        // Space presses a focused button or link, as it always does.
        if (closest(event.target, 'button, a, summary')) return
        event.preventDefault()
        this.toggle()
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        this.skip(event.key === 'ArrowRight' ? 1 : -1)
      } else if (SCROLL_KEYS.has(event.key)) {
        takeOver()
      }
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchmove', onTouch, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchmove', onTouch)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }

  /** The surface the film shows on; undefined while it has none. */
  setSurface(surface: PlayerSurface | undefined): void {
    this.surface = surface
    this.expectedTop = surface === undefined ? undefined : window.scrollY
    if (surface === undefined) return
    // A chapter link or a reload can open the film part way through: the viewer is then scrolling.
    if (this.state.status === 'idle' && surface.progress() > 0.002)
      this.dispatch({ type: 'scroll' })
    const waiters = this.surfaceWaiters
    this.surfaceWaiters = []
    for (const resolve of waiters) resolve()
    this.publish(true)
  }

  setLocked(locked: boolean): void {
    this.locked = locked
  }

  /** Play, pause or resume. Call it from a click or key press, so the sound may start. */
  toggle(): void {
    const event = toggleEvent(this.state, this.currentMs(), this.surface?.progress() ?? 0)
    if (event.type !== 'pause') this.enabling = this.audio.enable()
    this.dispatch(event)
  }

  seek(ms: number): void {
    this.dispatch({ type: 'seek', at: ms })
  }

  /** Step to the next beat, or back to this one or the one before. */
  skip(direction: -1 | 1): void {
    const at = this.currentMs()
    this.seek(direction > 0 ? beatAfter(this.programme, at) : beatBefore(this.programme, at))
  }

  /** Carry on after the guess, locked or skipped. */
  guessed(): void {
    this.dispatch({ type: 'guessed' })
  }

  setMuted(muted: boolean): void {
    // Turning the sound on from a click may start it, so cues play while the viewer scrolls.
    if (!muted) this.enabling = this.audio.enable()
    this.audio.setMuted(muted)
    this.publish(true)
  }

  setCaptions(on: boolean): void {
    this.captions = on
    writeCaptions(on)
    this.publish(true)
  }

  /** The caption for a point on the film clock, for surfaces that draw their own. */
  caption(ms: number): CaptionState | undefined {
    const chapter = this.programme.chapters[chapterAt(this.programme, ms)]
    return chapter === undefined
      ? undefined
      : captionAt(this.cuesFor(chapter.id), ms - chapter.startMs)
  }

  destroy(): void {
    this.stop()
    this.audio.destroy()
    this.listeners.clear()
  }

  private cuesFor(id: ChapterId): readonly Cue[] {
    const hit = this.cues.get(id)
    if (hit !== undefined) return hit
    const beats = orderedBeats(chapterOf(SCRIPT, id).beats, this.skylineOrder)
    const cues = chapterCues(beats, this.audio.beatTimings())
    this.cues.set(id, cues)
    return cues
  }

  private build(): Programme {
    return buildProgramme(this.spans, (id) => this.cuesFor(id))
  }

  /** Rebuild the programme on the recordings' lengths, once they are known. */
  private retime(): void {
    if (this.audio.beatTimings().size === 0) return
    this.cues.clear()
    this.programme = this.build()
    this.timed = true
  }

  private currentMs(): number {
    const state = this.state
    if (state.status === 'playing') return this.playhead
    if (state.status === 'paused' || state.status === 'guess') return state.at
    if (state.status === 'ended') return this.programme.durationMs
    if (state.status === 'manual' && this.surface !== undefined) {
      return msAt(this.programme, this.surface.progress())
    }
    return 0
  }

  private dispatch(event: PlayerEvent): void {
    const next = reduce(this.programme, this.state, event)
    if (next === this.state) return
    const previous = this.state
    this.state = next
    if (previous.status === 'playing') this.stop()
    if (next.status === 'playing') {
      this.started = true
      markSeen()
      this.start(next.from)
    } else if (next.status === 'paused' || next.status === 'guess') {
      this.playhead = next.at
      this.showAt(next.at)
    } else if (next.status === 'manual') {
      this.expectedTop = undefined
    }
    this.audio.setMusic(next.status !== 'paused')
    this.publish(true)
  }

  /** Begin a run at `from`: show its frame, then start the clock once sound and picture are ready. */
  private start(from: number): void {
    const run = ++this.run
    this.playhead = from
    this.waiting = true
    this.scheduled.clear()
    this.stallSince = undefined
    this.prefetched = -1
    this.showAt(from)
    void this.ready(from).then(() => {
      if (run !== this.run || this.state.status !== 'playing') return
      this.waiting = false
      const audio = this.audio
      this.clock = audio.running ? () => audio.now() : () => performance.now() / 1000
      this.origin = this.clock() + LEAD_S - from / 1000
      this.publish(true)
      this.raf = requestAnimationFrame(this.frame)
    })
  }

  private async ready(from: number): Promise<void> {
    await Promise.all([this.enabling, this.audio.load()])
    if (!this.timed && from === 0) this.retime()
    if (this.surface === undefined) {
      await new Promise<void>((resolve) => this.surfaceWaiters.push(resolve))
    }
    const index = chapterAt(this.programme, from)
    this.prefetch(index)
    const first = this.programme.beats.find((beat) => beat.endMs > from)
    if (first !== undefined) await this.audio.settled(first.id, STALL_LIMIT_MS)
  }

  private stop(): void {
    this.run += 1
    cancelAnimationFrame(this.raf)
    this.waiting = false
    this.audio.silence(FADE_MS)
  }

  private readonly frame = (): void => {
    const state = this.state
    if (state.status !== 'playing' || this.waiting) return
    this.raf = requestAnimationFrame(this.frame)
    const clocked = Math.max((this.clock() - this.origin) * 1000, state.from)
    const ms = Math.min(this.schedule(clocked), this.programme.durationMs)
    this.playhead = ms
    const chapter = chapterAt(this.programme, ms)
    if (chapter !== this.prefetched) this.prefetch(chapter)
    this.showAt(ms)
    this.dispatch({ type: 'tick', at: ms, locked: this.locked })
    this.publish(false)
  }

  /**
   * Schedule the beats that start within the lookahead. A beat still
   * decoding when its time comes holds the clock, for a while, so the
   * picture never runs ahead of the words. Returns the clock, held or not.
   */
  private schedule(ms: number): number {
    for (const beat of this.programme.beats) {
      if (this.scheduled.has(beat.id) || beat.endMs <= ms || beat.startMs > ms + LOOKAHEAD_MS) {
        continue
      }
      const status = this.audio.voiceStatus(beat.id)
      if (status === 'pending') {
        if (ms < beat.startMs) continue
        const now = performance.now()
        this.stallSince ??= now
        if (now - this.stallSince < STALL_LIMIT_MS) {
          this.origin = this.clock() - beat.startMs / 1000
          return beat.startMs
        }
      }
      this.stallSince = undefined
      this.scheduled.add(beat.id)
      if (status !== 'none') {
        this.audio.speak(beat.id, this.origin + beat.startMs / 1000, (ms - beat.startMs) / 1000)
      }
    }
    return ms
  }

  private prefetch(chapter: number): void {
    this.prefetched = chapter
    const ids = this.programme.beats
      .filter((beat) => beat.chapter === chapter || beat.chapter === chapter + 1)
      .map((beat) => beat.id)
    this.audio.prefetch(ids)
  }

  private showAt(ms: number): void {
    const surface = this.surface
    if (surface === undefined) return
    surface.show(progressAt(this.programme, ms), ms)
    this.expectedTop = window.scrollY
  }

  private makeSnapshot(): PlayerSnapshot {
    const ms = this.currentMs()
    return {
      state: this.state,
      programme: this.programme,
      ms: Math.round(ms / UI_STEP_MS) * UI_STEP_MS,
      chapter: chapterAt(this.programme, ms),
      waiting: this.waiting,
      muted: this.audio.muted,
      captions: this.captions,
      started: this.started,
    }
  }

  /** Tell subscribers; without `force`, only when the shown time or chapter moves. */
  private publish(force: boolean): void {
    const next = this.makeSnapshot()
    const last = this.snapshot
    if (!force && next.ms === last.ms && next.chapter === last.chapter) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

/** What the server renders, and what hydration starts from: estimated lengths, the first skyline order. */
export const SERVER_SNAPSHOT: PlayerSnapshot = {
  state: IDLE,
  programme: buildProgramme(spans(SCRIPT), (id) =>
    chapterCues(orderedBeats(chapterOf(SCRIPT, id).beats, ['pensioner', 'working-age']), new Map()),
  ),
  ms: 0,
  chapter: 0,
  waiting: false,
  muted: false,
  captions: true,
  started: false,
}
