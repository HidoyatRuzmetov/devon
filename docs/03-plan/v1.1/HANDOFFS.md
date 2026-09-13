# v1.1 cross-package handoffs (collected from the six package reports, 2026-09-13)

Items each package could not finish because the code lives outside its allowed paths. All must be
closed before v1.1 is called done; the integrate/critique/fix stages check them, and anything left is
run as a dedicated pass.

| # | Item | Owner path | Source |
|---|---|---|---|
| 1 | **Command palette leaks head-only destinations**: `apps/web/src/shell/command-palette-controller.tsx` calls `resolveNavEntries` without `can`, so people-table, department settings etc. appear for members. Gate every palette entry on its declared action. | shell | custom-fields report |
| 2 | Ctrl+K semantic search section: wire `useDepartmentSearchQuery` + `SearchHitRow` (features/ai) into the palette as a "Qidiruv" section with the L2 backend badge; keep `ai.ask` / `ai.search` deep links. | shell | ai-refit report |
| 3 | Daily batched notification to the head when members fill requested fields (SPEC §5): a pg-boss job in the notifications module reading `fields.value.set` events since the last digest. | notifications | custom-fields report |
| 4 | People table column picker and bulk "ask to fill" for custom person fields: the people table was built against `CustomFieldsPort`; confirm the fields module's real port is bound after the merge and the columns/bulk action work end to end. | people + fields | head-console report |
| 5 | `workloadHours` indicator stays null until estimates exist: estimates now ship (work-plus); bind the indicator to `estimate_min` and capacity so the people table Yuklama column and the person page show hours, not only counts. | people + work | head-console report |
| 6 | Head dashboard tiles "Maqsadlar" (goals) and "AI xulosa" (catch-up briefing) were left to the goals and AI packages: confirm both tiles render real data after the merge. | home + work + ai | head-console report |
| 7 | Verify the real AI provider end to end with the key in `.env`: `/ai` shows configured, a real model answer with a real cost line, no "Namunaviy javob" strip; the embeddings probe result is recorded in the settings screen. | ai | walkthrough + CTO |
| 8 | Verify the real Telegram bot with the token and username in `.env`: linking, an individual notify-to-fill message with the Toʻldirish button, and the Mini App launch button. | telegram | CTO |
