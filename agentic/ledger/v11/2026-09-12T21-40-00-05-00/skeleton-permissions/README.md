# skeleton-permissions — evidence (v1.1 SPEC §2, §3, §4.2, §5)

Branch `master`. Verified live against `pnpm start --demo` (API :3000, web :5173) on 2026-09-12,
signed in as the two demo personas, locale uz-Latn, dark theme.

## What the screenshots show

| File | What it proves |
|---|---|
| `member-home-sidebar-1440.png` | `demo.xodim`: the working Home (due from me / needs my decision / around me / own KPIs / onboarding) and a sidebar with **no Boshqaruv group** — no people table, no department settings. |
| `member-people-table-no-permission.png` | `demo.xodim` typing `/people/table`: the shared no-permission state, not a blank screen or a raw error (PERMISSIONS-AUDIT D12). `/admin` behaves the same. |
| `member-board-own-cards-movable.png` | The board reads for everyone; only the member's own column carries the drag handle and the "move to" menu. |
| `member-card-read-only.png` | A colleague's card opens as a reading view with the read-only strip: *"Bu vazifa siznikimas — faqat oʻqish uchun…"* |
| `head-home-management-dashboard-1440.png` | `demo.boshliq`: the **Boshqaruv** sidebar group plus the management Home — decisions waiting, overdue by person (top 5), load this week per person, projects furthest behind, next week's events, newcomers mid-onboarding. Every number from a live endpoint. |
| `head-people-table-1440.png` | `/people/table` with all 26 colleagues and the default columns (Ism · Ochiq vazifalar · Yuklama · Boʻlim) from `GET /people/indicators`. |
| `head-people-table-column-picker.png` | The column picker is generated from the shared registry in `@devon/contracts` — ticking "Kechikkan" adds a real column with real values. |
| `head-people-table-390.png`, `head-home-390.png` | 390 px: no horizontal overflow on the page (the table scrolls inside its own container), all 26 rows render. |
| `head-people-table-narrow.png` | The same table in the desktop browser at its narrowest window width. |

## The matrix, measured in the browser

Same requests, two sessions:

| Request | `demo.xodim` (member) | `demo.boshliq` (head) |
|---|---|---|
| `GET /people/indicators` | **403** | 200 |
| `GET /people/indicators/registry` | **403** | 200 |
| `GET /pages/onboarding/templates` | **403** | 200 |
| `GET /analytics/export.csv?chart=loadPerPerson` | **403** | 200 |
| `GET /analytics/export.csv?chart=throughput` | 200 | 200 |
| `GET /ai/settings` | keys: `departmentId, softCapPct, flags, available, unavailableReason` — **no money** | + `budgetUzsPerMonth, spentUzsThisMonth, remainingUzs, budgetStatus, usedPct` |
| `GET /ai/usage` | only the caller's own `userId` | the department's |
| `GET /analytics/summary` → `loadPerPerson` | **1 row (their own)** | 26 rows |
| `GET /analytics/summary` → `loadPerUnit` | 2 units (unchanged) | 2 units |

## Gates

- `node agentic/scripts/gate.mjs --profile fast` — **ok=true, failed=[], skipped=[]**
- `pnpm --filter @devon/db migrate:verify` — **596/596 checks passed across 7 sections**
- `pnpm --filter @devon/web build` — built
- `pnpm --filter @devon/api test:unit` — 496 passed, 3 expected-fail (the remaining documented
  concurrency probes). The three probes this task owned now pass as ordinary assertions.

## One pre-existing bug found and fixed while verifying

The board would not load at all. Root cause, reproduced minimally and fixed in its own commit:
with `@fastify/compress@9.2.0` + `fastify@5.12.3`, an **async handler that calls
`reply.send(payload)` without returning it** answers `content-encoding: gzip` with
`content-length: 0` and an empty body once the payload passes the compression threshold (~4 KB).
`return payload`, `return reply.send(payload)` and a sync handler calling `reply.send` are all fine,
and `app.inject` does not reproduce it — which is why the unit tests were green while the board, the
card list, projects and events were empty in every real browser. Fixed by prefixing `return ` on the
155 `reply.send` statements that are the last statement of their handler.
