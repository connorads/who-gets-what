/**
 * The film's sound through Web Audio: narration per beat, the score and a
 * looping bed, and short cues. Nothing plays until the viewer presses Play,
 * which makes the context inside that gesture. The player schedules each
 * beat on the context's clock, which is the film's clock while it plays, and
 * the score ducks under every beat. Mute silences everything and lasts for
 * the browser session. `public/audio/manifest.json` lists every file
 * (docs/film/audio.md).
 */
import type { BeatTiming, CueWord } from './captions.ts'

const MUTE_KEY = 'wgw-film-muted'

export interface AudioItem {
  readonly id: string
  readonly kind: 'narration' | 'sfx' | 'score' | 'ambience'
  readonly file: string
  readonly fallback: string
  readonly durationMs: number
  readonly loop: boolean
  readonly captions?: string
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined

const KINDS = new Set(['narration', 'sfx', 'score', 'ambience'])

function isKind(value: unknown): value is AudioItem['kind'] {
  return typeof value === 'string' && KINDS.has(value)
}

/** Read the manifest's items, skipping any entry this player cannot use. */
export function parseManifest(input: unknown): readonly AudioItem[] {
  const items = field(input, 'items')
  if (!Array.isArray(items)) return []
  return items.flatMap((item: unknown): AudioItem[] => {
    const id = field(item, 'id')
    const kind = field(item, 'kind')
    const file = field(item, 'file')
    const fallback = field(item, 'fallback')
    const durationMs = field(item, 'durationMs')
    const captions = field(item, 'captions')
    if (
      typeof id !== 'string' ||
      !isKind(kind) ||
      typeof file !== 'string' ||
      typeof fallback !== 'string' ||
      typeof durationMs !== 'number'
    ) {
      return []
    }
    return [
      {
        id,
        kind,
        file,
        fallback,
        durationMs,
        loop: field(item, 'loop') === true,
        ...(typeof captions === 'string' ? { captions } : {}),
      },
    ]
  })
}

/** Caption words from a beat's caption file. */
export function parseCaptionWords(input: unknown): readonly CueWord[] {
  const words = field(input, 'words')
  if (!Array.isArray(words)) return []
  return words.flatMap((word: unknown): CueWord[] => {
    const text = field(word, 'text')
    const startMs = field(word, 'startMs')
    const endMs = field(word, 'endMs')
    return typeof text === 'string' && typeof startMs === 'number' && typeof endMs === 'number'
      ? [{ text, startMs, endMs }]
      : []
  })
}

/** Score gain while narration plays, and otherwise. */
export const DUCK = { narrating: 0.28, clear: 0.75 } as const

export function readMuted(): boolean {
  try {
    return window.sessionStorage.getItem(MUTE_KEY) === 'on'
  } catch {
    return false
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.sessionStorage.setItem(MUTE_KEY, muted ? 'on' : 'off')
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

/** Whether a beat's recording can be scheduled now. */
export type VoiceStatus = 'ready' | 'pending' | 'none'

export class FilmAudio {
  private items: ReadonlyMap<string, AudioItem> = new Map()
  private readonly timings = new Map<string, BeatTiming>()
  private readonly buffers = new Map<string, Promise<AudioBuffer | undefined>>()
  private readonly decoded = new Map<string, AudioBuffer | undefined>()
  private loading: Promise<void> | undefined
  private context: AudioContext | undefined
  private master: GainNode | undefined
  private music: GainNode | undefined
  private score: GainNode | undefined
  /** This run's narration, on its own gain so a fading run never touches the next. */
  private voice: { readonly gain: GainNode; readonly sources: AudioBufferSourceNode[] } | undefined
  private webm = true
  muted = false

  /** Read the manifest and every beat's timing, once. Plays nothing. */
  load(manifestUrl = '/audio/manifest.json'): Promise<void> {
    this.loading ??= this.read(manifestUrl).catch(() => undefined)
    return this.loading
  }

  /** Recorded length and word times per beat, for captions and the programme. */
  beatTimings(): ReadonlyMap<string, BeatTiming> {
    return this.timings
  }

  /** True once the context runs, so its clock moves. */
  get running(): boolean {
    return this.context?.state === 'running'
  }

  /** The context's clock, in seconds. */
  now(): number {
    return this.context?.currentTime ?? 0
  }

  /**
   * Make the context and start the score and the bed. Call it inside a click
   * or key press: browsers start sound only from a gesture. The context is
   * made before the first await, so inside the gesture.
   */
  async enable(): Promise<void> {
    if (this.context === undefined) {
      let context: AudioContext
      try {
        context = new AudioContext()
      } catch {
        return
      }
      this.context = context
      const master = context.createGain()
      master.gain.value = this.muted ? 0 : 1
      master.connect(context.destination)
      const music = context.createGain()
      music.connect(master)
      const score = context.createGain()
      score.gain.value = DUCK.clear
      score.connect(music)
      this.master = master
      this.music = music
      this.score = score
      void this.load().then(() => {
        void this.loop('ambience-loop', 0.5)
        void this.play('score', score)
      })
    }
    await this.context.resume().catch(() => undefined)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    writeMuted(muted)
    const context = this.context
    if (context === undefined) return
    this.master?.gain.setTargetAtTime(muted ? 0 : 1, context.currentTime, 0.05)
  }

  /** Bring the score and the bed down while the film is paused, and back up. */
  setMusic(on: boolean): void {
    const context = this.context
    if (context === undefined) return
    this.music?.gain.setTargetAtTime(on ? 1 : 0, context.currentTime, 0.1)
  }

  /** Start decoding beats before the film reaches them. */
  prefetch(ids: readonly string[]): void {
    if (this.context === undefined) return
    for (const id of ids) void this.buffer(id)
  }

  /** A beat's recording: decoded, on its way, or not to be had (no sound yet, or no file). */
  voiceStatus(id: string): VoiceStatus {
    if (this.context === undefined || !this.items.has(id)) return 'none'
    if (this.decoded.has(id)) return this.decoded.get(id) === undefined ? 'none' : 'ready'
    void this.buffer(id)
    return 'pending'
  }

  /** Wait until a beat is decoded or has failed, for at most `ms`. */
  async settled(id: string, ms: number): Promise<void> {
    if (this.voiceStatus(id) !== 'pending') return
    await Promise.race([
      this.buffer(id),
      new Promise((resolve) => {
        window.setTimeout(resolve, ms)
      }),
    ])
  }

  /** Play a decoded beat at `when` on the context clock, from `offset` seconds in, and duck the score. */
  speak(id: string, when: number, offset: number): void {
    const context = this.context
    const master = this.master
    const buffer = this.decoded.get(id)
    if (context === undefined || master === undefined || buffer === undefined) return
    if (this.voice === undefined) {
      const gain = context.createGain()
      gain.connect(master)
      this.voice = { gain, sources: [] }
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(this.voice.gain)
    const start = Math.max(when, context.currentTime)
    const from = Math.min(Math.max(offset, 0), buffer.duration)
    source.start(start, from)
    this.voice.sources.push(source)
    const score = this.score?.gain
    score?.setTargetAtTime(DUCK.narrating, Math.max(start - 0.15, context.currentTime), 0.12)
    score?.setTargetAtTime(DUCK.clear, start + buffer.duration - from + 0.2, 0.4)
  }

  /** Fade this run's narration out over `ms` and stop it; the score comes back up. */
  silence(ms: number): void {
    const context = this.context
    const voice = this.voice
    this.voice = undefined
    if (context === undefined) return
    const now = context.currentTime
    const score = this.score?.gain
    score?.cancelScheduledValues(now)
    score?.setTargetAtTime(DUCK.clear, now, 0.3)
    if (voice === undefined) return
    const end = now + ms / 1000
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
    voice.gain.gain.linearRampToValueAtTime(0, end)
    for (const source of voice.sources) {
      try {
        source.stop(end + 0.02)
      } catch {
        // Already stopped.
      }
    }
    window.setTimeout(() => voice.gain.disconnect(), ms + 100)
  }

  /** A short sound effect, heard only once the viewer has started the sound. */
  cue(id: string): void {
    if (!this.running) return
    void this.play(id, this.master)
  }

  destroy(): void {
    this.silence(0)
    void this.context?.close()
    this.context = undefined
  }

  private async read(manifestUrl: string): Promise<void> {
    const response = await fetch(manifestUrl)
    if (!response.ok) return
    const items = parseManifest(await response.json())
    this.items = new Map(items.map((item) => [item.id, item]))
    this.webm = new Audio().canPlayType('audio/webm; codecs="opus"') !== ''
    await Promise.all(
      items
        .filter((item) => item.kind === 'narration')
        .map(async (item) => {
          const words =
            item.captions === undefined
              ? []
              : parseCaptionWords(await (await fetch(item.captions)).json().catch(() => undefined))
          this.timings.set(item.id, { durationMs: item.durationMs, words })
        }),
    )
  }

  private buffer(id: string): Promise<AudioBuffer | undefined> {
    const hit = this.buffers.get(id)
    if (hit !== undefined) return hit
    const item = this.items.get(id)
    const context = this.context
    if (item === undefined || context === undefined) return Promise.resolve(undefined)
    const pending = fetch(this.webm ? item.file : item.fallback)
      .then((response) => response.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
      .catch(() => undefined)
      .then((buffer) => {
        this.decoded.set(id, buffer)
        return buffer
      })
    this.buffers.set(id, pending)
    return pending
  }

  private async play(id: string, into: AudioNode | undefined): Promise<void> {
    const context = this.context
    const buffer = await this.buffer(id)
    if (context === undefined || buffer === undefined || into === undefined) return
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(into)
    source.start()
  }

  private async loop(id: string, gain: number): Promise<void> {
    const context = this.context
    const buffer = await this.buffer(id)
    if (context === undefined || buffer === undefined || this.music === undefined) return
    const level = context.createGain()
    level.gain.value = gain
    level.connect(this.music)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(level)
    source.start()
  }
}
