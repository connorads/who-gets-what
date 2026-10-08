/**
 * Loudness, looping and encoding through the ffmpeg and ffprobe binaries.
 * Every master is 48 kHz; outputs are Opus in WebM with an AAC fallback.
 */
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'

/** How ffmpeg should read a source: raw PCM needs its layout spelled out. */
export type Source =
  | {
      readonly kind: 'pcm'
      readonly path: string
      readonly rate: number
      readonly channels: number
    }
  | { readonly kind: 'file'; readonly path: string }

export interface Loudness {
  /** Integrated loudness, EBU R128. */
  readonly lufs: number
  readonly truePeakDbtp: number
}

export interface Encoding {
  readonly channels: 1 | 2
  readonly opusKbps: number
  readonly aacKbps: number
}

/** Limiter ceiling, applied at 4x oversampling so it bounds true peak; lossy encoding adds up to about 2 dB. */
const PEAK_CEILING_DBFS = -2.5
const MAX_LIMITING_DB = 9

const inputArgs = (source: Source): string[] =>
  source.kind === 'pcm'
    ? ['-f', 's16le', '-ar', String(source.rate), '-ac', String(source.channels), '-i', source.path]
    : ['-i', source.path]

function ffmpeg(args: readonly string[]): string {
  return execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** ffmpeg writes filter reports to stderr, which execFileSync only returns on failure. */
function ffmpegReport(args: readonly string[]): string {
  return execFileSync('sh', ['-c', 'ffmpeg -hide_banner -nostdin "$@" 2>&1', 'ffmpeg', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

export function measure(source: Source): Loudness {
  const report = ffmpegReport([
    ...inputArgs(source),
    '-af',
    'ebur128=peak=true:framelog=quiet',
    '-f',
    'null',
    '-',
  ])
  const summary = report.slice(report.lastIndexOf('Summary:'))
  const lufs = Number(/I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1])
  const peak = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1])
  if (!Number.isFinite(lufs) || Number.isNaN(peak)) {
    throw new Error(`no loudness reading for ${source.path}`)
  }
  return { lufs, truePeakDbtp: peak }
}

/**
 * Write a 48 kHz WAV master as near the target loudness as its peaks allow:
 * one linear gain, then a limiter. A transient sound (a click, a patter)
 * would need heavy limiting to reach the target, so the limiter takes at most
 * MAX_LIMITING_DB and the sound stays quieter; the manifest records what it
 * reached. Linear gain keeps loops seamless.
 */
export function master(source: Source, targetLufs: number, channels: 1 | 2, out: string): void {
  // Measure after the downmix: folding wide stereo to mono lowers loudness by 3 to 6 dB.
  const resampled = `${out}.in.wav`
  ffmpeg([
    ...inputArgs(source),
    '-af',
    'aresample=48000',
    '-ac',
    String(channels),
    '-c:a',
    'pcm_s16le',
    resampled,
  ])
  const { lufs, truePeakDbtp } = measure({ kind: 'file', path: resampled })
  const maxGain = PEAK_CEILING_DBFS - truePeakDbtp + MAX_LIMITING_DB
  const ceiling = 10 ** (PEAK_CEILING_DBFS / 20)
  const limit = (gain: number): void => {
    ffmpeg([
      '-i',
      resampled,
      '-af',
      `aresample=192000,volume=${gain.toFixed(2)}dB,alimiter=limit=${ceiling.toFixed(3)}:level=false:attack=1:release=50:latency=true,aresample=48000`,
      '-c:a',
      'pcm_s16le',
      out,
    ])
  }
  const gain = Math.min(targetLufs - lufs, maxGain)
  limit(gain)
  // Limiting takes back some loudness; one more pass adds the shortfall.
  const shortfall = targetLufs - measure({ kind: 'file', path: out }).lufs
  if (shortfall > 0.2 && gain < maxGain) limit(Math.min(gain + shortfall, maxGain))
}

export interface LoopWindow {
  readonly startS: number
  /** Length of the finished loop. */
  readonly loopS: number
  readonly fadeS: number
}

/**
 * Cut a seamless loop from `startS` to `startS + loopS + fadeS`: the last
 * `fadeS` seconds cross-fade into the first, so the loop's end runs straight
 * into its start. Pick a window clear of the source's intro and fade-out.
 */
export function crossfadeLoop(
  source: Source,
  { startS, loopS, fadeS }: LoopWindow,
  out: string,
): void {
  const seam = startS + fadeS
  const end = startS + loopS
  ffmpeg([
    ...inputArgs(source),
    '-filter_complex',
    [
      `[0]aresample=48000,asplit=3[a][b][c]`,
      `[a]atrim=${startS}:${seam},asetpts=PTS-STARTPTS[head]`,
      `[b]atrim=${seam}:${end},asetpts=PTS-STARTPTS[body]`,
      `[c]atrim=${end}:${end + fadeS},asetpts=PTS-STARTPTS[tail]`,
      `[tail][head]acrossfade=d=${fadeS}:c1=qsin:c2=qsin[join]`,
      `[join][body]concat=n=2:v=0:a=1[out]`,
    ].join(';'),
    '-map',
    '[out]',
    '-c:a',
    'pcm_s16le',
    out,
  ])
}

const BITEXACT = ['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact']

/** Encode a master to `<base>.webm` (Opus) and `<base>.m4a` (AAC-LC). */
export function encode(wav: string, base: string, encoding: Encoding): void {
  const channels = String(encoding.channels)
  ffmpeg([
    '-i',
    wav,
    ...BITEXACT,
    '-ac',
    channels,
    '-c:a',
    'libopus',
    '-b:a',
    `${encoding.opusKbps}k`,
    '-vbr',
    'on',
    '-compression_level',
    '10',
    '-f',
    'webm',
    `${base}.webm`,
  ])
  ffmpeg([
    '-i',
    wav,
    ...BITEXACT,
    '-ac',
    channels,
    '-c:a',
    'aac',
    '-b:a',
    `${encoding.aacKbps}k`,
    '-movflags',
    '+faststart',
    `${base}.m4a`,
  ])
}

export function durationMs(path: string): number {
  const seconds = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
    { encoding: 'utf8' },
  )
  return Math.round(Number(seconds) * 1000)
}

export const bytes = (path: string): number => statSync(path).size
