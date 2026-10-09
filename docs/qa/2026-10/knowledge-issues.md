# Knowledge, membership and save recovery

This is bounded local evidence, not a complete-platform acceptance report. Synthetic fixtures use
`devon_flow_e2e_root` and isolated loopback API/web ports. External application AI, Telegram and
email delivery are excluded. Large recordings and screenshots remain in ignored artifacts.

## Reproduced failures and repairs

- A shared page's title/body debounce discarded the preceding field. A refused save also claimed
  Saved and lost input. A per-page ordered save queue now merges pending fields, preserves their
  starting revision, acknowledges unchanged fields, and retains refused/conflicting drafts with
  explicit Retry save. Actual browser edits, independent reads and reload prove persistence.
- Restoring a historical version changed PostgreSQL while the open editor retained old content.
  Controlled editor hydration now updates clean fields. The difference includes the page title,
  making title-only revisions visible. Local drafts prevent an unsafe restore.
- A failed history-preview GET produced an unhandled rejection and misleading No changes content.
  Selected snapshots use a page/version-keyed query with visible loading/error and actual retry.
- Creating a page had no visible refusal feedback or keyboard cancel/focus return. Its form now
  keeps input, associates the error, guards pending submission, and restores the New page opener.
- Failed onboarding-template reads appeared empty. The template surface now distinguishes a
  failed read and offers retry. Editing/toggling templates still has a separate pending audit.
- Ordinary colleagues could restore someone else's deleted shared page through the API, despite
  lacking the delete control. Restore now locks/rechecks the active actor, membership and page,
  requires creator/current head, enforces expiry/version, and records audit/outbox atomically.
- A real approval committed successfully but did not notify the applicant's personal live channel.
  Relevant membership publications now fan out to validated, deduplicated user channels. After
  that fix, the browser gained the new membership but retained its old broker department scope;
  the realtime bridge now resets/reconfigures when actor or active department changes.
- A 6,000-word, accepted-size page difference exhausted a **heap-bounded Node probe**, before any
  browser claim. The word diff now bounds its comparison grid and preserves all old/new text in
  coarser changed blocks when needed. Shared prefix/suffix context remains intact. Browser proof
  of this long-history boundary now passes in all three engines, including keyboard close/reopen.
- The long-history accessibility check then reproduced insufficient contrast for added text:
  the light-theme success foreground/background measured 3.28:1 at13px. Added text now uses the
  existing `success-text` token. `large-history-axe-final` retains three genuine before failures;
  `large-history-contrast-after` passes all three browsers with zero violations in both themes.
- A committed shared-page create/edit/version restore/delete was invisible to another open tab.
  The valid Chromium before case saved successfully and independently read the page but received
  no `pages.page.created` publication. Page and onboarding-template mutations now enqueue
  identifier-only events inside the same transaction as their data/history/audit changes. Pending
  page/template writes defer their own refresh; a dirty template name remains intact when a peer
  edits it. These frequent autosave events explicitly remain silent in the notification registry.
- A deleted page's version endpoint still returned its historical content with200 while the page
  endpoint returned404. An actual integration assertion failed before repair. The snapshot read
  now joins the active, same-department page and refuses deleted-parent history with404.
- Two shortcut chords sharing the same translated description produced duplicate React keys.
  The actual failing unit fixture recorded two warnings. Keys now identify the chord and description
  together; both rows survive a reorder without a duplicate-key warning.
- An authenticated account without department membership followed a page link into repeated403
  reads and generic “Could not load the data” recovery. The actual tightened before assertion and
  its opened screenshot reproduce this state. Pages now show the existing localized department
  guidance and a Departments action before mounting any private page query. Home uses the same
  useful next step instead of search or a misleading globally enabled demo-department message.
  Administrator Home keeps its Administration action; its text no longer claims the whole system
  has no departments merely because this administrator has no membership.

## Executed evidence

- `results/platform/knowledge-nested-membership-shell-after/summary.json`: **33/33**, Chromium,
  Firefox and WebKit; no retry/skip. Includes page ownership, merged saves, refusal/retry,
  restored-editor freshness, preview refusal/retry, create/cancel, template read recovery,
  added-item toggle, actual broker approval/fresh membership/new scope, and shared shell checks.
- `apps/api/test/integration/pages-restore.test.ts`: **7/7 actual PostgreSQL integration cases**:
  creator/head success, foreign/colleague refusal, expired/unknown conflict, removed member,
  concurrent single-winner restore and atomic audit/outbox counts. Triggered-outbox rollback
  and permission-revocation races are not claimed by this seven-case set.
- `pages-diff`, `realtime-client`, `realtime-invalidation`, `personal-queued-save`: **28/28 unit
  checks**, including full text reconstruction and unchanged-field acknowledgement.
- `tools/qa/page-diff-probe.mjs`: repaired isolated 64MiB probe completes in approximately3.2ms,
  with10.6MB measured heap and exact reconstruction of both texts. Timings are this local probe,
  not a production performance guarantee.
- `results/platform/large-history-valid-and-pages-after/summary.json`: **18/18**, all three engines,
  no retry/skip: accepted36KB three-paragraph history,6,000 old/new words fully rendered, native
  keyboard selection/focus, plus all five adjacent shared-page workflows. The initial long-page
  fixture incorrectly put36KB into one text node, exceeding the documented20KB per-node ceiling;
  its three422 failures in `bell-large-history-after` are fixture errors, not product failures.
- Personal latest-input retry: **6/6 across all three engines**. A committed retry response is
  held while new typing occurs; writes remain ordered, final independent read/reload retains
  newest title and the other tab's unchanged body.
- `results/platform/large-history-contrast-after/summary.json`: **3/3**, no retry/skip. Each browser
  checks both themes, complete long-history rendering and keyboard selection. All12 recorded
  1440×900 viewport PNGs (selected history and addition tail, both themes, three engines) under
  `knowledge/large-history/large-history-contrast-after/` were actually opened at original detail.
- `results/platform/knowledge-publications-valid/summary.json`: **6/6**, two workflows across all
  three browsers, no retry/skip. Real broker publications, actual UI mutations, peer view updates,
  dirty-name conflict notice, explicit save, enabled-state refresh and delete are independently
  read. All three current `live-page-restored.png` originals were opened: rows no longer overlap
  at capture time. Earlier motion-frame screenshots were capture timing, not layout-defect proof.
  A subsequent independent-context setup loop was parallelized for lint; it awaits the fresh sweep.
- `pages-publication.test.ts` and `pages-restore.test.ts`: **15/15** current PostgreSQL integration
  cases. The added eight cases include lifecycle receipts with no title/content, stale/unknown
  mutation no-event behavior and real outbox-trigger failures rolling back data/history/audit.
  Deleted-parent history returned200 before repair and404 in the repaired lifecycle assertion.
- `realtime-invalidation.test.ts`: **13/13** current; page and template writes defer/catch up.
  `shortcut-overlay.test.tsx`: **3/3** after the actual one-failed/two-passed before run.
  `notifications.registry.test.ts`: **10/10** after adding explicit silent event decisions.
- `results/platform/scope-recovery-after/summary.json`: **18/18**, no retry/skip, all three browsers.
  Six page/template publication cases, nine account/membership scope cases and three system-theme
  cases. Sign-out closes the old socket; a replacement account independently receives403 for the
  old page and sees actionable no-department guidance; member removal drops the old department
  connection and token authorization, shows only the remaining department and receives only its
  subsequent page publication; an externally committed head transfer updates open-tab permissions
  while retaining work-board access. This last case proves board access, not a card mutation.
- Scope pixel review: the three current no-department recovery originals were opened; six prior
  `realtime-scope-valid` remaining-department/former-head originals were opened and readable.
  That earlier run's replacement screenshots captured skeletons and cannot prove a loaded private
  page boundary. The tightened loaded-state assertion discovered the real recovery defect above.
- `results/platform/system-theme-current/summary.json`: **3/3** before the Home guidance repair;
  the same three journeys passed again in `scope-recovery-after`. Native keyboard theme cycles,
  browser-media light/dark changes, reload, local preference persistence and explicit override
  were checked with reduced-motion emulation. All six earlier system light/dark viewport originals
  were opened. This is browser media emulation, not an actual physical OS preference change or
  evidence that every animated surface has been reviewed.

Evidence roots above are under `artifacts/qa/2026-10/`. The actual before reports include
`knowledge-ownership-before-valid-fixture`, `membership-live-before-valid`,
`knowledge-nested-and-reconnect-before`, and `knowledge-history-failure-before`.

Fixture corrections are not product fixes: the first membership fixture used `version` instead of
`expectedVersion`; a history retry locator expected Retry instead of the actual Try again; the
first unseeded fixture login returned401. Added-item → toggle already passed before a new repair;
Incoming changed-template-draft preservation subsequently passed in the two-client publication
workflow; this does not establish every possible concurrent field combination.

## Pending boundaries

The separate `knowledge-nested-controls.md` ledger records completed bounded editor/slash/mention/
template journeys and its locale/theme pixels; those are not silently marked pending here.
Remaining applicable role/state matrices; additional realtime transport/revocation combinations
beyond the three scoped journeys; complete large-history mobile/zoom pixel
review; restore permission-revocation races beyond the executed cases; complete clean/populated
inventory sweeps and final supported gates. Atomic outbox rollback is covered by the new integration
slice above, rather than silently retained as pending.
No commit/push/deployment or tutorial completion is asserted here.

The first scope transfer trial used the nonexistent `/api/v1/work/board` path and returned404;
the real contract is `/api/v1/board`. That was a fixture error and was corrected before the passing
three-engine scope runs. The no-department locale/reflow matrix passed6/6 across all three engines
and four locales. Actual pixel inspection then found recovery-card content escaping its padding
at320px and doubled text, despite the original page-wide overflow assertion passing. The tightened
Chromium check failed before the shared `states/empty-state.tsx` repair; after it,6/6 passed with
actual box/glyph containment and real next-step navigation. The24 before/after comparison sheets
representing96 captures were actually opened at original size; desktop sidebar pixels are outside
those cropped comparisons. Exact references and the still-unconfirmed Cyrillic demo-chip concern
are in `no-department-pixels.json`. Adjacent shared-state native-focus/axe checks are underway;
forced geometry is never counted as proof of an actual network fault or offline recovery workflow.
