# Deliverables, personal calendar, and assistant release

Status: implementation and local verification complete. PR #13 is awaiting final CI and production verification.

## Evidence so far (28 October)

- Restricted local pre-removal database dump: `backups/2026-10-28-before-retirement/devon.dump` (Git ignored), 2,382,639 bytes. SHA-256 `601404B45540E84CD727BDEFC9248ADB77B8FF2783D5FE01D972950AB34F0047`. Full restore into an isolated database succeeded: 4 private notes, 2 canvases, 587 cards, 14,483 audit events. Production deployment now stops writers, takes a new backup and proves full restore before running the contract migration. An image-only rollback after schema removal is refused.
- Real configured model, isolated synthetic Docker database: **27/27 scenarios passed**. See [assistant-candidate.json](assistant-candidate.json). Assertions verify persisted nested checklist rows, preserved completed items, duplicate prevention, linked projects/tasks/files, bulk recipients, calendar timezone changes, and check-in/source updates.
- Shared 17-case baseline: 696,131 total tokens; final candidate: 276,544 (**60.3% fewer**). The retired private-note privacy fixture is replaced by an equivalent private-calendar fixture; UUIDs and model responses vary. New compound workflows are additional scenarios, not included in this percentage. Full 27-case final run: 814,127 tokens. Cached-token compute is not inferred from billed-token estimates. Earlier repeated runs exposed invalid target identity and flattened create arguments; general typed validation/strict normalization now cover these. The result is evidence for these scenarios, not a guarantee for every possible prompt.
- The real-model runs exposed and drove fixes for forward action dependencies, referenced records excluded by content budgets, independently searched phrases, and JSON-encoded/misplaced explicit action arguments. These repairs preserve strict domain schemas and permissions; no identity is guessed.
- Full API suite: 1,095 tests passed; final affected AI/calendar tests: 36 passed, action normalization/identity tests: 18 passed. Telegram group mention unit/integration tests: 18 passed.
- Contracts: 690 passed after obsolete permission cases were removed (724 before cleanup). Web: 372 passed, with the affected timer/navigation tests rechecked (12 passed). Telegram Mini App: 35 passed. AI package: 186 passed. Database verifier: 1,004/1,004 checks plus 5 migration tests. Workspace types passed. Four-locale checks: zero errors; secrets: zero hits.
- Browser development: 41/45 initially passed; all four failures fixed and affected 6/6 rechecked, including head/member/superadmin/public accessibility. Compiled production journeys: 41/41 passed before the final sprite artwork, then 6/6 focused artwork/timer and all-role accessibility checks passed. All three image assets are decoded as part of the browser proof. Timer recovery/account-boundary checks: 12/12 passed.
- Release script regressions: 87 passed, 1 environment-dependent skip; deployment backup/rollback safeguards: 21 passed. Dependency cycles and URL architecture checks passed. Knip still reports prior unrelated exports; no claim of a clean Knip report.
- Pomodoro has no session history, weekly statistics, or task linkage. The expanded repertoire contains fifteen original ImageGen sequences with 24 frames each (360 frames), 5,158,990 total WebP bytes. Only the current/next story and completion load on entry; all assets have content-hashed URLs. See [artwork and generation prompts](../../design/pomodoro-artwork.md). A shuffled repertoire avoids repetition and varies between focus/breaks; animation is decorative, independent of timer accuracy, and disabled for reduced motion/hidden tabs/offscreen views.
- Follow-up local checks: database reset coverage 62/62, deterministic helper evaluations 81/81, animation/realtime 27/27, private calendar publication 12/12. Local repository Semgrep rules: zero findings (one parser warning in the existing analytics type). Check-in and calendar refreshes use realtime invalidation; private calendar events publish only to the owner's channel with no content.
- Final repertoire browser proof: 11 unique focus activities and 12 unique break activities (14 shared activities), plus nap/pause, resume and completion. The CSS sequence exposes 24 distinct frame positions, and entry requests at most three sheets. Director unit tests also cover 100,000 arbitrary phase changes without immediate repeats. Desktop/mobile timer and check-in/Progress/calendar flows passed against the compiled production build; accessibility checks found no violations in the timer.
- Compiled head/member assistant journeys passed with the compact batch UI: checked proposals, persisted history, no writes before confirmation, one applied result, scanned attachment download and mobile overflow. Reset/evaluation fixtures were updated for retired features. The shared visible-screen reconciliation also covers unavailable realtime transport without adding per-screen polling timers.

## UI rationale sources

- [W3C target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum): checklist controls use 32px desktop targets and 44px coarse-pointer targets.
- [Nielsen Norman Group: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): proposals show essential identity/change first, with editable details on demand.
- Check-in state is encoded with labels/icons as well as colour; Progress retains exact numerator/denominator alongside its Oklab-interpolated background.

## Agreed behaviour

- First cycle: 2–13 November 2026, Asia/Tashkent. Draft check-in is available now.
- Later additions increase the cycle denominator. Blocked items remain in the denominator.
- Check-in locks removal; checkout freezes the complete historical snapshot.
- Unfinished items carry forward without a carry-age badge; the next draft may remove them.
- Telegram uses the department's existing connected group, at 09:00 on each meeting day.
- Removed feature data must be backed up in a restricted location before destructive migration.
- Retain private to-dos and an ordinary Pomodoro. Replace Today/Periods/Notes/Canvas with a private calendar.
- Preserve professional profile drawers and account settings; remove only the obsolete standalone person profile.
- Retire the head's management tools completely, including unused APIs, jobs, AI tools and navigation.
- Assistant plans must reuse matching tasks, create real nested checklist items, and support one reviewed bulk confirmation.

## Verification required before release

- Cycle boundaries, manual/automatic locks, concurrent changes, late additions, carryover, frozen history.
- Cross-department and private-calendar isolation; head-only locks and bulk assignment.
- Source checklist edits/deletion do not rewrite a closed checkout.
- Telegram deduplication, restart recovery, disabled/local transport, and connected-group routing.
- Regression of the attached six-task outline: existing cards reused, all six handled, checklist hierarchy preserved.
- Proposal selection/edit/discard and retry safety; attachment and conversation regressions.
- Removed feature reference scan, migrations and backup recovery; typecheck, architecture, unit and integration tests.
- Desktop/mobile visual checks of check-in, Progress, personal calendar, settings and assistant.
- Commit/deploy only after verification; production checks afterward.
