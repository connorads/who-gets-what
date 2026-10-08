import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * False on the server and during hydration, true once React has hydrated.
 * Markup that only the browser needs (a control that runs script, detail
 * the server leaves out to keep the HTML small) renders after it, without a
 * hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
