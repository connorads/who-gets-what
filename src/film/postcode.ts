/**
 * Postcode to constituency through api.postcodes.io, which publishes ONS
 * postcode data under the Open Government Licence. Only the outward call
 * leaves the browser; nothing is stored.
 */

export type PostcodeResult =
  | {
      readonly kind: 'found'
      readonly postcode: string
      readonly code: string
      /** The constituency's name as postcodes.io gives it. */
      readonly name: string
    }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'not-found'; readonly postcode: string }
  | { readonly kind: 'not-covered'; readonly postcode: string; readonly country: string }
  | { readonly kind: 'unavailable' }

/** UK postcode shape: outward code, space, inward code. */
const POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})$/

/** Upper-case with one space before the inward code, or undefined when it cannot be a postcode. */
export function normalisePostcode(input: string): string | undefined {
  const match = POSTCODE.exec(input.toUpperCase().replace(/\s+/g, ''))
  return match === null ? undefined : `${match[1] ?? ''} ${match[2] ?? ''}`
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined

/** Read a `/postcodes/{postcode}` response. */
export function parsePostcodeResponse(
  postcode: string,
  status: number,
  body: unknown,
): PostcodeResult {
  if (status === 404) return { kind: 'not-found', postcode }
  if (status !== 200) return { kind: 'unavailable' }
  const result = field(body, 'result')
  const code = field(field(result, 'codes'), 'parliamentary_constituency_2024')
  const country = field(result, 'country')
  const name = field(result, 'parliamentary_constituency_2024')
  if (typeof code === 'string' && /^[ESW]\d{8}$/.test(code)) {
    return { kind: 'found', postcode, code, name: typeof name === 'string' ? name : code }
  }
  return {
    kind: 'not-covered',
    postcode,
    country: typeof country === 'string' ? country : 'this area',
  }
}

export async function lookupPostcode(
  input: string,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
  signal?: AbortSignal,
): Promise<PostcodeResult> {
  const postcode = normalisePostcode(input)
  if (postcode === undefined) return { kind: 'invalid' }
  try {
    const response = await fetcher(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`,
      signal === undefined ? {} : { signal },
    )
    const body: unknown = response.status === 200 ? await response.json() : undefined
    return parsePostcodeResponse(postcode, response.status, body)
  } catch {
    return { kind: 'unavailable' }
  }
}

/** The sentence a reader sees for a result that is not a constituency. */
export function postcodeMessage(result: Exclude<PostcodeResult, { kind: 'found' }>): string {
  if (result.kind === 'invalid')
    return 'That does not look like a UK postcode. Try the form SW1A 1AA.'
  if (result.kind === 'not-found') {
    return `No postcode ${result.postcode} was found. Check it and try again.`
  }
  if (result.kind === 'not-covered') {
    return `${result.postcode} is in ${result.country}, which this site does not cover yet.`
  }
  return 'The postcode lookup did not answer. Try again, or find your area by name.'
}
