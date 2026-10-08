import { useSyncExternalStore } from 'react'
import {
  DARK_QUERY,
  MOTION_EVENT,
  MOTION_KEY,
  REDUCE_QUERY,
  THEME_EVENT,
  THEME_KEY,
  motionAttribute,
  parseMotionMode,
  parseThemeMode,
  resolveReducedMotion,
  resolveTheme,
  type MotionMode,
  type ThemeMode,
} from './preferences.ts'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    if (value === 'system') window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

export const systemDark = () => window.matchMedia(DARK_QUERY).matches
export const systemReduce = () => window.matchMedia(REDUCE_QUERY).matches

export const storedThemeMode = () => parseThemeMode(read(THEME_KEY))
export const storedMotionMode = () => parseMotionMode(read(MOTION_KEY))

export function applyThemeMode(mode: ThemeMode) {
  const resolved = resolveTheme(mode, systemDark())
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.style.colorScheme = resolved
  write(THEME_KEY, mode)
  window.dispatchEvent(new Event(THEME_EVENT))
}

export function applyMotionMode(mode: MotionMode) {
  const attribute = motionAttribute(mode)
  const root = document.documentElement
  if (attribute === null) root.removeAttribute('data-motion')
  else root.setAttribute('data-motion', attribute)
  write(MOTION_KEY, mode)
  window.dispatchEvent(new Event(MOTION_EVENT))
}

function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia(REDUCE_QUERY)
  media.addEventListener('change', onChange)
  window.addEventListener(MOTION_EVENT, onChange)
  return () => {
    media.removeEventListener('change', onChange)
    window.removeEventListener(MOTION_EVENT, onChange)
  }
}

/**
 * Whether motion should be reduced, from the reader's toggle or the OS.
 * Server render and hydration assume full motion; CSS already holds the
 * reduced durations, so only JavaScript-driven motion waits for this.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => resolveReducedMotion(storedMotionMode(), systemReduce()),
    () => false,
  )
}

export function useMotionMode(): MotionMode {
  return useSyncExternalStore(subscribeMotion, storedMotionMode, () => 'system')
}

function subscribeTheme(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange)
  return () => window.removeEventListener(THEME_EVENT, onChange)
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, storedThemeMode, () => 'system')
}
