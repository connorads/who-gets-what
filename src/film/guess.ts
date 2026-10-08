/**
 * The reader's guess at how the money splits between the three groups: whole
 * percentages that always add up to 100. Moving one share takes from or gives
 * to the other two in proportion, so no handle ever pushes another off the
 * tape. The guess is kept on the reader's device only.
 */

export type Shares = readonly [number, number, number]

export const EVEN_GUESS: Shares = [34, 33, 33]

export const GUESS_KEY = 'wgw-film-guess'

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

/** Shares of `total` in proportion to `weights`, as whole numbers (largest remainder). */
function wholeShares(weights: readonly number[], total: number): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  const raw = weights.map((w) => (sum === 0 ? total / weights.length : (w / sum) * total))
  const out = raw.map(Math.floor)
  const order = raw
    .map((value, i) => ({ i, r: value - Math.floor(value) }))
    .toSorted((a, b) => b.r - a.r || a.i - b.i)
  for (let k = 0; k < total - out.reduce((s, v) => s + v, 0); k++) {
    const entry = order[k % order.length]
    if (entry !== undefined) out[entry.i] = (out[entry.i] ?? 0) + 1
  }
  return out
}

/** Set one group's share; the other two share the rest in their current proportion. */
export function setShare(shares: Shares, index: 0 | 1 | 2, value: number): Shares {
  const own = clamp(Math.round(value), 0, 100)
  const others = ([0, 1, 2] as const).filter((i) => i !== index)
  const rest = wholeShares(
    others.map((i) => shares[i]),
    100 - own,
  )
  const out: [number, number, number] = [0, 0, 0]
  out[index] = own
  others.forEach((i, k) => {
    out[i] = rest[k] ?? 0
  })
  return out
}

/** The two divider positions (0 to 100) along the tape. */
export function dividers(shares: Shares): readonly [number, number] {
  return [shares[0], shares[0] + shares[1]]
}

/** Shares from divider positions; the dividers keep their order. */
export function fromDividers(first: number, second: number): Shares {
  const a = clamp(Math.round(first), 0, 100)
  const b = clamp(Math.round(second), a, 100)
  return [a, b - a, 100 - b]
}

/** Move one divider, never past the other. */
export function moveDivider(shares: Shares, which: 0 | 1, position: number): Shares {
  const [first, second] = dividers(shares)
  return which === 0
    ? fromDividers(clamp(position, 0, second), second)
    : fromDividers(first, clamp(position, first, 100))
}

export function formatShare(share: number, decimals: number): string {
  return `${share.toFixed(decimals)}%`
}

/** The neutral comparison: what the reader guessed and what it is, with no adjective. */
export function guessSentence(guess: number, actual: number): string {
  return `You guessed ${formatShare(guess, 0)}. The real figure is ${formatShare(actual, 1)}.`
}

export interface StoredGuess {
  readonly shares: Shares
  readonly locked: boolean
}

export function parseStoredGuess(raw: string | null): StoredGuess | undefined {
  if (raw === null) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return undefined
    const shares: unknown = Reflect.get(value, 'shares')
    const locked: unknown = Reflect.get(value, 'locked')
    if (!Array.isArray(shares) || shares.length !== 3) return undefined
    const a: unknown = shares[0]
    const b: unknown = shares[1]
    const c: unknown = shares[2]
    if (typeof a !== 'number' || typeof b !== 'number' || typeof c !== 'number') return undefined
    if (![a, b, c].every((v) => Number.isInteger(v) && v >= 0 && v <= 100)) return undefined
    if (a + b + c !== 100) return undefined
    return { shares: [a, b, c], locked: locked === true }
  } catch {
    return undefined
  }
}

export function serialiseGuess(guess: StoredGuess): string {
  return JSON.stringify({ shares: guess.shares, locked: guess.locked })
}
