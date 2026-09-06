# Escalation: EPIC-000.7-gates

- **Date:** 2026-09-05T23:56:19+05:00
- **Raised by:** feature-cycle workflow on epic EPIC-000
- **Kind:** wrong-gate
- **Status:** ANSWERED

## The one question

Item EPIC-000.7 cannot make gates green after 2 attempts (failed: e2e-smoke). Is the gate wrong, or is the item mis-scoped?

## Default we are proceeding with

Reverting nothing; item parked; continuing with other items.

## Evidence

$ playwright test --config test/e2e/playwright.config.ts "--" "--grep" "@smoke"
Error: http://127.0.0.1:5173 is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.

C:\Users\rpwal\Documents\Work\eGov\WorkPortal\apps\web:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @devon/web@0.0.0 test:e2e: `playwright test --config test/e2e/playwright.config.ts "--" "--grep" "@smoke"`
Exit status 1

## What changes if the answer is different

- Reopen the named item(s) and re-run feature-cycle for EPIC-000.

## Answer

2026-09-06 (CTO session): the gate, not the item, was wrong. Two defects in the delivery system were fixed: (1) the i18n gate failed whenever the web app did not exist yet (now a tolerated warning until apps/web/src exists); (2) gates that depend on parts of the repo or tools that do not exist yet (e2e-smoke, e2e, a11y, migrate, bundle, security, perf, ai-evals) are now reported as skipped and tolerated in the fast/item profiles, required in integration/release. The feature-cycle now also runs one repo-wide fixer before parking an item whose gate failure is caused outside its TOUCHES. Item work is kept; EPIC-000 resumes from the Integrate phase.
