# Work item: EPIC-000.3 @devon/i18n: four locales, t(), terminology, transliterator

- **Epic:** EPIC-000   **Owner:** wp-frontend
- **Depends on:** EPIC-000.1   **Parallel-safe:** yes
- **Covers:** AC-3, AC-5
- **Class:** B

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `packages/i18n/package.json`
- `packages/i18n/src/**`
- `packages/i18n/terms.json`
- `packages/i18n/banned.json`
- `packages/i18n/TERMS.md`
- `packages/i18n/messages/uz-Latn.json`
- `packages/i18n/messages/uz-Cyrl.json`
- `packages/i18n/messages/ru.json`
- `packages/i18n/messages/en.json`
- `packages/i18n/test/**`
- `agentic/i18n.config.json`

## DOES NOT
- touch `apps/web` (EPIC-000.7 adds its own shell keys to the same four files afterward, sequentially, additive only)
- touch `agentic/scripts/check-i18n.mjs` (protected path; the gate is configured, never rewritten — ADR-012)

## Handoff contract
```ts
export const LOCALES = ['uz-Latn','uz-Cyrl','ru','en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'uz-Latn'
export const LOCALE_LABEL: Record<Locale,string>   // autonyms, own script
export const LOCALE_CHIP: Record<Locale,string>    // 'OʻZ' | 'ЎЗ' | 'RU' | 'EN'
export function t(key: string, params?: Record<string,string|number>): string
export function useT(): (key: string, params?: Record<string,string|number>) => string
export function formatDate(d: Date, locale: Locale, tz?: string): string   // DD.MM.YYYY
export function formatTime(d: Date, locale: Locale, tz?: string): string
export function formatNumber(n: number, locale: Locale): string
export function formatUzs(n: number, locale: Locale): string
export function normalizeUz(input: string): string
```
Seed the four message files with the full baseline keys from design.md §9.1–9.4 verbatim (shell, search, locale, demo, states, home, login/setup, admin) so EPIC-000.7 only ever adds, never invents, keys. Every `terms.json` row records `en`, `uzLatn`, `uzCyrl`, `ru`, and `source: {url, publisher, quote, fetchedAt}` — all required; `TERMS.md` is generated and committed, with a test asserting byte-identical regeneration.

## Done when
- gates profile `item` green, including `i18n` gate on HEAD
- `wp-reviewer` and `wp-a11y-i18n` have no open SEV1/SEV2 (a11y-i18n fetches ≥5 cited sources and checks shell strings against TERMS.md)
- evidence: `terms:verify` passes; three deliberate-breakage runs (missing ru key, missing uz-Cyrl key, hard-coded string) each fail `check-i18n.mjs`, then revert cleanly
