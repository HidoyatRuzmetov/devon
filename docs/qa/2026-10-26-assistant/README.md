# Assistant capability and consumption comparison — 26 October 2026

Baseline source: `554bda51f707a3a2f0f76f7311d0a82f57c47387`.

The same opt-in live-model runner (`apps/api/test/checks/assistant-quality-eval.ts`) ran before and after the implementation. Both runs used the configured `glm-5.3` endpoint and isolated Docker PostgreSQL databases with the same synthetic workload: 181 cards, project/milestone, event, page, private note, users, and uploaded files. UUIDs differ between runs. No production records or credentials are included in these reports.

## Measured result

- Baseline: 16/17 scenarios passed; 696,131 total tokens.
- Final candidate after the Zod security update: 17/17 passed; 254,044 total tokens: **63.5% reduction** across this suite.
- Three checklist changes: 41,075 → 13,976 tokens, with all three confirmed writes verified in PostgreSQL.
- The baseline scope failure answered a generic Dijkstra request. The candidate asks for its work purpose; work-related technical help remains available.
- Three passing candidate runs used 157,974, 204,866 and 254,044 tokens: **63.5–77.3% less than baseline**. Earlier snapshots are retained in `candidate-efficient.json` and `candidate-recovery.json`. The final run used full-context recovery for RSVP and attaching a file to an existing card; both confirmed writes succeeded. Savings vary with model behavior and workload; recovery deliberately prioritizes correctness over reducing every individual request.

| Scenario                  | Baseline | Candidate | Baseline tokens | Candidate tokens |
| ------------------------- | -------- | --------- | --------------: | ---------------: |
| checklist-three-actions   | Pass     | Pass      |          41,075 |           13,976 |
| follow-up                 | Pass     | Pass      |          41,181 |            7,004 |
| page-grounding            | Pass     | Pass      |          40,339 |            6,219 |
| broad-totals              | Pass     | Pass      |          40,357 |            6,228 |
| milestone                 | Pass     | Pass      |          40,591 |           19,870 |
| rsvp                      | Pass     | Pass      |          40,819 |           53,960 |
| file-to-page              | Pass     | Pass      |          41,011 |           13,595 |
| page-attachment-retrieval | Pass     | Pass      |          40,989 |            6,709 |
| file-to-existing-card     | Pass     | Pass      |          40,924 |           55,007 |
| uzbek                     | Pass     | Pass      |          40,966 |            6,833 |
| russian                   | Pass     | Pass      |          40,934 |            6,623 |
| private-owner             | Pass     | Pass      |          40,990 |            6,679 |
| private-denial            | Pass     | Pass      |          40,961 |            6,581 |
| ambiguous-target          | Pass     | Pass      |          41,826 |           24,868 |
| general-code-scope        | Fail     | Pass      |          41,259 |            6,566 |
| legitimate-work-code      | Pass     | Pass      |          40,866 |            6,588 |
| document-injection        | Pass     | Pass      |          41,043 |            6,738 |

## Design and safeguards

The same model, complete saved conversation history, source permissions and 44 registered action handlers remain. A compact source directory and current totals replace unrelated full bodies in the initial request. The model can request full records, attachment text, search results and exact action schemas; broad requests and validation failures can recover the original bounded full snapshot. Internal read requests are strictly validated and never saved as user-facing answers. Expansion is bounded and shares a 180-second deadline. Each call, including repair attempts, is metered and budget checked. Actual writes still require confirmation and re-enter the ordinary API permissions, validation, concurrency and audit pipeline.

The existing incremental index and extracted-file cache remain. Static action schemas are computed once. Dynamic timestamps follow stable prompt instructions and context, improving prefix reuse where the serving endpoint supports it. Cached input counters are recorded only if reported; absence is shown as “Not reported”. The final provider run reported 94,912 cached input tokens out of 250,094 input tokens across 25 calls. The baseline did not record that counter, so this is not a before/after cache comparison. The UZS figure is a token-based reference estimate, not a GPU utilization measurement or a bill. No GPU saving is claimed by this test.

Intermediate live runs exposed malformed read requests and incomplete schema proposals. Strict output validation, targeted schema repair and a full-context fallback corrected them before the candidate snapshot above was accepted.

## Validation

- Complete API suite: **1,102/1,102 tests passed** across 133 files in local Docker.

- Original Docker capability suite: 56/56 before and after (conversations, action confirmation, attachments, permissions, fresh context, helper grounding and file extraction).
- AI package: 191/191 tests, including wire protocol, retries, structured output, language and cached-token mapping.
- Release follow-up: updated Zod to 4.6.6, including the transitive tooling copy, for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). All workspace type checks, 191 AI-package tests, 50 Docker conversation/action regressions and the 17 live-model cases passed again. Notification settings navigation was checked for both roles after removing the obsolete pane-heading assertions.
- The production image gate identified outdated curl and Brotli libraries in the pinned nginx image. The runtime now pins curl/libcurl 8.23.0-r0 and brotli-libs 1.2.1-r0. The freshly built web image passed the same HIGH/CRITICAL vulnerability scan with zero findings, nginx configuration validation, non-root health checking and an HTTP 200 startup check. Application code and nginx version did not change in this packaging fix.
- Added regressions cover directory expansion, related file content, source isolation, full fallback, internal read persistence, joining-date order, manual/assisted checklist activity and recovery of historical missing actors from the immutable audit.
- Real browser flow for head and member: scanned upload → confirmed action → saved page/card attachment → download → reload/history continuation; both passed. The browser provider is scripted; real model quality is measured separately above.
- Desktop/phone settings, profile drawer, Inbox, assistant history and source-return navigation: four browser journeys passed, including accessibility checks.
- Additional browser regression passed for head/member Home tab geometry, the native mobile Inbox switch, and the head risk-review button beside Calendar with its existing opening panel.
- Historical actor migration was tested against a deliberately reproduced missing-actor activity row; the audit author was recovered without modifying the audit chain.

This is an empirical regression suite, not a guarantee that every possible natural-language request is equivalent. Source coverage/extraction limits remain explicit; originals remain available for expansion. Deployment and final production visual-check results are recorded in the release follow-up.
