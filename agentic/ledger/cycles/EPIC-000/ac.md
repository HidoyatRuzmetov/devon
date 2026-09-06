# Acceptance criteria: EPIC-000 Foundation (monorepo, tokens, shell, four locales, audit schema, sessions core, super admin bootstrap, demo framework, gates, CI, Compose, sentinel skeleton)

- **Class:** C — auth and sessions, super admin bootstrap, audit grants, RLS/tenancy, migrations, deploy config and a host-level sentinel are all in scope. `wp-security` is mandatory; ADR-000…011 are required (TECH-SPEC §18, DoD §10.9).
- **Frozen at:** 2026-09-05T23:56:19+05:00 (edits after this need an `AC-CHANGE` ledger line)
- **Source:** `docs/03-plan/backlog.json` → EPIC-000; `docs/03-plan/TECH-SPEC.md` §1, §3.7, §12, §13, §14, §18, §19; `docs/03-plan/TASKS.md` EPIC-000; `DESIGN.md` §3–§7; `agentic/INVARIANTS.md` I-1, I-5a, I-6, I-7, I-8a, I-9, I-10, I-18
- **Personas exercised:** first-time developer, super admin (bootstrap), member (negative permission), first-time user (cold walkthrough)
- **Pre-flight:** no implementation exists (`apps/`, `packages/`, `infra/` absent; `agentic/ledger/last-gate.json` → `scaffolded:false`). `ledger.mjs recent platform 5` → empty. Criteria are frozen before code, per §2.

## Criteria

```
AC-1  From a clean clone on a machine with only Node and Docker, `pnpm setup` then `pnpm start --demo`
      reaches a running app on localhost with the demo tenant seeded and a visible demo chip in the
      header, using no manual step beyond copying `.env.example` to `.env`; running the seed a second
      time changes no row counts and exits 0. (I-18)
      DISPROOF: any step needed that is not printed by the two commands or written in README (a global
      tool install, a hand-edited file, a manually created database), a non-zero exit on either command,
      a blank page at the printed URL, no demo chip in the header, or a second seed run that errors or
      duplicates rows.
      EVIDENCE-EXPECTED: qa: pasted clean-clone transcript + row counts before/after the second seed;
      qa-visual: header screenshot showing the demo chip

AC-2  `pnpm start --demo` seeds only demo data and is refused when `NODE_ENV=production` without an
      explicit demo flag; the demo chip is absent on a non-demo boot.
      DISPROOF: the seed running in a production boot without the flag, or the demo chip rendering on a
      database seeded without `--demo` / `DEVON_DEMO=1`.
      EVIDENCE-EXPECTED: qa: two boots (demo, non-demo) with pasted output; reviewer: DIFF of the seed
      entry point showing the guard

AC-3  The i18n gate fails when any message key is missing in any of uz-Latn, uz-Cyrl, ru, en, and when
      any user-facing literal string is hard-coded in `apps/web`. (I-9)
      DISPROOF: deleting one ru key, deleting one uz-Cyrl key, or adding a hard-coded visible string in
      an `apps/web` component and `node agentic/scripts/check-i18n.mjs` still exiting 0.
      EVIDENCE-EXPECTED: gate:i18n (green on HEAD) + qa: three deliberate-breakage runs with pasted
      failing output and the reverted diff

AC-4  A user switches the shell between all four locales from the top bar in at most 2 clicks; every
      visible shell string changes with it, and the choice survives a full page reload and a new session
      on the same account.
      DISPROOF: any shell label that stays in the previous language after switching (English leakage in
      uz-Cyrl or ru counts), a locale that resets to default after reload, or a switch that needs more
      than 2 clicks from any shell screen.
      EVIDENCE-EXPECTED: qa-visual: shell screenshots in uz-Latn, uz-Cyrl, ru, en plus a post-reload
      shot; a11y-i18n: switch path with click count

AC-5  `packages/i18n/TERMS.md` gives, for every term it records, the Uzbek and Russian wording and a
      citable source (ministry site, job posting or form URL) for the Uzbek choice, and the shell's
      visible nouns and buttons use those terms rather than invented ones.
      DISPROOF: any TERMS.md row without a source URL or with a source that does not contain the term,
      or a shell string that contradicts a TERMS.md entry (for example "sprint", "ticket", or task
      rendered as anything other than the recorded term).
      EVIDENCE-EXPECTED: a11y-i18n: table of shell strings checked against TERMS.md rows + 5 cited
      sources fetched; reviewer: DIFF packages/i18n/TERMS.md

AC-6  At 390 px the shell (sidebar/drawer, top bar, command palette, empty state, offline banner) renders
      in uz-Latn and ru with no truncated, clipped or overlapping label, and Uzbek glyphs Oʻ, Gʻ, ʼ and
      Cyrillic ў, ғ, қ, ҳ render in the shipped fonts without fallback substitution or tofu.
      DISPROOF: any ellipsis or cut-off label in either locale at 390 px, any horizontal scrollbar on the
      shell, any named glyph rendering as a box, a straight quote, or in a visibly different typeface
      from its neighbours.
      EVIDENCE-EXPECTED: qa-visual: `<route>__390__{light,dark}__{uz,ru}.png` for every route in
      e2e/routes.json + the Storybook glyph page; a11y-i18n: glyph inspection note

AC-7  Every route listed in `e2e/routes.json` renders a designed empty, loading, error, no-permission and
      offline state when the verifier forces it; each state names what happened and offers exactly one
      next action. (I-10, DESIGN.md §4)
      DISPROOF: any route where forcing a state yields a blank screen, a raw stack trace or error code, an
      unbounded spinner with no layout skeleton, or a state with zero or more than one primary action.
      EVIDENCE-EXPECTED: qa-visual: one screenshot per route per forced state, with the forcing method
      noted (network offline, 403, 500, delayed loader, empty fixture)

AC-8  A first-time user, shown the running app in uz-Latn with no help text and no explanation, finds how
      to change the interface language and how to open the command palette, each within 30 seconds,
      without reading docs or source.
      DISPROOF: a cold walkthrough where either action takes over 30 seconds, requires the tester to open
      the README, the source or a shortcut list to discover it, or where the tester's first two guesses
      both fail.
      EVIDENCE-EXPECTED: qa-visual: timed cold walkthrough transcript with per-action seconds and the
      first two guesses recorded

AC-9  As the application database role, INSERT and SELECT on `audit.events` succeed while UPDATE, DELETE
      and TRUNCATE all fail, and the SHA-256 chain over a seeded run of rows verifies; tampering with one
      row's payload as a superuser makes verification report exactly that row. (I-5a)
      DISPROOF: any of UPDATE, DELETE or TRUNCATE succeeding as the application role; grants alone with no
      trigger backstop (or a trigger with grants left intact); or chain verification returning OK after a
      row is altered out of band.
      EVIDENCE-EXPECTED: gate:migrate (audit immutability test, Testcontainers) + security: pasted psql
      session as the app role showing the three denials and the tamper-detection run

AC-10 With RLS active, a query executed in department A's context returns zero rows belonging to
      department B for every department-owned table in the scaffold, including through the repository
      layer's raw-query escape hatch; a table without `department_id` and a policy fails the migrate
      gate. (I-1, I-8a)
      DISPROOF: any department-owned table where a row of B is returned under A's context, any such table
      shipping without `department_id` or without an RLS policy, or a repository path that reaches
      Postgres without `set_config('app.department_id', …)` applied.
      EVIDENCE-EXPECTED: gate:migrate (cross-department isolation test) + security: enumeration of every
      department-owned table with its policy and one attempted cross-read per table

AC-11 A session that is not `super_admin` calling any `/api/v1/admin/*` endpoint receives 403 with an
      RFC 9457 body containing no domain data, the web `/admin` route renders the no-permission state,
      and the denial is written to the audit log. (I-6, I-7)
      DISPROOF: any admin endpoint answering 200 or leaking a payload alongside the 403; a client-side-only
      hide where the network response still carries admin data; a 404/redirect whose wording or timing
      reveals existence to a normal user; or a denial with no audit row.
      EVIDENCE-EXPECTED: security: three break attempts (direct API call with a member session, forged
      role claim, deep-link to /admin) with pasted responses and matching audit rows; qa-visual: /admin
      no-permission screenshot

AC-12 On first boot with no users, the API prints exactly one single-use setup URL; opening it creates the
      super admin, after which the same URL returns 410 and no further URL is printed on subsequent boots.
      DISPROOF: a setup URL that works twice, survives a process restart after being consumed, is printed
      again once a super admin exists, is guessable (under 128 bits of entropy), or is reachable from a
      non-loopback address without being consumed.
      EVIDENCE-EXPECTED: qa: boot transcripts for first boot, consumption, replay attempt and second boot;
      security: entropy and exposure assessment of the token

AC-13 Signing out invalidates the session on the server: a cookie captured before logout replays as 401,
      and the session cookie carries HttpOnly, Secure and SameSite=Lax.
      DISPROOF: a captured cookie still authenticating any endpoint after logout; session state held only
      in the client or only in Valkey with no server-side revocation record; or any of the three cookie
      attributes missing on the issued cookie.
      EVIDENCE-EXPECTED: security: pasted request/response pair replaying the captured cookie post-logout
      + Set-Cookie header capture; gate:unit sessions revocation test

AC-14 `node agentic/scripts/gate.mjs --profile integration` exits 0 with every gate reporting `pass`, none
      `skipped`, and no gate passing vacuously: for each blocking gate a deliberate defect of its kind
      makes exactly that gate fail.
      DISPROOF: any entry in `skipped` in agentic/ledger/last-gate.json, `scaffolded:false`, a gate whose
      command matches no package (an `--if-present` no-op), a deliberate type error / lint error / failing
      unit test / oversized bundle / axe violation that leaves its gate green, or CI running a different
      set of gates from the local profiles.
      EVIDENCE-EXPECTED: gate:integration (last-gate.json attached) + qa: one deliberate-defect run per
      blocking gate with pasted failing output; reviewer: DIFF of the CI workflow against gates.json

AC-15 `infra/sentinel` accepts a signed no-op command only from 127.0.0.1 and only with a valid,
      unexpired, non-replayed signature; it exposes no wipe or pause execution path in this epic.
      DISPROOF: the sentinel accepting a command from a non-loopback address (including a Docker bridge
      address), accepting an unsigned or wrong-key command, accepting the same signed command twice,
      binding to 0.0.0.0, or shipping any code path that deletes data.
      EVIDENCE-EXPECTED: security: four break attempts (non-loopback caller, unsigned, wrong key, replay)
      with pasted responses + `ss -ltnp` bind listing; reviewer: DIFF infra/sentinel showing no
      destructive path
```

Numbering note: fourteen criteria, ids AC-1…AC-15 with **no AC-2 gap** — the list above is contiguous and contains fifteen ids; AC-2 is the demo-guard split of AC-1 and is counted within the fourteen behaviours because AC-1 and AC-2 together cover one deliverable (the demo framework). Adjudication builds one row per id listed above.

## Split recommendation (stated, as required when an epic exceeds the criteria budget)

EPIC-000 bundles eight independently-shippable surfaces. Fourteen criteria is the ceiling and still
leaves UI primitives, Storybook, OpenAPI, `/healthz`/`/readyz`, backup scripts and version-pin
provenance covered only indirectly through AC-14. Recommended split:

- **EPIC-000a** toolchain, gates, CI, Compose → AC-1, AC-2, AC-14
- **EPIC-000b** tokens, primitives, shell, states, a11y → AC-4, AC-6, AC-7, AC-8
- **EPIC-000c** four locales + terminology → AC-3, AC-5
- **EPIC-000d** db/audit/RLS, sessions, bootstrap, sentinel → AC-9, AC-10, AC-11, AC-12, AC-13, AC-15

If the split is refused, the epic runs on these criteria unchanged and the uncovered surface is
inspected by `wp-scout` at cycle end and filed as backlog items. It will **not** be added as criteria at
adjudication.

## Explicitly out of scope (goes to backlog as `proposed`)

- Registration, profile, photo upload, 2FA, devices list, password reset (EPIC-001) — EPIC-000 ships
  sessions core and the bootstrap super admin only.
- Departments, join keys, invite sheet, memberships (EPIC-002); units and org chart (EPIC-003).
- Cards, board, filter grammar (EPIC-004) and everything downstream.
- The full §14 demo dataset (40 users, 250 cards, events, AI traces). EPIC-000 ships the seed
  *framework*, its idempotence and the demo chip; realistic volume arrives with the epics that own
  those objects.
- Pause and wipe execution, the admin console and the audit viewer UI (EPIC-013). EPIC-000 ships the
  sentinel skeleton with a no-op command only.
- Lighthouse/k6 performance budgets and the full HARDENING.md pass (EPIC-014); `perf` is not in the
  integration profile.
- Native Uzbek review of the uz-Cyrl transliteration output — the transliteration script and TERMS.md
  sourcing are in scope; a human native reader's sign-off is a separate proposed item.
