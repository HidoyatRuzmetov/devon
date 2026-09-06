# Work item: EPIC-000.7 @devon/web: AppFrame shell, locale switch, command palette, states, offline banner

- **Epic:** EPIC-000   **Owner:** wp-frontend
- **Depends on:** EPIC-000.3, EPIC-000.4, EPIC-000.5   **Parallel-safe:** no
- **Covers:** AC-4, AC-6, AC-7, AC-8
- **Class:** B

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `apps/web/package.json`
- `apps/web/src/**`
- `apps/web/test/**`
- `packages/i18n/messages/uz-Latn.json`
- `packages/i18n/messages/uz-Cyrl.json`
- `packages/i18n/messages/ru.json`
- `packages/i18n/messages/en.json`

## DOES NOT
- modify `packages/ui` or `packages/i18n` source (only adds new leaf keys to the four message JSON files, additive only, same commit as the component using them)
- modify `packages/contracts` or `packages/db`
- touch `e2e/**` (that is EPIC-000.9)

## Handoff contract
Routes this epic: `/`, `/login`, `/setup`, `/admin`, `/404` — implement per design.md §6 (copy, states, one primary action each, no confirm dialogs). Locale switch: top-bar `IconButton` (globe + chip) → click 1 opens menu, click 2 selects — 2 clicks from every shell screen including `/login` and `/setup` at 390px. Persistence: signed in → `PATCH /api/v1/me {locale}`; signed out → `wp_locale` cookie, 1 year, SameSite=Lax; resolution order user record → localStorage → `Accept-Language` → `uz-Latn`. Command palette: field-shaped trigger reading `t('search.trigger')` with a platform-detected `<Kbd>` rendered inside it — never icon-only. States: `<StateView>` from `@devon/ui` for every route; forcing via `?__state=empty|loading|error|forbidden|offline`, compiled out unless `DEVON_E2E=1`. Demo chip renders only from the server bootstrap payload (`instance.isDemo`), never a client env var. Every shell network request must be same-origin — no external font/CDN/analytics call.

## Done when
- gates profile `item` green (including `i18n` — all four message files updated together)
- `wp-reviewer` and `wp-a11y-i18n` have no open SEV1/SEV2
- evidence: locale switch e2e-smoke passes with click-count assertion; StateView renders exactly one primary action per forced state
