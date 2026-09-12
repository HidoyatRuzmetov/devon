// Theme store (spec.md §4.5: light / dark / system). Not a React Context, for the same reason
// `@devon/i18n`'s locale store isn't one -- `t()`-style plain reads outside components and a single
// subscription list. Applies `data-theme="light"|"dark"` to `<html>` (packages/ui/src/styles/tokens.css
// re-themes every `--color-*` custom property under that attribute selector).
import { useSyncExternalStore } from 'react'
import { THEME_STORAGE_KEY } from './constants.js'

export type ThemePreference = 'light' | 'dark' | 'system'

const listeners = new Set<() => void>()
let current: ThemePreference = 'system'

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  )
}

function apply(pref: ThemePreference): void {
  if (typeof document === 'undefined') return
  const resolved = pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
  document.documentElement.setAttribute('data-theme', resolved)
}

export function getThemePreference(): ThemePreference {
  return current
}

export function setThemePreference(pref: ThemePreference): void {
  current = pref
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // Storage disabled (private mode) -- the in-memory value still drives this session.
  }
  apply(pref)
  for (const listener of listeners) listener()
}

/** Read once on boot (`main.tsx`), before the first paint, so there is no flash of the wrong theme. */
function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    return null
  }
}

export function bootTheme(): void {
  const stored = readStoredTheme()
  // v1.1 (WALKTHROUGH-FINDINGS §5.5): a first visit with nothing stored resolves to **light**, not
  // to `system`. DESIGN.md §1's warm-paper light theme is the product's own look, and the machines
  // this runs on are frequently set to dark by whoever installed them -- so the first impression was
  // a dark login screen nobody chose. `system` remains a first-class option in the theme toggle; it
  // is simply no longer what "I have not decided" means.
  current =
    stored === 'light' || stored === 'dark' || stored === 'system' ? (stored as ThemePreference) : 'light'
  apply(current)
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current === 'system') apply(current)
  })
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, () => 'system')
}

/** The *resolved* theme (`'system'` collapsed to whichever of light/dark it currently means) -- for
 * anything that computes an actual colour value at render time (a label chip's contrast-guaranteed
 * foreground/background pair) rather than just applying a CSS class. Reactive to both an explicit
 * preference change and the OS-level `prefers-color-scheme` flipping while `current === 'system'`. */
export function useIsDarkTheme(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const unsubPreference = subscribe(callback)
      const mql = window.matchMedia?.('(prefers-color-scheme: dark)')
      mql?.addEventListener('change', callback)
      return () => {
        unsubPreference()
        mql?.removeEventListener('change', callback)
      }
    },
    () => (current === 'system' ? systemPrefersDark() : current === 'dark'),
    () => false,
  )
}
