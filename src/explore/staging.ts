/**
 * Four rulers staging. When only the denominator changes, the canvas moves
 * at once, the bump lines follow when the dots settle, and the top-10 lists
 * re-sort last inside a view transition. Any other change applies at once.
 * GSAP's clock schedules the steps, so the sequence shares the one timeline.
 */
import { gsap } from 'gsap'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Denominator } from '#/domain/measure.ts'
import type { ExploreState } from '#/domain/url-state.ts'
import { rulersTimeline } from '#/viz/motion.ts'
import { measureKey } from './model.ts'

export interface StagedDenominators {
  readonly bump: Denominator
  readonly list: Denominator
}

/** Run `update` inside a same-document view transition when the browser has one. */
export function withViewTransition(update: () => void, animate: boolean): void {
  if (!animate || typeof document.startViewTransition !== 'function') {
    update()
    return
  }
  document.startViewTransition(() => flushSync(update))
}

export function useStagedDenominators(state: ExploreState, reduced: boolean): StagedDenominators {
  const key = measureKey(state)
  const target = state.denominator
  const [staged, setStaged] = useState<StagedDenominators & { readonly key: string }>({
    key,
    bump: target,
    list: target,
  })
  const previous = useRef({ key, target })

  useEffect(() => {
    const before = previous.current
    previous.current = { key, target }
    if (before.key !== key) {
      setStaged({ key, bump: target, list: target })
      return undefined
    }
    if (before.target === target) return undefined
    const { bump, list } = rulersTimeline(reduced)
    const calls = [
      gsap.delayedCall(bump, () => setStaged((s) => ({ ...s, bump: target }))),
      gsap.delayedCall(list, () =>
        withViewTransition(() => setStaged((s) => ({ ...s, list: target })), !reduced),
      ),
    ]
    return () => {
      for (const call of calls) call.kill()
    }
  }, [key, target, reduced])

  // A new measure shows at once, before the effect above records it.
  return staged.key === key ? staged : { bump: target, list: target }
}
