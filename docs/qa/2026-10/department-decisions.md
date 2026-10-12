# Department request decisions — ordinary local workflow

Closing a department request with its visible Close button used to leave the administrator's
rejection mode and draft reason in memory. Reopening the request showed the abandoned reason
instead of the normal Approve/Reject choice. The approval screen now uses one close handler for
the visible Close button, the sheet dismissal and successful decisions; it clears the selected
request, rejection mode and reason together.

The real Chromium baseline failed at the reopened sheet's missing Approve action:
`artifacts/qa/2026-10/results/platform/dept-decision-baseline/summary.json`. Its original
`test-failed-1.png` was opened at original detail: the reopened sheet still displayed
“Abandoned draft” and Cancel/Reject. This is the product regression evidence. Earlier and subsequent
failed runs with an incorrect textbox locator or duplicate synthetic names are fixture failures;
they do not establish additional product defects.

The corrected journey then found a separate onboarding defect in every browser: approval returned
200 and made the requester head, but the independent Structure read returned `units=[]` despite the
request retaining its submitted unit. `approveDepartmentRequest` did not select or create the
requested units. `dept-decision-dev-corrected/summary.json` preserves that three-browser failure.
Approval now creates all supplied root units in the same transaction as the department, membership
and approved request, retaining their names and order with valid Structure paths. Each unit has the
existing Structure audit and outbox event. Request hex colours map to the nearest existing OKLCH
category, using the actual eight token hues; the stored Structure contract remains categorical,
so an arbitrary submitted colour is represented by its closest category rather than its exact hex.
Requests without units still approve normally, and repeated approval cannot create duplicates.

Opening the resulting rejection screenshot also exposed misleading status copy: the rejected badge
and reason appeared below a title and body that still promised an upcoming review. The shared view
now selects rejected/approved titles and useful next-step copy for the actual status, in the existing
four locales. The same journey now asserts the rejected heading and absence of that pending promise;
no new environment matrix or product feature was added.

The bounded regression uses the existing local platform harness with the exact owned database
`devon_flow_e2e_dept_decision`, API 49011/web 49012, EN/light, normal text, desktop 1280×800. It creates
fresh requester and administrator sessions. External browser requests are refused, demo seed and
realtime are off, and the local API's existing transport guard keeps excluded integrations disabled.
The API runs from the development source; compiled replay refers specifically to the web build.

The single end-to-end journey covers:

- Requester sends a department request containing one unit; independent API read confirms pending
  status and the unit.
- Administrator opens Reject, enters a draft, closes and reopens the sheet. The ordinary choice
  returns, the draft is cleared, and no decision request occurred. Reject/Cancel also leaves the
  request pending.
- Administrator sends a real rejection 204. Independent requester read and browser reload show the
  exact rejection reason. The rejected item is available under All.
- Requester starts another request with a revised name and the same unit. Administrator approves
  with a real 200. Independent request and unit reads confirm approval, the created department and
  requester head role. Department navigation and reload retain the resulting department.

The repaired approval workflow passed **3/3** in Chromium, Firefox and WebKit, without retries or
skips, in 2.6 minutes: `dept-decision-dev-units-fixed/summary.json`. This development pass predates the final
status-copy change and its new assertion. A separate real PostgreSQL regression passed **2/2**,
verifying three ordered coloured/uncoloured units, paths, head membership, duplicate 409,
audit/outbox counts and an empty-unit request. Its first fixture incorrectly sent an empty JSON
body instead of the current approval client's `{}`; that 400 is a test setup error, not another
product defect. API/web types and scoped lint passed.

The final genuine compiled web replay passed **3/3** in Chromium, Firefox and WebKit, without
retries/skips, in 3.4 minutes:
`artifacts/qa/2026-10/results/platform/dept-decision-compiled-final/summary.json`. It verifies the
final rejection copy as well as the retained units. The stable production web input hash is
`10d8dae2264c70cbaa2b7decce2eadf956360702c6161967c8b9f63169806524`; the receipt confirms genuine production
React and no forced-state build flag. The API remains the guarded actual development API, so this
is not a compiled API image or production-site claim.

All nine compiled originals were opened at original detail. The sheet crops show the reset choice
and submitted unit; requester captures show the correct rejection heading/reason and discoverable
next action; the resulting department captures show the requester as Head and one member. The
Firefox department capture caught the Invite subsection's skeleton, so it does not prove loaded
invitation pixels. The separate final invitation replay establishes that ordinary workflow. Exact
image dimensions and qualifications are in `department-decisions-pixels.json`. The conservative
overlay binds nine source controls and fourteen named states; a read-only reconciliation against the
current inventory applied them with zero selector issues. Other states retain their existing status.

The browser test has no retries,
forced clicks, internal success mocks or widened assertions. Its sanitised attachment records only
decision paths/statuses, page errors and refused foreign requests. Raw Playwright reporter files
remain ignored local evidence because historical versions include ambient runner environment.

Reproduce after verifying the owned ports are free:

```powershell
$env:FLOW_DB_NAME='devon_flow_e2e_dept_decision'
$env:FLOW_API_PORT='49011'
$env:FLOW_WEB_PORT='49012'
$env:FLOW_REALTIME='0'
$env:FLOW_SEED_DEMO='0'
$env:FLOW_CLAMAV='0'
$env:FLOW_PRODUCTION_BUILD='0'
$env:QA_RUN_ID='dept-decision-dev-units-fixed'
pnpm --filter @devon/web exec playwright test --config test/e2e/platform-qa.config.ts platform-department-decision.qa.spec.ts
```

For compiled web replay, first create a fresh verified production build receipt, then set
`FLOW_PRODUCTION_BUILD=1`, `DEVON_E2E=0` and a new run ID. The same command runs Chromium, Firefox
and WebKit. This ordinary journey does not establish every request boundary, permission race,
locale, theme, keyboard path, production environment or external integration.
