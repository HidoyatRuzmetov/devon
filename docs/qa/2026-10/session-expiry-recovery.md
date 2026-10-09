# Expired session recovery

This is a bounded local classification and repair of the signed browser's next ordinary request
after its session expires. It does not establish the cause of any production tab's load failure.
No production request or mutation was made for this probe.

The fixture uses `devon_flow_e2e_knowledge_nested`, API 48921 and web 48922, the real seeded local
API, and a signed synthetic department head at 1280×720, English/light, normal text, Chromium.
It expires exactly the current fixture session by its hashed cookie, checks a one-row update, and
records no cookie, digest or SQL. The server's ordinary GET/POST responses supply the actual 401.
Realtime is off in this bounded fixture, so the read case exercises the real four-second board
fallback polling. A live broker dropping its socket is not claimed as tested here.

Before repair, both required recovery assertions failed. The board's real GET returned 401 twice,
showing the generic load failure and Try again control. The composer's POST returned 401, showing
the generic create error; the board also subsequently returned 401. Neither case requested `/me`
again, and both stayed on `/work`. A full reload independently reached Sign in in both cases.
Try again was inspected as visible; its click was not separately exercised in this slice.

The shared query and mutation caches now revalidate the active authoritative `/me` query after
a feature 401 while a signed session is cached. Concurrent refusals share one check and do not
cancel a pending session read. The failing feature response never assigns signed-out data. The
existing session query and route guard determine whether the current cookie is signed in.
No API, session hook, route gate, business rule, or retry budget changed.

After repair, both development and compiled-production cases pass: GET/POST 401 → `/me` 401 → visible Sign in → ordinary UI login
and `/me` 200 → Cards navigation and board 200 → full reload retains the new session. Both before
PNGs and all eight after PNGs were opened and inspected. The sign-in form is visible and focused;
the restored board contains genuine seeded cards rather than the generic error or expired composer.

Executed checks:

- Real Chromium browser: before 2 failed; after 2 passed.
- Genuine compiled production Chromium replay: 2 passed; builder input hash unchanged before/after.
- Focused session/cache/route/API units: 21 passed, including ten new shared cache cases.
- Adjacent locale recovery/race, admin settings and inbox-time units: 22 passed.
- Full supported `pnpm --filter @devon/web test:unit`: 306 passed across 58 files.
- Full web typecheck, scoped ESLint, Prettier and `git diff --check`: passed.
- Existing performance/configuration guard suite: 11 passed, retaining all budgets/receipt refusals.
  Actual QA configuration loading now checks default development `DEVON_E2E=1` and explicit
  compiled production `DEVON_E2E=0`; ordinary release selection remains unchanged.

The new cases cover query and mutation refusals, concurrent deduplication, an old request's late
401 after a replacement session, a newer login replacing a pending expiry check, non-401 refusals,
anonymous state, and exclusion of the session query itself. This is not a browser/locale/theme
matrix or a live production/physical-device result. The compiled replay used the root's genuine
production React build, forced-state build flag disabled, and verified input hash
`cc486d1dd63b18e07bb1db9fd29e53254f5f2cb891892b9f4ad79416f127ebfb` before and after the run.
Previous build receipts are historical after this product change.

Source and exact reports, public request observations and inspected pixel paths are in
`session-expiry-evidence.json`. Reproduce the development cases with the explicit owned namespace,
ports, `FLOW_SEED_DEMO=1`, unique `QA_RUN_ID`, and:

```powershell
pnpm --filter @devon/web exec playwright test --config test/e2e/platform-qa.config.ts platform-session-expiry.qa.spec.ts --project chromium
```

The compiled replay additionally sets `FLOW_PRODUCTION_BUILD=1` and `DEVON_E2E=0` and requires
the fresh matching `tools/perf/lighthouse/out/production-build.json` receipt. It serves the existing
artifact through `vite preview`; it neither builds nor writes `dist`.
