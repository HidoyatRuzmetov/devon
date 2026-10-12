# Actual upload scanning and recovery

The normal Files workflow was checked against the real local API, PostgreSQL, local storage and an
owned ClamAV daemon. No upload product repair was needed. This closes the previous scanner-off
qualification for these two browser workflows; it does not prove production infection handling,
large-file limits or quarantine expiry.

`flow-scanner.ts` adds an opt-in `FLOW_CLAMAV=1` harness. It starts the repository's pinned official
ClamAV image on a guarded loopback port, verifies actual `PING` / `PONG`, and removes only its own
container ID after checking the namespace/run labels. It has no shared volume, credential or
signature updater. The image's bundled official signatures perform the scans. The ordinary local
harness remains scanner-off; application AI, Telegram, SMTP, push and remote storage remain disabled,
and foreign API/browser traffic is refused.

The final development run passed **2/2 Chromium cases**, with no retries, skips or page errors:
`artifacts/qa/2026-10/scanner/scanner-dev-final-results.json` (2026-10-09, 119 seconds).

- A clean browser upload receives actual finalize200. Independent database metadata, final disk
  bytes, removal of pending bytes, private download200 and reload agree. A standard harmless EICAR
  test payload receives actual finalize422 from the real scanner. Its infected/deleted row remains
  traceable, pending bytes are removed, private download is404 and the file is absent after reload.
- Stopping only the owned daemon makes finalize return503. The visible **Try again** action retains
  the unpublished pending upload; independent reads show no public attachment and download404.
  Restarting the actual daemon and waiting for PONG lets that same button finalize the same upload
  ID once. Actual response200, clean/finalized metadata, exact final bytes, pending cleanup and reload
  prove recovery without duplicate attachment creation.

The initial run's second case looked for an incorrectly guessed “Retry” button. The saved snapshot
showed the actual label “Try again”; correcting the locator yielded the final pass. This was a test
fixture error, not a product failure or a relaxed assertion.

The three original Chromium Files crops (`chromium-infected-refused.png`,
`chromium-scanner-outage.png`, `chromium-retry-scanned.png`) were actually opened. English/light error
text, retry control and successful file row are readable. These are component crops, not full-page,
mobile, every-locale or accessibility certification. Unit guard coverage passed40/40 across the
scanner, service ownership and local safety test files; web types and scoped lint also passed.

Final compiled-web verification passed **6/6** in Chromium, Firefox and WebKit, with zero retries or
skips, in4.9m. The source-stable genuine React production receipt is
`10d8dae2264c70cbaa2b7decce2eadf956360702c6161967c8b9f63169806524`; the actual report is
`artifacts/qa/2026-10/scanner/scanner-compiled-final-results.json`. All nine final native Files crops
were opened: infected refusal, scanner outage and successful retry in each engine. The error text,
Try again control and retained clean attachment row are readable at their captured component size.
The three Chromium filenames replace the earlier development crops; that earlier report is retained.
These are English/light component crops, not an every-locale, mobile or accessibility certification.
The API uses the documented local development runner, not the Linux production API image. CI runs
the same actual scanner workflow in Chromium after the fresh production web build.

Reproduce with the pinned image already pulled, then:

```powershell
$env:FLOW_DB_NAME='devon_flow_e2e_scanner'
$env:FLOW_API_PORT='49001'
$env:FLOW_WEB_PORT='49002'
$env:FLOW_CLAMAV_PORT='49003'
$env:FLOW_CLAMAV='1'
$env:FLOW_REALTIME='0'
$env:FLOW_SEED_DEMO='0'
$env:FLOW_PRODUCTION_BUILD='0'
$env:QA_RUN_ID='scanner-dev-final'
pnpm --filter @devon/web exec playwright test --config test/e2e/scanner-qa.config.ts --project chromium
```

For the final compiled replay, set `FLOW_PRODUCTION_BUILD=1`, choose a distinct `QA_RUN_ID`, and omit
`--project chromium` to exercise the three configured engines. A fresh supported production web
build receipt is required; the harness refuses stale source rather than bypassing that check.
