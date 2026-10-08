import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  MOTION_KEY,
  PREFERENCES_INIT_SCRIPT,
  THEME_KEY,
  motionAttribute,
  nextThemeMode,
  parseMotionMode,
  parseThemeMode,
  resolveReducedMotion,
  resolveTheme,
  toggleMotionMode,
  type MotionMode,
} from './preferences.ts'

const MODES: readonly MotionMode[] = ['system', 'reduce', 'full']

describe('reduced motion preference', () => {
  it('follows the system until the reader chooses', () => {
    expect(resolveReducedMotion('system', true)).toBe(true)
    expect(resolveReducedMotion('system', false)).toBe(false)
  })

  it('lets an explicit choice override the system', () => {
    expect(resolveReducedMotion('full', true)).toBe(false)
    expect(resolveReducedMotion('reduce', false)).toBe(true)
  })

  it.each(MODES.flatMap((mode) => [true, false].map((system) => [mode, system] as const)))(
    'toggling %s with system reduce %s flips the outcome',
    (mode, system) => {
      const before = resolveReducedMotion(mode, system)
      const after = resolveReducedMotion(toggleMotionMode(mode, system), system)

      expect(after).toBe(!before)
    },
  )

  it('stores system when the choice matches the OS, so later OS changes apply', () => {
    expect(toggleMotionMode('full', true)).toBe('system')
    expect(toggleMotionMode('reduce', false)).toBe('system')
    expect(toggleMotionMode('system', false)).toBe('reduce')
    expect(toggleMotionMode('system', true)).toBe('full')
  })

  it('parses unknown stored values as system', () => {
    expect(parseMotionMode(null)).toBe('system')
    expect(parseMotionMode('fast')).toBe('system')
    expect(parseMotionMode('reduce')).toBe('reduce')
  })

  it('sets the html attribute only for an explicit choice', () => {
    expect(motionAttribute('system')).toBeNull()
    expect(motionAttribute('reduce')).toBe('reduce')
    expect(motionAttribute('full')).toBe('full')
  })
})

describe('theme preference', () => {
  it('resolves system from the media query', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('cycles light, dark, system', () => {
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('system')
    expect(nextThemeMode('system')).toBe('light')
    expect(parseThemeMode('sepia')).toBe('system')
  })
})

/** Runs the inline head script against a minimal document and returns what it set. */
function runInitScript(stored: Record<string, string>, media: { dark: boolean; reduce: boolean }) {
  const classes = new Set<string>()
  const attributes = new Map<string, string>()
  const root = {
    classList: {
      add: (c: string) => classes.add(c),
      remove: (...cs: string[]) => cs.forEach((c) => classes.delete(c)),
    },
    setAttribute: (k: string, v: string) => attributes.set(k, v),
    removeAttribute: (k: string) => attributes.delete(k),
    style: { colorScheme: '' },
  }
  runInNewContext(PREFERENCES_INIT_SCRIPT, {
    document: { documentElement: root },
    localStorage: { getItem: (k: string) => stored[k] ?? null },
    matchMedia: (q: string) => ({ matches: q.includes('dark') ? media.dark : media.reduce }),
  })
  return {
    classes: [...classes],
    motion: attributes.get('data-motion') ?? null,
    scheme: root.style.colorScheme,
  }
}

const blockedStorage = () => {
  runInNewContext(PREFERENCES_INIT_SCRIPT, {
    document: { documentElement: {} },
    localStorage: {
      getItem: () => {
        throw new Error('blocked')
      },
    },
    matchMedia: () => ({ matches: false }),
  })
}

describe('PREFERENCES_INIT_SCRIPT', () => {
  it.each<[Record<string, string>, { dark: boolean; reduce: boolean }]>([
    [{}, { dark: true, reduce: false }],
    [{}, { dark: false, reduce: true }],
    [
      { [THEME_KEY]: 'light', [MOTION_KEY]: 'full' },
      { dark: true, reduce: true },
    ],
    [
      { [THEME_KEY]: 'dark', [MOTION_KEY]: 'reduce' },
      { dark: false, reduce: false },
    ],
    [
      { [THEME_KEY]: 'nonsense', [MOTION_KEY]: 'nonsense' },
      { dark: true, reduce: true },
    ],
  ])('agrees with the typed rules for stored %o and media %o', (stored, media) => {
    const theme = resolveTheme(parseThemeMode(stored[THEME_KEY]), media.dark)
    const motion = motionAttribute(parseMotionMode(stored[MOTION_KEY]))

    expect(runInitScript(stored, media)).toEqual({ classes: [theme], motion, scheme: theme })
  })

  it('leaves the page alone when storage throws', () => {
    expect(blockedStorage).not.toThrow()
  })
})
