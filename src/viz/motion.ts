/**
 * Motion timings for the explorer, from the creative direction's tiers.
 * Durations are constant: they never scale with how far a mark moves, so
 * duration never encodes magnitude, and no ease overshoots its target.
 * Reduced motion replaces every flight with a cross-fade of 120 ms or less.
 */

export const MOTION = {
  /** A view change (hex, map, swarm, rank). */
  morph: 0.6,
  /** Four rulers: dots move to their new x when the denominator changes. */
  rulers: 0.8,
  /** Colour follows positions. */
  colour: 0.24,
  /** Bump lines redraw after the dots settle. */
  bump: 0.6,
  /** Pitch reveal and return for the skyline. */
  camera: 1.6,
  /** Reduced motion: the whole change as one cross-fade. */
  fade: 0.12,
} as const

/** Smooth in and out with no overshoot; GSAP's power2.inOut. */
export const EASE = 'power2.inOut'
export const CAMERA_EASE = 'power3.inOut'

export type ChangeKind = 'view' | 'rulers' | 'values' | 'colour' | 'none'

export interface Stage {
  readonly name: 'positions' | 'colour'
  readonly start: number
  readonly duration: number
}

/**
 * The staged plan for one change: positions first, then colour, so a mark
 * reaches its new place before it changes meaning. Reduced motion runs both
 * as one cross-fade.
 */
export function stagePlan(
  kind: ChangeKind,
  moves: boolean,
  recolours: boolean,
  reduced: boolean,
): readonly Stage[] {
  if (kind === 'none' || (!moves && !recolours)) return []
  if (reduced) return [{ name: 'positions', start: 0, duration: MOTION.fade }]
  const positions = kind === 'rulers' ? MOTION.rulers : MOTION.morph
  const stages: Stage[] = []
  if (moves) stages.push({ name: 'positions', start: 0, duration: positions })
  if (recolours) {
    stages.push({
      name: 'colour',
      start: moves ? positions : 0,
      duration: moves ? MOTION.colour : MOTION.colour * 1.5,
    })
  }
  return stages
}

/** When each part of the Four rulers sequence starts, in seconds after the change. */
export function rulersTimeline(reduced: boolean): {
  readonly bump: number
  readonly list: number
} {
  if (reduced) return { bump: 0, list: 0 }
  return { bump: MOTION.rulers, list: MOTION.rulers + MOTION.bump }
}
