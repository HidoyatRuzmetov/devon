# Work item: EPIC-000.4 @devon/ui: tokens, primitives, state components, Storybook, fonts

- **Epic:** EPIC-000   **Owner:** wp-ui
- **Depends on:** EPIC-000.1   **Parallel-safe:** yes
- **Covers:** AC-6, AC-7
- **Class:** B

## TOUCHES (exhaustive; a diff outside this list is a FAIL)
- `packages/ui/package.json`
- `packages/ui/src/**`
- `packages/ui/.storybook/**`
- `packages/ui/public/fonts/**`

## DOES NOT
- touch `apps/web` (EPIC-000.7 consumes these components; it does not modify package internals)
- touch `packages/i18n` message files

## Handoff contract
```tsx
<StateView
  kind={'empty'|'loading'|'error'|'forbidden'|'offline'}
  titleKey: string
  bodyKey: string
  action?: { labelKey: string; onAction: () => void }   // exactly one primary action, data-primary
/>
```
New component `OfflineBanner` (design.md §8.6: single-action rule — banner carries its own action only when the route still has cached content, else the state block below carries the single action). New pattern `NavRegistry`: `{ id, labelKey, icon, route, visibleWhen }[]`. Every shell label carries `data-shell-label`. No `truncate`/`text-overflow: ellipsis` anywhere in `packages/ui/src/shell/**` — enforce with a package-local lint rule. Self-hosted `woff2` subsets MUST cover U+02B0–02FF (Spacing Modifier Letters, for `Oʻ Gʻ ʼ`), U+0400–04FF and U+0500–052F (Cyrillic + Supplement for `ў ғ қ ҳ`). Storybook ships the glyph page and the formatting page per design.md §12.F, with a `data-font-loaded` attribute for `document.fonts.check()`.

## Done when
- gates profile `item` green
- `wp-reviewer` has no open SEV1/SEV2
- evidence: Storybook glyph page renders without tofu/substitution; `<StateView>` unit test asserts exactly one `data-primary` element per kind
