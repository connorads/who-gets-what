/**
 * `pnpm run audio:build`: generate the film's narration, sound cues and score
 * with ElevenLabs, master them to fixed loudness and write public/audio/ with
 * its manifest.json. docs/film/audio.md has the settings and costs.
 *
 *   pnpm run audio:build                      everything
 *   pnpm run audio:build -- --only sfx,score  some kinds; the manifest keeps the rest
 *   pnpm run audio:build -- --offline         cached responses only; fails on a cache miss
 *
 * Needs ELEVENLABS_API_KEY for any uncached request, and ffmpeg with libopus.
 * Responses are cached in node_modules/.cache/audio (AUDIO_CACHE_DIR overrides).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod/mini'
import { captionWords, spokenText } from './alignment.ts'
import { createClient, type ApiResult, type Client } from './elevenlabs.ts'
import {
  bytes,
  crossfadeLoop,
  durationMs,
  encode,
  master,
  measure,
  type Encoding,
  type Source,
} from './ffmpeg.ts'
import { heardBeside, readFilmAudio, type Beat, type FilmAudio } from './script.ts'
import {
  AMBIENCE,
  ENCODING,
  MUSIC_MODEL,
  NO_NEXT_TEXT,
  NO_PREVIOUS_TEXT,
  RESEED,
  SCORE,
  SEED_ORDER,
  SFX,
  SFX_MODEL,
  STANDALONE,
  TARGET_LUFS,
  type SfxCue,
  VOICE,
} from './spec.ts'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OUT = join(ROOT, 'public', 'audio')
const CACHE = process.env['AUDIO_CACHE_DIR'] ?? join(ROOT, 'node_modules', '.cache', 'audio')
const LICENCE =
  'Generated with ElevenLabs on a paid plan; used under the ElevenLabs Terms of Service'

const KINDS = ['narration', 'sfx', 'score'] as const
type Group = (typeof KINDS)[number]
type Kind = 'narration' | 'sfx' | 'score' | 'ambience'

interface Provenance {
  readonly provider: 'ElevenLabs'
  readonly endpoint: string
  readonly modelId: string
  readonly prompt: unknown
  readonly settings?: Record<string, unknown>
  readonly voiceId?: string
  readonly voiceName?: string
  readonly credits: number | null
}

interface ManifestItem {
  readonly id: string
  readonly kind: Kind
  /** Opus in WebM, the file to try first. */
  readonly file: string
  /** AAC-LC in MP4, for browsers without WebM Opus. */
  readonly fallback: string
  readonly durationMs: number
  readonly loop: boolean
  readonly bytes: { readonly webm: number; readonly m4a: number }
  readonly loudness: {
    readonly targetLufs: number
    readonly lufs: number
    readonly truePeakDbtp: number
  }
  readonly use?: string
  readonly chapter?: string
  /** Spoken words, audio tags removed. */
  readonly text?: string
  /** Word and character timings for captions. */
  readonly captions?: string
  readonly licence: string
  readonly source: Provenance
}

// Keys in ManifestItem order: zod writes declared keys first, so a re-read item keeps its layout.
const Manifest = z.object({ items: z.array(z.looseObject({ id: z.string(), kind: z.string() })) })

const TtsResponse = z.object({
  audio_base64: z.string(),
  alignment: z.object({
    characters: z.array(z.string()),
    character_start_times_seconds: z.array(z.number()),
    character_end_times_seconds: z.array(z.number()),
  }),
})

const groupOf = (kind: string): Group | undefined =>
  kind === 'ambience' ? 'score' : KINDS.find((group) => group === kind)

function sourceOf(
  endpoint: string,
  modelId: string,
  prompt: unknown,
  result: ApiResult,
  extra: Partial<Provenance> = {},
): Provenance {
  return {
    provider: 'ElevenLabs',
    endpoint,
    modelId,
    prompt,
    ...extra,
    credits: result.credits ?? null,
  }
}

/** Master, encode and measure one sound into public/audio/<dir>/<id>. */
function publish(
  work: string,
  source: Source,
  kind: Kind,
  id: string,
  dir: string,
  encoding: Encoding,
): Pick<ManifestItem, 'file' | 'fallback' | 'durationMs' | 'bytes' | 'loudness'> {
  const target = TARGET_LUFS[kind]
  const mastered = join(work, `${kind}-${id}.wav`)
  master(source, target, encoding.channels, mastered)
  mkdirSync(join(OUT, dir), { recursive: true })
  const base = join(OUT, dir, id)
  encode(mastered, base, encoding)
  const loudness = measure({ kind: 'file', path: `${base}.webm` })
  return {
    file: `/audio/${dir}/${id}.webm`,
    fallback: `/audio/${dir}/${id}.m4a`,
    durationMs: durationMs(`${base}.webm`),
    bytes: { webm: bytes(`${base}.webm`), m4a: bytes(`${base}.m4a`) },
    loudness: { targetLufs: target, ...loudness },
  }
}

/** The text the voice reads: the script's words, behind the default direction tag unless the beat has its own. */
const performed = (beat: Beat): string =>
  beat.text.includes('[') ? beat.text : `${VOICE.direction} ${beat.text}`

/** Request fields for the words heard either side, and which beats they came from. */
function stitching(
  beats: readonly Beat[],
  index: number,
): { fields: { previous_text?: string; next_text?: string }; from: Record<string, string | null> } {
  const heard = heardBeside(beats, index)
  const id = beats[index]?.id ?? ''
  const previous = NO_PREVIOUS_TEXT.has(id) ? undefined : heard.previous
  const next = NO_NEXT_TEXT.has(id) ? undefined : heard.next
  return {
    fields: {
      ...(previous === undefined ? {} : { previous_text: spokenText(previous.text) }),
      ...(next === undefined ? {} : { next_text: spokenText(next.text) }),
    },
    from: { previous: previous?.id ?? null, next: next?.id ?? null },
  }
}

function seedOf(id: string): number {
  const index = SEED_ORDER.indexOf(id)
  if (index < 0) throw new Error(`beat ${id} has no place in SEED_ORDER in spec.ts`)
  return RESEED.get(id) ?? VOICE.seed + index
}

/** One beat, stitched to its neighbours' words so the read carries across files. */
async function narrate(
  client: Client,
  work: string,
  beats: readonly Beat[],
  index: number,
): Promise<ManifestItem> {
  const beat = beats[index]
  if (beat === undefined) throw new Error(`no beat ${index}`)
  const endpoint = `/v1/text-to-speech/${VOICE.id}/with-timestamps?output_format=pcm_48000`
  const stitched = stitching(beats, index)
  const body = {
    text: performed(beat),
    model_id: VOICE.modelId,
    language_code: 'en',
    voice_settings: VOICE.settings,
    seed: seedOf(beat.id),
    ...stitched.fields,
  }
  const result = await client.post(endpoint, body)
  const response = TtsResponse.parse(JSON.parse(result.bytes.toString('utf8')))
  const pcm = join(work, `${beat.id}.pcm`)
  writeFileSync(pcm, Buffer.from(response.audio_base64, 'base64'))
  const audio = publish(
    work,
    { kind: 'pcm', path: pcm, rate: 48_000, channels: 1 },
    'narration',
    beat.id,
    'narration',
    ENCODING.narration,
  )
  const { alignment } = response
  const captions = {
    id: beat.id,
    text: spokenText(beat.text),
    words: captionWords(alignment),
    characters: {
      text: alignment.characters.join(''),
      startMs: alignment.character_start_times_seconds.map((s) => Math.round(s * 1000)),
      endMs: alignment.character_end_times_seconds.map((s) => Math.round(s * 1000)),
    },
  }
  writeFileSync(join(OUT, 'narration', `${beat.id}.json`), `${JSON.stringify(captions)}\n`)
  console.error(`narration ${beat.id}: ${audio.durationMs} ms${result.cached ? ' (cached)' : ''}`)
  return {
    id: beat.id,
    kind: 'narration',
    chapter: beat.chapter,
    ...audio,
    loop: false,
    text: captions.text,
    captions: `/audio/narration/${beat.id}.json`,
    licence: LICENCE,
    source: sourceOf(
      'POST /v1/text-to-speech/{voice_id}/with-timestamps',
      VOICE.modelId,
      body.text,
      result,
      {
        voiceId: VOICE.id,
        voiceName: VOICE.name,
        settings: {
          ...VOICE.settings,
          seed: body.seed,
          stitchedTo: stitched.from,
        },
      },
    ),
  }
}

function buildNarration(
  client: Client,
  work: string,
  { beats }: FilmAudio,
): Promise<ManifestItem[]> {
  mkdirSync(join(OUT, 'narration'), { recursive: true })
  return Promise.all(beats.map((_, index) => narrate(client, work, beats, index)))
}

async function buildCue(client: Client, work: string, cue: SfxCue): Promise<ManifestItem> {
  const endpoint = '/v1/sound-generation?output_format=pcm_48000'
  const settings = {
    duration_seconds: cue.seconds,
    prompt_influence: cue.influence,
    loop: cue.loop,
  }
  const result = await client.post(endpoint, {
    text: cue.prompt,
    model_id: SFX_MODEL,
    ...settings,
  })
  const raw = join(work, `sfx-${cue.id}.pcm`)
  writeFileSync(raw, result.bytes)
  const audio = publish(
    work,
    { kind: 'pcm', path: raw, rate: 48_000, channels: 2 },
    'sfx',
    cue.id,
    'sfx',
    ENCODING.sfx,
  )
  console.error(`sfx ${cue.id}: ${audio.durationMs} ms${result.cached ? ' (cached)' : ''}`)
  return {
    id: cue.id,
    kind: 'sfx',
    ...audio,
    loop: cue.loop,
    use: cue.use,
    licence: LICENCE,
    source: sourceOf('POST /v1/sound-generation', SFX_MODEL, cue.prompt, result, { settings }),
  }
}

function buildSfx(client: Client, work: string, { cues }: FilmAudio): Promise<ManifestItem[]> {
  const missing = cues.filter((id) => !SFX.some((cue) => cue.id === id))
  if (missing.length > 0) throw new Error(`no prompt in spec.ts for cue ${missing.join(', ')}`)
  return Promise.all(
    SFX.filter((cue) => cues.includes(cue.id)).map((cue) => buildCue(client, work, cue)),
  )
}

async function buildScore(client: Client, work: string): Promise<ManifestItem[]> {
  const endpoint = '/v1/music?output_format=mp3_48000_320'
  const [score, bed] = await Promise.all([
    client.post(endpoint, { composition_plan: SCORE.plan, model_id: MUSIC_MODEL }),
    client.post(endpoint, {
      prompt: AMBIENCE.prompt,
      music_length_ms: AMBIENCE.generatedS * 1000,
      force_instrumental: true,
      model_id: MUSIC_MODEL,
    }),
  ])
  const scoreRaw = join(work, 'score.mp3')
  const bedRaw = join(work, 'ambience.mp3')
  writeFileSync(scoreRaw, score.bytes)
  writeFileSync(bedRaw, bed.bytes)
  const bedLoop = join(work, 'ambience-loop.wav')
  crossfadeLoop({ kind: 'file', path: bedRaw }, AMBIENCE.window, bedLoop)
  return [
    {
      id: SCORE.id,
      kind: 'score',
      ...publish(
        work,
        { kind: 'file', path: scoreRaw },
        'score',
        SCORE.id,
        'score',
        ENCODING.score,
      ),
      loop: false,
      use: SCORE.use,
      licence: LICENCE,
      source: sourceOf('POST /v1/music', MUSIC_MODEL, SCORE.plan, score),
    },
    {
      id: AMBIENCE.id,
      kind: 'ambience',
      ...publish(
        work,
        { kind: 'file', path: bedLoop },
        'ambience',
        AMBIENCE.id,
        'score',
        ENCODING.ambience,
      ),
      loop: true,
      use: AMBIENCE.use,
      licence: LICENCE,
      source: sourceOf('POST /v1/music', MUSIC_MODEL, AMBIENCE.prompt, bed, {
        settings: {
          music_length_ms: AMBIENCE.generatedS * 1000,
          force_instrumental: true,
          loopWindow: AMBIENCE.window,
        },
      }),
    },
  ]
}

const BUILDERS: Record<
  Group,
  (client: Client, work: string, film: FilmAudio) => Promise<ManifestItem[]>
> = {
  narration: buildNarration,
  sfx: buildSfx,
  score: buildScore,
}

function previousItems(groups: ReadonlySet<Group>): { readonly kind: string }[] {
  const path = join(OUT, 'manifest.json')
  if (!existsSync(path)) return []
  const { items } = Manifest.parse(JSON.parse(readFileSync(path, 'utf8')))
  return items.filter((item) => {
    const group = groupOf(item.kind)
    return group === undefined || !groups.has(group)
  })
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    // pnpm 11 passes the `--` of `pnpm run audio:build -- --only sfx` through.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { only: { type: 'string' }, offline: { type: 'boolean', default: false } },
  })
  const requested = values.only?.split(',') ?? [...KINDS]
  const groups = new Set(
    requested.map((name) => {
      const group = KINDS.find((kind) => kind === name)
      if (group === undefined) throw new Error(`unknown kind ${name}; use ${KINDS.join(', ')}`)
      return group
    }),
  )
  const film = readFilmAudio(join(ROOT, 'src', 'film', 'script.json'), STANDALONE)
  const client = createClient(CACHE, values.offline)
  const work = mkdtempSync(join(tmpdir(), 'wgw-audio-'))
  try {
    const chosen = KINDS.filter((group) => groups.has(group))
    for (const group of chosen) rmSync(join(OUT, group), { recursive: true, force: true })
    const built = (
      await Promise.all(chosen.map((group) => BUILDERS[group](client, work, film)))
    ).flat()
    // Group order, whichever kinds this run built, so a partial build writes the same manifest.
    const rank = (kind: string): number => KINDS.indexOf(groupOf(kind) ?? 'score')
    const items = [...previousItems(groups), ...built].toSorted(
      (a, b) => rank(a.kind) - rank(b.kind),
    )
    const manifest = {
      description:
        'Film audio: narration per beat, sound cues and score. Built by `pnpm run audio:build`; see docs/film/audio.md.',
      voice: { id: VOICE.id, name: VOICE.name, modelId: VOICE.modelId },
      items,
    }
    writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    // Write the JSON as the oxfmt hook checks it.
    execFileSync(join(ROOT, 'node_modules', '.bin', 'oxfmt'), [OUT], { stdio: 'ignore' })
    const credits = built.reduce((sum, item) => sum + (item.source.credits ?? 0), 0)
    console.error(`${built.length} sounds built; their requests cost ${credits} credits`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

await main()
