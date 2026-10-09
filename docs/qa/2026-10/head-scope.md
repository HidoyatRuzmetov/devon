# Department head scope and owned work

The department head must remain a person who owns and receives tasks. A missing optional physical unit does not mean the head is an ordinary unassigned employee. The change classifies leadership from the **department membership role**, leaves real unit IDs and membership records intact, and does not automatically assign a unit.

Directory and board group leadership first, then real units, then ordinary unassigned members. The indicator table uses the same display grouping; its raw `unit` value remains null for a head without a physical unit. Person metadata and workload show “Department-wide” only when the physical unit is absent. A head with a real unit still shows that unit and matches that physical unit filter. Native assignment options and the existing member picker identify the head, while active assignment permissions remain unchanged.

Unit-load analytics now return an explicit grouping scope and stable unit IDs. Leadership and ordinary null-unit work are separate, their counts retain the same total, and two actual units with the same name remain separate chart categories. These grouping IDs do not modify the roster. CSV exports retain the distinction. The table header identifies the unit column instead of leaving its header blank.

## Actual failures and repairs

- The baseline board/analytics assertions failed because leadership was folded into the ordinary unassigned group. Directory original pixels independently showed the same misleading grouping; an initial duplicate accessible-name assertion was a test-selector fault and is not counted as a product failure.
- A real 200% text assertion measured a clipped directory title. Cards now wrap the full name, with role badges on their own row. The corrected test measures visible text rather than the Avatar's 1px accessible copy.
- Native320px indicator pixels revealed names squeezed by the localized Head badge and task titles available only through hover text. Independent actual Chromium assertions measured `HeadScope Synthetic` at164px scroll/120px client and the task title at154px scroll/146px client. Both now wrap; the badge occupies a second row.
- The expanded tablet matrix then caught a regression from wrapping: the automatic table layout squeezed the name column to one character. The visible screenshot and leaf-width assertion confirmed it. The name/task columns now have minimum readable widths, within the existing named horizontal table scroller. The current-source visual replay passed8/8, and its repaired Uzbek tablet original was opened and inspected.

Before evidence is preserved under `artifacts/qa/2026-10/head-scope/{before,name-before,indicator-before,indicator-name-before,indicator-tablet-before}`. Other trials involving incorrect endpoint/feature/accessible selectors and one local database connection-capacity failure are fixture/environment failures, not product defects. No foreign connections were terminated.

## Executed gates

`apps/web/test/e2e/head-scope.qa.spec.ts` and its dedicated configs use a fresh synthetic department, a head, an ordinary unassigned member, an actual unit member and real persisted cards. Browser requests are blocked outside the owned loopback origin. The isolated DB is `devon_flow_e2e_head`, API48961/web48962, pool limits from the guarded harness, no demo seed and no external integrations.

The functional gate passed24/24 across Chromium/Firefox/WebKit, with no retries/skips. Its8 distinct journeys cover directory Cards/Table, board grouping, analytics table/actual CSV totals, optional real head-unit membership/filter/metadata, ordinary colleague assigning a real card to the head and head Mine/reload, raw indicator/persisted open count, duplicate unit-name categories, and visible directory names at200%. Exact report: `head-scope/final-twenty-four/results.json`.

The additional narrow Russian indicator regression passed3/3 across all3 engines. Exact report: `head-scope/indicator-after/results.json`. The current-source visual replay after minimum-width repair passed8/8 with no retries/skips: `head-scope/final-visual/results.json`. Its bounded matrix is Chromium4locales×2themes×6routes×3environments (320,768,1280 with200% text),144 captures. There is no axe gate in this slice and no all-browser visual matrix claim.

Web/API typechecks passed after the main implementation. Web typecheck and scoped lint/Prettier passed after the final indicator column repair. The original filter/workload files have two pre-existing autofocus warnings, not new errors. Later Goals edits require their own final source gates and do not extend this head-scope evidence.

## Pixel and coverage boundaries

Actual opened artifacts, native crop coordinates and observations are listed in `head-scope-pixel-review.json`:8 unscaled sheets representing48 native regions,8 current enlarged directory originals,3 functional enlarged directory originals,3 narrow Russian indicator originals and1 repaired tablet original. Contact-sheet generation alone is not review. Cropped regions do not establish the entire page, unreviewed capture pixels or interactions. Fixed bottom navigation overlays the badge region in the narrow full-page originals; Russian analytics crops exclude the third row. Those limitations are explicit and no unobscured focus/whole-chart pixel claim is inferred. The bounded overlay only binds real exercised controls/states; member-picker rendering, unrelated filters, hover/focus/keyboard paths, structure export and other role/state permutations stay pending unless another owned ledger establishes them. Org-chart source already places the department head at department scope; this slice does not claim a new actual org-chart interaction test.

No production data, migrations, deployment, push, external application AI/Telegram calls or tutorial recording were performed by this agent.
