# Personal workspace: navigation, Undo and keyboard

Partial local slice. No full-platform, release or tutorial completion is implied.

| Finding | Actual before | Repair | Evidence/status |
| --- | --- | --- | --- |
| Changes disappeared after leaving a tab | Task/note/canvas deletion and Today completion announced success, but unmount cleared their five-second write timers. Independent reads six seconds later found all three items still active and completion still null. | Persist immediately; deletion Undo carries the exact server operation receipt, completion Undo saves the returned version. Success messages follow committed responses. Failures retain the item and show an error. | Four actual failures preserved in `results/platform/personal-card-order-before`; all four repaired journeys pass Chromium, Firefox and WebKit in `personal-card-order-after` (12/12). |
| Tab trapped title focus and changed nesting | Actual Tab remained in the title input; its handler invoked indent rather than normal navigation. | Native Tab/Shift+Tab; explicit Alt+Right/Left nesting shortcuts and contextual tooltips; accessible title names; disabled unavailable outdent/first-sibling indent actions. | Actual failed trace in `personal-recovery-and-tab-before`; both keyboard journeys pass6/6 across all three engines in `personal-notes-keyboard-after`, repeated successfully in `personal-concurrency-receipts-after`. |
| Enter could not create a sibling | Actual nested-title Enter posted an empty title and received422. No sibling persisted. The old handler also omitted the selected item's parent. | Localized nonempty starter title plus server-owned afterTaskId transaction; focus/select the new sibling. | Actual failed trace in `personal-enter-before`; final all-engine browser keyboard proof above; actual backend placement/hierarchy proof in `personal-restore-backend.md`. |
| Narrow task editing affordances | Source placed hover-only actions beside the title, consuming its mobile width; drag target was16px. | Visible mobile actions on their own wrapping line,24px drag target with focus ring; deletion controls show pending state. | Final narrow screenshots, axe and pixel inspection pending. |
| Period badge contrast | Full route sweep found the custom bg-info/10 text-info override failed contrast at768/390/320. | Use the repaired shared subtle info Badge with its text token. | `route-sweep-three` before evidence; final scoped axe/pixels pending. |

Chromium recovery checks passed7/7: persisted delete before Undo, restore after tab change and reload;
controlled503 deletion refusal without a false Undo; persisted Today completion and Undo after leaving.
The companion keyboard case failed as expected before repair, so that combined report is not an all-pass report.
The final recovery subset passed21/21 across Chromium, Firefox and WebKit in
`personal-recovery-enter-title-after`. That report has29 passes/one failure overall: Firefox's newly
created sibling did not receive focus. The subsequent commit-aware focus request fixed that actual
failure; both keyboard journeys now pass6/6 in `personal-notes-keyboard-after`. Earlier
`personal-recovery-table-auth-after` recovery failures were strict selectors caused by repeated
literal fixture titles across engines; fixture names are now unique and those failed reports remain
preserved. The table/anonymous404 route subset itself passed all9 role-engine cases in that report.

Enter now persists the correct sibling through `afterTaskId`, and focuses/selects its title after
React commits the new input. Native Tab/Shift+Tab leave the input without changing persisted nesting.
Backend hierarchy, lifecycle and restore evidence is in `personal-restore-backend.md`.

Notes/canvas save slice:

- Actual note body blur saved200 then issued a duplicate delayed write409 (`personal-note-autosave-before`).
- The first title-refusal case had an unstable draft selector; its corrected actual503 case had no
  feedback (`personal-note-title-before`). Only the corrected case supports that finding.
- Actual drawing/title edits sent two overlapping canvas writes while the first response was held
  (`personal-canvas-queue-before`).
- One per-record queue now coalesces fields and uses the preceding committed version. Dirty note
  fields survive older responses; errors retain drafts with explicit retry and conflict guidance.
  Blur cancels the note timer; canvas identity, rather than element count, governs initial hydration.
- `personal-notes-canvas-queue-after` passed12/12 across all three browsers: single body save,
  refused-title feedback+real retry, pending newer body/title preservation+reload, and ordered
  canvas drawing/title persistence. No retries or skips.
- Web typecheck and supported scoped ESLint passed. Text enlargement, nested drawing/sharing,
  navigation cleanup and remaining matrix states still need final evidence.

Supported web typecheck and scoped lint passed after the first persistence repairs. New keyboard/
sibling changes need their own final gates. The work-table file retains an existing autofocus warning.

Further task and autosave concurrency slice:

- Actual task title503 originally had no feedback and lost the draft; rapid done/undone reused
  the first request's version and received409. `personal-mutations-before` preserves both failures.
  Task patches and reorders now share a serialized queue, per-field rollback generations and
  contiguous revision ranges acknowledged by this client. Draft titles capture their starting
  revision; failures and conflicts retain input with associated feedback and explicit Retry save.
- Structural writes return optional atomic affected-version receipts. The frontend no longer
  guesses child revisions from a later read, which could mistakenly include a remotely moved child.
  Legacy API wire shapes remain supported. Backend receipt/exclusion tests are recorded separately.
- `personal-task-receipts-final` passes15/15 with no retry/skip across all three engines: actual
  remote-title conflict and explicit retry preserving remote notes; blank title without an API write;
  actual drag of a branch to another period, held committed response and queued child completion;
  controlled503 title refusal; held rapid done/undone and reload persistence.
- The preceding `personal-concurrency-receipts-after` report has24 passes/3 failures; its task-fault
  URL selectors missed the newly added query flag, so it is not an all-pass report. Corrected exact
  record/path/query interception plus held-request assertions are in the final15 above. Its four
  note journeys, canvas queue and two keyboard journeys themselves passed all three engines.
- Actual unsaved note title + remote update + real online refetch silently overwrote with200
  (`personal-note-conflict-before-seeded`). The first unseeded attempt failed fixture login and does
  not establish a product defect. Notes now retain field starting revisions; note/canvas queues only
  rebase through acknowledged local saves. Conflict/error pauses further saves until explicit retry;
  newer typing stays in the pending draft. All three browsers pass the note conflict/retry journey,
  retaining the other tab's untouched body. Four focused hook tests cover remote revisions, local
  acknowledgements, latest queued fields and authorized saves completing after unmount.
- `personal-task-mutations-reflow-after` contains three passing320px/200% note checks. Actual full-page
  pixels were opened in Chromium/Firefox/WebKit: title line height and translation controls fit;
  the shared top bar wraps with enlarged initials. Normal native single-line title editing remains
  horizontally scrollable. This is only English/light evidence; other locales/themes remain pending.

Run the current local browser slice with synthetic demo fixtures (PowerShell):

```powershell
$env:FLOW_DB_NAME='devon_flow_e2e_root'
$env:FLOW_API_PORT='48931'
$env:FLOW_WEB_PORT='48932'
$env:FLOW_SEED_DEMO='1'
$env:QA_RUN_ID='personal-task-receipts-final'
pnpm --filter @devon/web exec playwright test --config test/e2e/platform-qa.config.ts test/e2e/platform-personal-mutation.qa.spec.ts
```

Remaining notes/canvas concurrency boundaries, task mutation rollback/concurrency, deeply nested layout, period
create/edit/rollover/complete, Pomodoro, sharing, AI disabled boundaries, every locale/theme/state,
and production-build final sweeps remain in the parent inventory. Personal data stays owner-only;
restore backend proof is recorded separately in `personal-restore-backend.md`.

Latest queue validation: the generic ordered hook now lives in `apps/web/src/lib/use-queued-save.ts`,
with the Personal path re-exporting it. The fifth focused unit verifies that an unchanged draft
receives an acknowledgement without another write. Actual held-response Retry save journeys pass
6/6 across Chromium, Firefox and WebKit: newer typing during a committed response stays queued,
the other account's untouched body remains intact, and final independent read plus reload agrees.
The current canvas control run also passes all9 adjacent root-owned autosave/readability cases;
the run's separate Pan/reflow failures still prevent a whole-editor pass. The shared shell's
unread badge and full Personal locale/state coverage have their own pending acceptance gates.
