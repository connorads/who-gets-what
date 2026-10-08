import { z } from 'zod/mini'
import { err, ok, type Result } from './result.ts'

/** Geography levels the app publishes. Each value is also its URL segment. */
export const GeoLevel = z.enum(['constituency', 'local-authority'])
export type GeoLevel = z.infer<typeof GeoLevel>

/** The one boundary set each level uses. Mixing boundary sets is never valid. */
export const BOUNDARY_SET = {
  constituency: 'PCON24',
  'local-authority': 'LAD23',
} as const satisfies Record<GeoLevel, string>
export type BoundarySet = (typeof BOUNDARY_SET)[GeoLevel]

/** Great Britain only. Northern Ireland is out of scope and labelled as such. */
export const Nation = z.enum(['england', 'wales', 'scotland'])
export type Nation = z.infer<typeof Nation>

/** GSS entity codes that belong to each level (first three characters). */
const ENTITY_CODES = {
  constituency: ['E14', 'W07', 'S14'],
  'local-authority': ['E06', 'E07', 'E08', 'E09', 'W06', 'S12'],
} as const satisfies Record<GeoLevel, readonly string[]>

/** A GB GSS code: nation letter plus eight digits. */
export const AreaCode = z
  .string()
  .check(z.regex(/^[ESW]\d{8}$/))
  .brand<'AreaCode'>()
export type AreaCode = z.infer<typeof AreaCode>

/** Lower-case ASCII words joined by single hyphens. */
export const Slug = z
  .string()
  .check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
  .brand<'Slug'>()
export type Slug = z.infer<typeof Slug>

export interface InvalidAreaCode {
  readonly kind: 'invalid-area-code'
  readonly input: string
  readonly level: GeoLevel
}

export interface InvalidAreaSegment {
  readonly kind: 'invalid-area-segment'
  readonly input: string
}

/** Parse a GSS code and check that it names an area of `level`. */
export function parseAreaCode(input: string, level: GeoLevel): Result<AreaCode, InvalidAreaCode> {
  const parsed = AreaCode.safeParse(input)
  const entity = input.slice(0, 3)
  const entities: readonly string[] = ENTITY_CODES[level]
  if (!parsed.success || !entities.includes(entity)) {
    return err({ kind: 'invalid-area-code', input, level })
  }
  return ok(parsed.data)
}

export function nationOf(code: AreaCode): Nation {
  const letter = code.charAt(0)
  if (letter === 'E') return 'england'
  if (letter === 'W') return 'wales'
  return 'scotland'
}

export interface AreaSegment {
  readonly code: AreaCode
  readonly slug: Slug
}

/**
 * Parse the `{code}-{slug}` URL segment of an area page. The slug is cosmetic:
 * the route redirects to the canonical slug from the area metadata.
 */
export function parseAreaSegment(
  input: string,
  level: GeoLevel,
): Result<AreaSegment, InvalidAreaCode | InvalidAreaSegment> {
  const dash = input.indexOf('-')
  const codePart = dash === -1 ? input : input.slice(0, dash)
  const code = parseAreaCode(codePart.toUpperCase(), level)
  if (!code.ok) return code
  const slug = Slug.safeParse(dash === -1 ? '' : input.slice(dash + 1))
  if (!slug.success) return err({ kind: 'invalid-area-segment', input })
  return ok({ code: code.value, slug: slug.data })
}

export function formatAreaSegment(segment: AreaSegment): string {
  return `${segment.code}-${segment.slug}`
}
