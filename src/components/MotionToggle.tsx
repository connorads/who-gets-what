import {
  applyMotionMode,
  systemReduce,
  useMotionMode,
  useReducedMotion,
} from '#/lib/preferences-dom.ts'
import { toggleMotionMode } from '#/lib/preferences.ts'

/** Visible reduced-motion switch; it starts from the OS setting. */
export default function MotionToggle() {
  const mode = useMotionMode()
  const reduced = useReducedMotion()

  return (
    <button
      type="button"
      aria-pressed={reduced}
      onClick={() => applyMotionMode(toggleMotionMode(mode, systemReduce()))}
      title={reduced ? 'Motion reduced' : 'Full motion'}
      className="pref-button"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
        {reduced ? (
          <path d="M2 8h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
        ) : (
          <path
            d="M1.5 8c1.6-3.2 3.3-3.2 4.9 0s3.3 3.2 4.9 0 2.4-2.4 3.2-1.6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        )}
      </svg>
      <span className="sr-only">Reduce motion</span>
    </button>
  )
}
