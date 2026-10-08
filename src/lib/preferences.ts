/**
 * Reader preferences for colour scheme and motion. Each one follows the
 * operating system until the reader overrides it, persists in localStorage,
 * and lands on <html> before first paint through `PREFERENCES_INIT_SCRIPT`.
 */

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export type MotionMode = 'system' | 'reduce' | 'full'

export const THEME_KEY = 'wgw-theme'
export const MOTION_KEY = 'wgw-motion'
/** Fired on window after a preference changes in this tab. */
export const THEME_EVENT = 'wgw-theme-change'
export const MOTION_EVENT = 'wgw-motion-change'

export const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'
export const DARK_QUERY = '(prefers-color-scheme: dark)'

export function parseThemeMode(raw: unknown): ThemeMode {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

export function parseMotionMode(raw: unknown): MotionMode {
  return raw === 'reduce' || raw === 'full' ? raw : 'system'
}

export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  return mode
}

const NEXT_THEME: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' }

/** Light, then dark, then back to the system setting. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return NEXT_THEME[mode]
}

export function resolveReducedMotion(mode: MotionMode, systemReduce: boolean): boolean {
  if (mode === 'system') return systemReduce
  return mode === 'reduce'
}

/**
 * The mode the motion toggle stores when pressed. A choice that matches the
 * system setting stores `system`, so a later OS change still applies.
 */
export function toggleMotionMode(mode: MotionMode, systemReduce: boolean): MotionMode {
  const wantReduced = !resolveReducedMotion(mode, systemReduce)
  if (wantReduced === systemReduce) return 'system'
  return wantReduced ? 'reduce' : 'full'
}

/** `data-motion` value on <html>; absent means follow the media query in CSS. */
export function motionAttribute(mode: MotionMode): 'reduce' | 'full' | null {
  return mode === 'system' ? null : mode
}

/**
 * Inline, render-blocking script for <head>. It repeats the rules above in
 * plain ES5 because it runs before any bundle loads; a test runs it against
 * the functions above.
 */
export const PREFERENCES_INIT_SCRIPT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem('${THEME_KEY}');var m=(t==='light'||t==='dark')?t:'system';var r=m==='system'?(matchMedia('${DARK_QUERY}').matches?'dark':'light'):m;d.classList.remove('light','dark');d.classList.add(r);d.style.colorScheme=r;var x=localStorage.getItem('${MOTION_KEY}');if(x==='reduce'||x==='full'){d.setAttribute('data-motion',x)}else{d.removeAttribute('data-motion')}}catch(e){}})();`
