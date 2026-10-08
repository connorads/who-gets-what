import { useEffect, type ReactNode } from 'react'
import { applyThemeMode, useThemeMode } from '#/lib/preferences-dom.ts'
import { DARK_QUERY, nextThemeMode, type ThemeMode } from '#/lib/preferences.ts'

const LABEL: Record<ThemeMode, string> = {
  system: 'Theme follows the system',
  light: 'Light theme',
  dark: 'Dark theme',
}

// Lucide's monitor, sun and moon (ISC), drawn inline: the header is on every
// page, and lucide-react's icon factory would add its runtime to the main chunk.
const ICON: Record<ThemeMode, ReactNode> = {
  system: (
    <>
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  dark: (
    <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
  ),
}

export default function ThemeToggle() {
  const mode = useThemeMode()

  useEffect(() => {
    if (mode !== 'system') return undefined
    const media = window.matchMedia(DARK_QUERY)
    const follow = () => applyThemeMode('system')
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [mode])

  const next = nextThemeMode(mode)

  return (
    <button
      type="button"
      onClick={() => applyThemeMode(next)}
      aria-label={`${LABEL[mode]}. Switch to ${LABEL[next].toLowerCase()}.`}
      title={LABEL[mode]}
      className="pref-button"
    >
      <svg
        aria-hidden="true"
        className="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICON[mode]}
      </svg>
    </button>
  )
}
