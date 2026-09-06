// Locale control for a test (design.md §4.3's resolution order: user record -> localStorage ->
// Accept-Language -> `uz-Latn`). `apps/web/src/lib/locale-boot.ts`'s `bootLocale()` reads
// `localStorage['devon_locale']` before the cookie, so setting that key via `addInitScript` (runs
// before any page script, including `main.tsx`'s `bootLocale()`) is the one reliable way to land on a
// given locale on first paint, with no click and no flash of the wrong language to race against.
import type { Page } from '@playwright/test'

export const LOCALE_STORAGE_KEY = 'devon_locale'

export type TestLocale = 'uz-Latn' | 'uz-Cyrl' | 'ru' | 'en'

/** Must be called before `page.goto(...)` (or on the same `page`/context before its first
 * navigation) -- an `addInitScript` registered after a page already loaded only applies to the next
 * navigation, not the current document. */
export async function presetLocale(page: Page, locale: TestLocale): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    LOCALE_STORAGE_KEY,
    locale,
  ] as const)
}
