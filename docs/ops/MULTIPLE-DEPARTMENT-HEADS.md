# Multiple department heads — review notes

Implementation and Docker verification: 20 November 2026. Production deployment is pending user approval of the Docker screenshot review.

## Behavior

- A department can have multiple active heads with equal department-management rights. There is no privileged founding head.
- Any current head can appoint an active member, remove another head's leadership role, or step down. Role changes use the membership version to reject stale actions.
- A head can leave when another active head remains. The last active head cannot step down, leave, or be disabled/deleted through account administration. Locked/deleted accounts do not count as replacements.
- Transfer headship replaces only the transferring head; other heads retain their roles.
- A removed head who rejoins through an invitation returns as an ordinary member and follows the department's approval setting.
- Password resets for colleagues remain restricted: one head cannot reset another head's account password.
- All active heads appear in department membership, the department hub, the organization chart and PNG export, and the administrator's department list/detail.
- Shared settings save only edited fields. Transactional read/merge/write prevents independent settings/feature changes from overwriting each other.
- Shared invitation revisions clear stale revealed passwords after another head/tab rotates them, including after reconciliation when realtime was unavailable. Secrets and revisions are isolated when switching departments, and delayed responses cannot replace a newer password. Outbox messages carry the revision, never the secret. Existing password-set API clients retain their 204 response unless they request the new revision receipt.
- Account locking/deletion retries with a conflict if another department membership appeared while leadership locks were being acquired, preserving lock order and the final-head safeguard.
- Mobile self-management actions wrap below the head's name, keeping all four translations readable. Account lock/delete failures appear inside the confirmation dialog as well as in the notification.

## Source impact review

| Area                                                                   | Handling                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database membership model / RLS                                        | Existing membership rows already permit multiple heads; no new migration. Department isolation remains in force.                                                                                            |
| Request actor, session, `can()` and head-only routes                   | Rights remain per department membership. Added the role endpoint to the head-only route gate. Role changes invalidate open session and role-sensitive workspace queries.                                    |
| Appoint, demote, transfer, remove, leave                               | Department advisory lock, current actor/target eligibility checks, sorted account/membership locks, and final-active-head checks in the writing transaction.                                                |
| Join / rejoin / approval                                               | Rejoining does not resurrect an old head role. Existing versioned approval decisions remain shared between heads.                                                                                           |
| Account lock and deletion                                              | Checks every affected live department under the same leadership lock order; advances membership revisions and publishes refresh events.                                                                     |
| Department settings, feature switches, invites                         | Merge locking, partial client writes, realtime invalidation and invitation revision receipts.                                                                                                               |
| People and structure                                                   | All department heads rendered; unit-head positions remain separate unit roles. The chart expands for every department head and exports the same geometry.                                                   |
| Administrator summaries                                                | All active head names aggregated in stable membership order; account-lock errors explain the required replacement.                                                                                          |
| Work boards, person/table/calendar/timeline views, cards and templates | Existing department-head guards admit any active head. Membership changes invalidate all work queries. Personal ownership restrictions stay intact.                                                         |
| Projects and restoration                                               | Existing per-department head permissions and project ownership checks preserved; project/work queries refresh after role changes.                                                                           |
| Check-in/out and analytics                                             | Existing head/member permissions preserved; check-in queries refresh after role changes.                                                                                                                    |
| Events, polls and carpools                                             | Existing centralized head/owner guards preserved; event queries refresh after role changes.                                                                                                                 |
| Knowledge pages and onboarding templates                               | Existing department-managed permissions preserved; page queries refresh after role changes. The review build retains the pre-tutorial help/onboarding interface.                                            |
| AI briefings and settings                                              | Manual briefing uses the requesting active head. Scheduled shared briefing selects one stable active billing actor; adding heads does not multiply jobs. Inactive accounts excluded.                        |
| Notifications / birthdays / Telegram                                   | Head notification recipients include all active head accounts. Existing individual birthday delivery fans out; shared group delivery remains deduplicated. Telegram permissions remain department-specific. |
| Four locales / mobile                                                  | Added English, Russian, Uzbek Latin and Uzbek Cyrillic leadership and conflict copy; browser captures cover all four mobile layouts.                                                                        |

## Review source and preservation

The original staged index is byte-for-byte unchanged. Pre-existing working files are checked against the pre-edit hash inventory. Both tutorial implementations remain untouched, and existing uncommitted bug fixes remain in the user's workspace. No commit, push, production migration or production deployment was performed. Local migrations ran only against the separate review database and disposable test databases.

The current isolated review source lives at `.scratch/multiple-heads-docker-review` within this repository. It was reconstructed from the earlier reviewed patch and the original HEAD; the one old manifest mismatch was line endings only. Its scope excludes the unfinished introduction/tutorial work, new workload-estimation feature and new Pomodoro artwork, while preserving the related pre-existing production behavior. Mixed files retain the bug-fix changes. The original workspace still contains all deferred work. The earlier `C:\workspace\workportal-heads-review` copy remains untouched.

The snapshot's source includes retained avatar/event-photo fixes, deleted-card content/attribution and attachment fixes, membership-refresh fixes, and the multi-head changes. The source manifest records the selection. The review patch is based on the original HEAD; it must not be replaced with a blanket commit of the user's pre-existing index.

The final scope gate compares 179 deferred paths with the original HEAD, including absence for newly added files. Tutorial-specific help routing, lifecycle support and tests stay at the baseline. The existing FAQ and onboarding-template subscription are preserved. The mixed AI guide retains its deleted-card correction and excludes the new effort-estimation paragraph. `docker-verification/release-scope.json` records this scope check against the exact patch hash.

## Docker verification and approval gate

| Check | Result |
| --- | --- |
| API unit and PostgreSQL integration suite | 1,209 checks across 149 files covered. Initial run: 1,205 passed and four outdated test fixtures failed. All 60 checks in the five affected integration files passed after correcting the fixtures; no product safeguard was relaxed. |
| Multiple-head PostgreSQL cases | 14 passed, including races, final-head safeguards, approval modes and AI actor attribution |
| Full review web unit suite | 447 passed, 88 files, including the previously blocked Windows junction fixtures |
| Final mobile/admin refinement regression | 51 focused web checks passed; TypeScript and scoped lint passed |
| Final scope regression | 53 API checks passed across existing pages, role permissions and multiple-head behavior; API/web TypeScript passed |
| API and web TypeScript checks | Passed |
| Scoped API/web ESLint | Passed, including the Docker browser harness and changed database tests |
| Four-locale check | Passed: 3,758 keys, zero errors in the review source |
| Production Docker API and web image builds | Passed from the tutorial-free source; existing web large-chunk warnings remain |
| Docker stack | Separate PostgreSQL, Valkey, Centrifugo, API, web and gateway services healthy; `/healthz` and `/readyz` pass |
| Migration repeatability | 84 local review migrations applied; repeat startup reports zero new migrations |
| Real Docker browser review | Two journeys passed; 23 workspace routes plus leadership, administrator, mobile and invitation checks; 43 PNG captures |
| Docker packaging and deployment-script checks | 27 passed; these tests do not deploy |
| Review preservation | Original staged index unchanged; deferred tutorials retained in the original workspace |

The refreshed review patch is `artifacts/qa/multiple-heads/bugfixes-and-multiple-heads.patch`; `review-source-manifest.json` binds the changed source files to hashes. The Docker image receipt and test logs are under `artifacts/qa/multiple-heads/docker-verification`. These are local review artifacts, not a production release.

The current gallery is `artifacts/qa/multiple-heads/live-workflow/index.html`, served at `http://127.0.0.1:48932/review/`. It uses **real Docker application responses and real PostgreSQL**, with synthetic local accounts. `docker-screenshots.zip` contains all 43 images and the offline gallery. The earlier `ui-preview` folder remains labelled as simulated evidence and is superseded by this live review.

Real-database scenarios are in `apps/api/test/integration/multi-head-workflow.test.ts`. They cover appointment and revocation in the same session, CSRF and stale versions, invalid targets, concurrent departures/demotions, transfer/rejoin, final-head account protection, administrator summaries, shared settings and AI attribution.

`apps/web/test/e2e/multi-head-workflow.flow.spec.ts` provides the real multi-session workflow and 23-route capture pass. It also proves that password rotation reaches another head through the real WebSocket service, clears the stale revealed password, and never publishes the password in the message. `multi-head-docker.config.ts` selects the dedicated stack; its setup verifies Docker ownership, image receipts, loopback port binding and readiness before any browser mutations.

The corrected test fixtures cover: rejoin approval enabled and disabled; account changes with a surviving co-head; concurrent transfer waiters at the new department advisory lock; and the fixed historical date of the initial check-in repair. The applied migration itself was not changed.

The local stack uses the production-built images with development configuration, local storage and no external AI or Telegram credentials. This verifies department authorization, database concurrency and browser behavior; it does not certify live external delivery or the future production environment.

From the isolated review source, run `node scripts/multiple-heads-docker-review.mjs up` to start or resume the stack, `status` to inspect it, and `stop` to stop it while retaining the review database. The Docker images must first be built with tags `devon-api:multiple-heads-review` and `devon-web:multiple-heads-review` from this isolated source. Never build the release from the tutorial-bearing original working tree.

Next gate: user screenshot approval, then deploy the exact reviewed source/images with the existing backup/rollback procedure and verify production health and multiple-head behavior on the deployed version. No production action is authorized until that approval.
