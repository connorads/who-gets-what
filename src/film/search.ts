/**
 * The film's URL parameters. `mode=read` opens Read mode; `frame` pins the
 * film at one point of its progress (0 to 1) for screenshots and tests;
 * `grain` picks the grain size for testing both tiers. Anything else is
 * dropped, so a bad link still opens the film.
 */
export interface FilmSearch {
  readonly mode?: 'read'
  readonly frame?: number
  readonly grain?: '1m' | '10m'
}

export function parseFilmSearch(raw: Readonly<Record<string, unknown>>): FilmSearch {
  const frame = Number(raw['frame'])
  return {
    ...(raw['mode'] === 'read' ? { mode: 'read' } : {}),
    ...(raw['frame'] !== undefined && Number.isFinite(frame) && frame >= 0 && frame <= 1
      ? { frame }
      : {}),
    ...(raw['grain'] === '1m' || raw['grain'] === '10m' ? { grain: raw['grain'] } : {}),
  }
}
