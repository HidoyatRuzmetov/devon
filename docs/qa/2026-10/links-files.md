# Links and task files QA — October 2026

This is a scoped local functional evidence ledger. The API, database, storage and browser actions
are real, use synthetic accounts in `devon_flow_e2e_files`, and bind API/web to 48971/48972.
Application AI, Telegram and all other external calls are excluded. The API preload blocks foreign
DNS/TCP before transport; browser routes also deny foreign hosts. The local API uses development
mode with the explicit scanner-off exception; this does not prove production ClamAV/S3 behavior.

## Reproduced defects and repairs

| Defect | Before-fix observation | Repair and verification |
| --- | --- | --- |
| DNS failure prevented adding a normal link | Actual UI Enter → API 500; card unchanged; screenshot shows “Could not load that link”. DNS error and never-answering resolver unit regressions failed. | DNS validation now participates in fallback. Lookup has a 1s response budget; DNS+HTTP have a 4s whole-call budget. Private/mixed addresses still throw before HTTP. |
| An active HTTP stream could exceed the request budget | Existing socket timeout measured inactivity only. | A real local server continuously sends bytes; a 100ms whole-call deadline ends the request despite activity. |
| Unsafe URLs could be written directly to cards | Actual card PATCH containing `ftp:` returned 200 instead of 422. | Separate create/patch schemas require plain HTTP/HTTPS without credentials, including favicon values. Failed writes preserve the original card title/links; legacy DTOs remain readable. Unsupported legacy hrefs render inert text. |
| Long unreachable URLs still could not be saved | Failing unit regression returned a 535-character fallback title, exceeding the card write limit of 300. | Display titles are capped at 300 while the complete URL is preserved. Real UI persistence/reload/removal passed in all three engines. |
| Link controls did not match permissions/accessibility | Read-only cards exposed link input/delete; icon-only Add had no accessible name. | Read-only controls are absent, Add/Remove have localized names, duplicate adds are avoided, and pending writes are serialized locally. Remove errors report failure. |
| Uploads could not be cancelled | No active upload cancellation control existed. | Cancel aborts only the upload stage; checking/finalization remains non-cancellable. Abandoned bytes stay quarantined and are never announced as attached. A later upload works normally. |
| WebKit downloads lost the filename | Actual bytes and metadata matched, but `suggestedFilename()` was “download”. | Content-Disposition now contains a sanitized ASCII name/extension plus RFC 5987 UTF-8 name. The original exact ASCII name and bytes download correctly in all three engines. |

DNS lookup itself uses the OS resolver and cannot be cancelled by Node’s lookup API. A timed-out
answer may finish later; tests prove it cannot start a late HTTP request. HTTP requests are destroyed
at the deadline. No successful external preview was mocked or counted as verified.

## Functional coverage

Seven journeys ran in Chromium, Firefox and WebKit: **21 passed**, zero retries/skips/flaky results.
The complete report is preserved in ignored `artifacts/qa/2026-10/files/final-twenty-one-journeys.json`.

- A guarded DNS failure saves a plain link, avoids duplicates and survives reload.
- Actual file selection → signed local PUT → finalization → metadata list and exact local disk
  bytes → browser download → soft delete → download 404 → Undo → reload.
- Unsupported extension, 5MB+1 declared size, and false PDF bytes reject without publication;
  rejected quarantine bytes are removed. Mobile file section has no horizontal overflow at 390px.
- Cancel after the real server stores a PUT body leaves pending metadata/bytes quarantined,
  exposes no download (404), makes no finalize call and permits a subsequent real upload.
- A peer’s upload/link controls are absent; the owner’s signed upload token is rejected for the
  peer, as are peer upload/finalize writes.
- Interrupted PUT and failed DELETE transport faults show an error and preserve recoverable
  metadata; choosing a new file or retrying deletion succeeds against the real API.
- Create/patch reject FTP, JavaScript, data and credential-bearing URLs atomically.

The size/peer journeys were then strengthened and rerun: **six targeted engine cases passed**.
They additionally prove declared-size/body mismatch rejection and quarantine cleanup, actual peer
list/download of a finalized shared file, absent peer delete controls, and cross-department list/
download 404. Report: `files/extended-size-and-shared-permission-results.json`.

The cancellation fault delays delivery of an actual 204 response, never invents a successful API
response. WebKit interception cannot recover Blob request bodies, so that fault forwards the same
explicit fixture bytes; ordinary uploads separately verify native Blob transport. Browser request
failure, no finalize call, real DB metadata, storage bytes and download 404 are all asserted.

The first matrix also exposed two harness defects: reload already restores the card peek, so clicking
the covered board again was incorrect; fulfilling an already-aborted request was incorrect. These
were corrected without weakening persistence/byte/permission assertions. The initial 11-pass/7-fail
report is retained as `files/initial-matrix-with-harness-defects.json`; it is not the final result.

The expanded long-link check also initially read persistent state before optimistic PATCH writes
committed. Each add/remove now awaits its actual PATCH 200 before the independent persistence read.
The final three-engine expanded journey passed; report: `files/long-link-final-three-engines.json`.
Earlier diagnostic reports are retained separately and are not counted as application failures.

## Pixel evidence and limits

Rendered images were inspected for the before-fix failed link, the 390px uploaded file and cancellation
state. Final per-engine files live under ignored `artifacts/qa/2026-10/files/`: `*-mobile-uploaded.png`,
`*-file-rejected.png`, `*-cancelled.png`, `*-delete-failed.png`, and `*-plain-link-persisted.png`.
Before-fix traces are retained in `before-dns-fallback/`, `before-link-input/`, and
`before-webkit-filename/`. Fixtures/trace credentials are synthetic and are not committed.

This slice uses English/light theme for functional checks and 390px plus the normal desktop viewport.
Other locales/themes and broader responsive/role/accessibility coverage belong to the platform sweep.
It does not prove active scanner outage/infected-file browser behavior, external preview success,
production storage, live peer file freshness during broker outages, or abandoned-upload expiry timing.
Existing scanner/attachment integration boundaries are separate tests. No production change,
commit/push or deployment was performed by this agent.

## Focused gates

- API link/filename validation regressions: 41 tests passed, including the long-title regression.
- Web legacy-link/safety regressions: 22 passed; shared contracts typecheck passed.
- Scoped API/web ESLint passed. API, Web and shared contracts typechecks passed after independent
  owners corrected the unrelated test Window casts.
- Long-link real UI persistence/reload/removal passed in Chromium, Firefox and WebKit.

The reusable config is `apps/web/test/e2e/files-qa.config.ts`; its absolute results directory is
`artifacts/qa/2026-10/results/files`, distinct from other agents’ suites.
