# Escalation: EPIC-000.demo-gates

- **Date:** 2026-09-06
- **Raised by:** wp-backend during feature-cycle/build on epic EPIC-000, item EPIC-000.demo
- **Kind:** wrong-gate
- **Status:** OPEN

## The one question

`gate.mjs --profile item` runs a monorepo-wide `e2e-smoke` (`pnpm --filter @devon/web test:e2e -- --grep
@smoke`), which fails today for every item in this epic regardless of that item's own TOUCHES (see the
eight sibling escalations `EPIC-000-EPIC-000.{1,2,3,4,5,6,7,8,9}-gates.md`, all reporting the identical
symptom). EPIC-000.demo's TOUCHES is `packages/db/src/seed/**`, `packages/db/test/seed.idempotence.test.ts`,
`packages/db/package.json` only, and explicitly excludes `apps/web`/`apps/api`. Root cause now identified
(below) and it is in `packages/i18n`, owned by EPIC-000.3 — outside this item's TOUCHES and outside every
other item's TOUCHES that has hit the same failure. Should EPIC-000.demo (and its siblings) be blocked on
a defect none of them are allowed to fix, or is the fix itself a new backlog item?

## Root cause, diagnosed (new evidence beyond the sibling escalations)

`packages/i18n/src/terms.ts:4` does `import { readFileSync } from 'node:fs'` (it loads `terms.json`/
`TERMS.md` for the `terms:build`/`terms:verify` CLI tooling). `packages/i18n/src/index.ts:40` re-exports
this module wholesale (`export { ... } from './terms.js'`). Every `apps/web` module imports the bare
package specifier `@devon/i18n` (e.g. `apps/web/src/shell/auth-shell.tsx:7`,
`apps/web/src/routes/login.tsx:7`, `apps/web/src/main.tsx:3` — 13 files, `grep -rn "from '@devon/i18n'"
apps/web/src`), which resolves to that same barrel. Vite therefore pulls the Node-only `terms.ts` into
the client bundle for `/login`; `node:fs` is externalised for the browser, `readFileSync` throws at
module-eval time, and the whole SPA fails to mount — hence `getByRole('heading', { name: 'Tizimga
kirish' })` finds nothing in every item's `e2e-smoke` run.

Reproduced directly (not just via the gate) on 2026-09-06:

```
$ pnpm --filter @devon/web test:e2e -- --grep @smoke
[WebServer] 12:02:23 PM [vite] (client) [Unhandled error] Error: Module "node:fs" has been externalized
for browser compatibility. Cannot access "node:fs.readFileSync" in client code. ...
[WebServer]  > Object.get ../../../../../../../../../@id/__vite-browser-external:node:fs:3:11
[WebServer]  > ../../../packages/i18n/src/terms.ts:1:48
  x  2 [chromium] › shell.smoke.spec.ts:6:1 › @smoke locale switch on /login ... (5.7s)
  1 passed (13.5s)   # the other @smoke test (search trigger absence) is unaffected — it never asserts the heading
```

The fix (not applied here — outside TOUCHES): split `packages/i18n/src/terms.ts` out of the public
barrel (`index.ts` should export only the client-safe locale/`t()`/formatter surface from §1.3 of
design.md; `terms.ts` should be imported directly by `src/cli/terms-build.ts` and its own tests, never
through `@devon/i18n`), or lazy-load it behind a server/CLI-only entry point (`@devon/i18n/terms`).

## Default we are proceeding with

EPIC-000.demo's own scope is verified green by every gate that is actually scoped to it:
`gate.mjs --profile fast` (typecheck/lint/unit/i18n/secrets) passes; `pnpm --filter @devon/db
test:seed-idempotence` (the migrate-gate's step 6, Testcontainers) passes all 18 assertions including
the AC-2 production-guard case and the AC-1 second-run-zero-rows case; `pnpm --filter @devon/db
seed:demo:matrix` matches the full truth table. `packages/db/src/seed/**` is not touched by, and does
not contribute to, the `e2e-smoke` failure (confirmed: zero `apps/web`/`packages/i18n` files in this
item's diff). Item is not reopened to touch `apps/web` or `packages/i18n`; it is recorded here as
BLOCKED-ESCALATED on the `item`-profile `e2e-smoke` gate only, joining the existing sibling escalations,
and the loop continues with the next item.

## What changes if the answer is different

- If the fix belongs to EPIC-000.3 (i18n barrel split) → file a `proposed` backlog item against
  `packages/i18n/src/index.ts`/`src/terms.ts`; once shipped, re-run `gate.mjs --profile item` for
  EPIC-000.demo and every sibling item with the same open escalation — no further code change needed on
  their side.
- If the gate itself is wrong (e.g. `item` should not run the full `e2e-smoke` suite per-item, only the
  routes touched) → that is a `gates.json` change, which no agent may make; it needs a human decision
  recorded as an ADR.

## Answer (filled by the human, or by wp-pm after a chat reply)

_(pending)_
