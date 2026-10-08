/**
 * The explorer's search keys, as the router reads them on every page. This
 * module imports nothing, so the main chunk carries no schema library:
 * `decodeExploreQuery` in `url-state.ts` checks the values inside the
 * explorer's lazily loaded loader.
 */

/** In canonical URL order. */
export const EXPLORE_KEYS = [
  'level',
  'metric',
  'denom',
  'basis',
  'period',
  'view',
  'sel',
  'vs',
] as const

export type ExploreKey = (typeof EXPLORE_KEYS)[number]

/** The explorer's search params as written, before decoding. */
export type ExploreSearch = { readonly [K in ExploreKey]?: string | undefined }

/** Keep the explorer's keys whose values are strings; drop the rest. */
export function exploreSearch(raw: Readonly<Record<string, unknown>>): ExploreSearch {
  const out: { [K in ExploreKey]?: string } = {}
  for (const key of EXPLORE_KEYS) {
    const value = raw[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}
