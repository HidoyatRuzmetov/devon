# Invitation password workflows — normal local use

The existing invitation password controls passed without product changes. This bounded proof closes
the custom-password/generated-password browser gap previously qualified in `accounts-onboarding.md`.
It does not establish every invitation state, permission, locale or environment.

The new `platform-invite-password.qa.spec.ts` uses the existing supported platform QA config and real
local API/PostgreSQL, with fresh department/head/newcomer fixtures created through current contracts.
The exact owned database is `devon_flow_e2e_invite_password`, API48981/web48982. Broker48983 is reserved
but unused. Demo seed and realtime are off; browser/API guards deny external integration calls. The API
runs the documented development scanner-off local-storage harness, not the production API image.

Two distinct workflows passed in Chromium, Firefox and WebKit:

- Head sets a valid custom invitation password through Save. The actual204 occurs once; the draft
  clears and the one-time displayed value matches the submission. An independent metadata GET keeps
  the key and `hasPassword=true` without exposing plaintext. Reload removes the revealed password.
  A fresh newcomer submits the original password through Join: actual404, visible refusal and no
  membership in the head's independent roster read. The custom password then returns200, creates an
  active membership and retains the department after navigation/reload.
- Head opens generated-password rotation and Cancels. No rotation request occurs, and an independent
  new account's actual API join200 proves the original password remains usable. Reopening and
  confirming produces exactly one real200 and a generated value different from the original; the
  readonly value matches that response. Metadata read/reload keep the invitation but hide the
  one-time secret. A second newcomer repeats actual old-password404/no-member → new-password200,
  independent active roster read and department navigation/reload persistence.

The first development run passed **6/6** in2.5m. Its first opened refusal captures caught Collapsible's
opening fade. The spec now waits for actual ancestor opacity1 and the refusal shake to finish; phone
captures use the native viewport instead of a full-page fixed-shell composite. This is a capture
correction, not a product defect. The final development replay passed **6/6**, no retry/skip, in2.2m:
`artifacts/qa/2026-10/results/platform/invite-password-dev-final/summary.json`.

All twelve current development originals were opened at original detail. EN/light desktop1280×800
and phone390×844 use normal text. Password fields are intentionally masked magenta; visible headings,
instructions, refusal text and Join/Save controls are readable. The lower Rotate action is outside
some captured viewports; actual clicks establish its behavior, not these uncaptured pixels. The exact
images and limits are in `invitation-password-pixels.json`. No new axe, keyboard, touch or locale
matrix is claimed. The sanitized per-test report attachment retains methods/paths/statuses and checks
zero pageerrors and zero blocked foreign requests without writing passwords or request bodies.

The compiled attempt initially matched the existing genuine React production build receipt
`cc486d1dd63b18e07bb1db9fd29e53254f5f2cb891892b9f4ad79416f127ebfb`. Shared product source changed during
setup, and worker config correctly refused the stale receipt at0ms: one harness failure, one unrun
case, **zero product assertions**. Its report is preserved at
`artifacts/qa/2026-10/results/platform/invite-password-compiled/summary.json`. A fresh stable build and
the same two-case compiled replay replaced that blocked attempt on 2026-10-12; neither agent rebuilt
dist independently or bypassed the source guard.

The final compiled replay passed **6/6** across Chromium, Firefox and WebKit without retries or skips,
in 3.6 minutes: `artifacts/qa/2026-10/results/platform/invite-password-compiled-final/summary.json`.
The final stable production web input hash is
`10d8dae2264c70cbaa2b7decce2eadf956360702c6161967c8b9f63169806524`, with genuine production React and
the forced-state build flag off. This is the compiled web with the actual guarded development API
and local PostgreSQL; it does not establish the compiled API image or live production behavior.

All twelve final compiled originals were opened at original detail. Password controls, the
one-time-value warning, settled old-password refusal and Join action remain readable at normal
1280×800/390×844 in EN/light. Password glyphs are masked, and uncaptured lower controls retain the
limits above. `invitation-password-pixels.json` preserves the twelve development originals and adds
the twelve compiled originals; `invitation-password-evidence.json` retains the historical refused
attempt separately from the final passing receipt. No additional matrix or product repair was added.

Final web types, scoped ESLint and scoped Prettier passed. The invitation controls needed no
product/API/schema repair; this stream performed no production activity, commit/push/deployment
or tutorial recording. Other release changes and shared harness improvements belong to their
separate evidence records.
`invitation-password-evidence.json` contains exact source hashes and ten conservative source selectors;
the parent can reconcile them after its current source census.

Reproduce with the existing harness, setting the variables on every invocation:

```powershell
$env:FLOW_DB_NAME='devon_flow_e2e_invite_password'
$env:FLOW_API_PORT='48981'
$env:FLOW_WEB_PORT='48982'
$env:FLOW_CENTRIFUGO_PORT='48983'
$env:FLOW_REALTIME='0'
$env:FLOW_SEED_DEMO='0'
$env:FLOW_PRODUCTION_BUILD='0'
$env:QA_RUN_ID='invite-password-dev-final'
pnpm --filter @devon/web exec playwright test --config test/e2e/platform-qa.config.ts platform-invite-password.qa.spec.ts
```

For compiled replay use a fresh verified production receipt, `FLOW_PRODUCTION_BUILD=1`, `DEVON_E2E=0`,
a new run ID and the same command without a project filter to run all three browsers. Real metadata cannot return the stored plaintext password;
independent actual joins establish that the new password hash is persisted and enforced.

Transport/server refusal for these password writes, held duplicate/context-switch races, exhaustive
password boundary/Unicode semantics, revocation during a write, Escape/keyboard variants, clipboard,
QR scanning and production HTTPS/external integration behavior remain outside this bounded proof.
