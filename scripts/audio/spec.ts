/**
 * What `pnpm run audio:build` asks ElevenLabs for. Narration text and the cue
 * ids each chapter plays come from src/film/script.json; the voice, the
 * prompt for each cue and the score live here.
 * docs/film/audio.md explains each choice.
 */
import type { Encoding } from './ffmpeg.ts'

export const VOICE = {
  /** Alice, a premade ElevenLabs voice: British, middle-aged, clear and even. */
  id: 'Xb7hH8MSUJpSbSDYk0k2',
  name: 'Alice - Clear, Engaging Educator',
  modelId: 'eleven_v4',
  /** Eleven v4 reads only stability and similarity; higher stability keeps the read level. */
  settings: { stability: 0.65, similarity_boost: 0.75 },
  /** Base seed; each beat adds its place in `SEED_ORDER`, so a rebuild asks for the same take. */
  seed: 4101,
  /**
   * A v4 audio tag put before each beat's words, which stay as the script
   * writes them. The tag names a voice quality, so the model does not render
   * it as a sound. A beat with its own tags is sent unchanged.
   */
  direction: '[calm, measured documentary narration]',
} as const

/**
 * Beats sent without `previous_text`. With the words before it as context,
 * `skyline-working-age` opened on "Waking age" in every seed tried; without
 * them it reads "Working-age".
 */
export const NO_PREVIOUS_TEXT: ReadonlySet<string> = new Set(['skyline-working-age'])

/**
 * Beats sent without `next_text`. With the words after them as context,
 * `swarm-1` and `skyline-4` ran on into the next sentence, and every seed
 * tried came back cut off part way through the last word.
 */
export const NO_NEXT_TEXT: ReadonlySet<string> = new Set(['swarm-1', 'skyline-4'])

/**
 * Beats read on their own: sent with no context either side, and skipped when
 * the beats around them look for theirs. `split-4` asks for the reader's
 * guess and the film then waits, so no beat follows it straight on.
 */
export const STANDALONE: ReadonlySet<string> = new Set(['split-4'])

/**
 * A beat's seed is `VOICE.seed` plus its place here. New beats go at the end,
 * so adding one leaves every other beat's request, and its cached take, as it was.
 */
export const SEED_ORDER: readonly string[] = [
  'pour-1',
  'pour-2',
  'pour-3',
  'split-1',
  'split-2',
  'split-3',
  'wall-1',
  'wall-2',
  'wall-3',
  'wall-4',
  'rain-1',
  'rain-2',
  'rain-3',
  'skyline-1',
  'skyline-pensioner',
  'skyline-working-age',
  'skyline-4',
  'swarm-1',
  'swarm-2',
  'swarm-3',
  'swarm-4',
  'landing-1',
  'landing-2',
  'split-4',
]

/**
 * Seeds for beats whose take from `SEED_ORDER` ended too soon: the API
 * returned audio cut off before the last sound died away, which plays as a
 * click. A seed here replaces that beat's `VOICE.seed` plus its place.
 */
export const RESEED: ReadonlyMap<string, number> = new Map([
  ['rain-3', 5112],
  ['pour-1', 5201],
])

export const SFX_MODEL = 'eleven_text_to_sound_v2'
export const MUSIC_MODEL = 'music_v2_5'

export const TARGET_LUFS = { narration: -16, sfx: -18, score: -22, ambience: -22 } as const

export const ENCODING = {
  narration: { channels: 1, opusKbps: 40, aacKbps: 56 },
  sfx: { channels: 1, opusKbps: 48, aacKbps: 64 },
  score: { channels: 2, opusKbps: 64, aacKbps: 96 },
  ambience: { channels: 2, opusKbps: 48, aacKbps: 80 },
} as const satisfies Record<string, Encoding>

export interface SfxCue {
  readonly id: string
  /** Where the film plays it. */
  readonly use: string
  readonly prompt: string
  readonly seconds: number
  readonly loop: boolean
  /** 0 to 1: how literally the model follows the prompt. */
  readonly influence: number
}

const DRY = 'close, dry, quiet, no music, no voices'

export const SFX: readonly SfxCue[] = [
  {
    id: 'pour',
    use: 'The total breaks up into dots that gather in one pile',
    prompt: `Fine brass grains pouring in a steady stream onto a soft pile, gentle granular hiss, ${DRY}`,
    seconds: 4,
    loop: false,
    influence: 0.5,
  },
  {
    id: 'settle',
    use: 'The pile or the columns of dots come to rest',
    prompt: `A small pile of fine grains settling and shifting briefly, then silence, ${DRY}`,
    seconds: 2,
    loop: false,
    influence: 0.5,
  },
  {
    id: 'tick',
    use: 'A guess slider handle passes a step',
    prompt: `One very soft wooden tick, like a quiet ruler detent, single short click, ${DRY}`,
    seconds: 0.6,
    loop: false,
    influence: 0.7,
  },
  {
    id: 'lock',
    use: 'The reader locks a guess',
    prompt: `A single soft mechanical latch click, small brass catch closing, ${DRY}`,
    seconds: 1,
    loop: false,
    influence: 0.7,
  },
  {
    id: 'reveal',
    use: 'The real split appears beside the guess',
    prompt: `A gentle soft swell of air ending in a faint low bell tone, subtle and calm, ${DRY}`,
    seconds: 2.5,
    loop: false,
    influence: 0.5,
  },
  {
    id: 'stack-loop',
    use: 'The dots stack into one column for each benefit',
    prompt: `Continuous dense soft clicking of small wooden tokens placed one after another in neat rows, steady even rhythm with no gaps, ${DRY}`,
    seconds: 4,
    loop: true,
    influence: 0.7,
  },
  {
    id: 'pan',
    use: 'The camera pans along the columns',
    prompt: `A slow, very soft airy whoosh passing by, smooth and even, ${DRY}`,
    seconds: 2.5,
    loop: false,
    influence: 0.5,
  },
  {
    id: 'rain',
    use: 'The dots move to their constituencies on the map',
    prompt: `Light patter of fine grains falling onto a wooden table, scattered and soft, ${DRY}`,
    seconds: 4,
    loop: false,
    influence: 0.5,
  },
  {
    id: 'rise',
    use: 'Each constituency rises to its height on the 3D map',
    prompt: `A soft rising tonal whoosh, gentle upward movement, smooth, ${DRY}`,
    seconds: 1.5,
    loop: false,
    influence: 0.5,
  },
  {
    id: 'morph',
    use: 'The map switches between real and equal-size shapes, or turns into a chart of dots',
    prompt: `A smooth soft airy transition sweep with a faint shimmer, subtle, ${DRY}`,
    seconds: 2,
    loop: false,
    influence: 0.5,
  },
  {
    id: 'tilt',
    use: 'The camera tilts to show the 3D map',
    prompt: `A deep, soft, slow whoosh of a camera moving through still air, ${DRY}`,
    seconds: 2,
    loop: false,
    influence: 0.5,
  },
  {
    id: 'land',
    use: 'The map moves to the reader’s area',
    prompt: `A soft low thud of a small object landing on felt, damped, ${DRY}`,
    seconds: 1,
    loop: false,
    influence: 0.6,
  },
  {
    id: 'open',
    use: 'The black bars slide away to open the explorer',
    prompt: `A smooth soft mechanical slide of a panel opening, quiet and even, ${DRY}`,
    seconds: 1.5,
    loop: false,
    influence: 0.6,
  },
]

const NO_VOICE = ['vocals', 'singing', 'choir', 'spoken word']
const NOT_DRAMATIC = [
  'drum kit',
  'electronic beat',
  'EDM',
  'epic trailer',
  'braams',
  'aggressive',
  'ominous',
  'triumphant fanfare',
  'synth lead',
]

/**
 * The score: four sections, an opening, a pulse, a lift and a resolve. The
 * music must not tell the reader how to feel about a number, so it stays
 * curious and even and never ominous or triumphant. Chunk text stays empty:
 * the model sings any text it is given.
 */
export const SCORE = {
  id: 'score',
  use: 'Underscore for the whole film, about 105 seconds',
  plan: {
    chunks: [
      {
        text: '',
        duration_ms: 22_000,
        positive_styles: [
          'understated documentary score',
          'solo felt piano',
          'sparse sustained notes',
          'warm low string pad',
          'slow tempo, 68 bpm',
          'contemplative and curious',
          'intimate close-miked recording',
        ],
        negative_styles: [...NO_VOICE, ...NOT_DRAMATIC, 'busy', 'sad'],
        context_adherence: 'high',
      },
      {
        text: '',
        duration_ms: 26_000,
        positive_styles: [
          'gentle pizzicato cello pulse',
          'felt piano figures',
          'soft ticking rhythm',
          'measured forward motion',
          'curious',
        ],
        negative_styles: [...NO_VOICE, ...NOT_DRAMATIC, 'tense'],
        context_adherence: 'high',
      },
      {
        text: '',
        duration_ms: 30_000,
        positive_styles: [
          'strings swell gently',
          'fuller warm arrangement',
          'open and expansive',
          'rising harmony',
          'restrained lift',
          'soft timpani roll',
        ],
        negative_styles: [...NO_VOICE, ...NOT_DRAMATIC, 'loud climax', 'heroic'],
        context_adherence: 'high',
      },
      {
        text: '',
        duration_ms: 27_000,
        positive_styles: [
          'return to solo felt piano',
          'settled major chord',
          'gentle resolution',
          'slow fade out',
          'ends on a held chord',
        ],
        negative_styles: [...NO_VOICE, ...NOT_DRAMATIC, 'abrupt ending'],
        context_adherence: 'high',
      },
    ],
  },
} as const

/**
 * Generated longer than it plays: the loop is cut from the steady middle,
 * clear of the intro and the fade-out the model writes, and its last 4 s
 * cross-fade into its first.
 */
export const AMBIENCE = {
  id: 'ambience-loop',
  use: 'Bed under the poster and between chapters; loops every 30 s',
  prompt:
    'Ambient underscore bed: soft sustained warm analogue pad in a low register, very slow movement, no melody, no rhythm, no percussion, steady level, calm and neutral, documentary room tone',
  generatedS: 48,
  window: { startS: 8, loopS: 30, fadeS: 4 },
} as const
