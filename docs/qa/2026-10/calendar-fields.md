# Calendar subscriptions and custom fields — bounded local verification

The seven distinct workflows in `apps/web/test/e2e/calendar-fields.qa.spec.ts` passed **21/21** across Chromium, Firefox and WebKit, without retries or skips (3.9 minutes). The run used only synthetic accounts in `devon_flow_e2e_calendar_fields`, API48961/web48962; credentials for external integrations were removed by the shared guarded harness. Production and external calendar/Telegram/AI services were not accessed. Local listeners48961/48962 were absent after teardown.

## Reproduced defects and repairs

| ID | Actual failure before repair | Root cause and resulting behavior |
|---|---|---|
| CF01 | Subscription creation503 displayed no failure; the dialog gave no useful way to understand the refused save. | Create/renew dialogs now show a localized alert; revoke failure shows the existing localized save-error toast. Real retry persists the draft, renewal invalidates the old credential only on success, and failed revoke preserves the working credential. |
| CF02 | Type a newer custom answer while the actual first200 is held; its receipt changes the input back to the first answer. | The receipt removes only submitted draft entries that still equal the acknowledged value. Newer typing remains dirty for a second persisted save. The command captures owner, department and CSRF and guards its callbacks. |
| CF03 | Pick October15 under Asia/Tashkent; independent GET reports `2026-10-14`. | A calendar day was serialized as UTC midnight. Both rendering and serialization now use a local calendar day, preserving the chosen day through save/reload. |
| CF04 | Save answer `basic`, rename its option Foundation; definition ID becomes `foundation` and the previous answer loses its reference. | Existing option IDs remain immutable while labels change. The persisted answer survives rename, reorder, archive/Undo and archived restore. New-option ID collisions/removal remain distinct pending boundaries. |
| CF05 | From nineteen feeds, eight simultaneous POSTs allow three successes. | The count and insert now run under one owner-scoped advisory transaction lock. The final-slot regression produces one200 and seven422, retaining the existing twenty-feed contract and atomic audit/outbox insertion. |

Before evidence: `artifacts/qa/2026-10/calendar-fields/initial-before/results.json` and `expanded-before/results.json`, with isolated traces/screenshots. Final evidence: `artifacts/qa/2026-10/calendar-fields/final-twenty-one/results.json` and its `results` directory. Before traces include synthetic test credentials; they are local QA artifacts, not tutorial assets or production evidence.

## Executed workflows and independent verification

- Refused create503 keeps the subscription name; real retry200, independent feed list and reload confirm persistence.
- Create all/events/tasks kinds using real radios; verify all three link values and full input selection. Read actual local ICS200 and its calendar MIME/body. CalDAV write403 is a read-only boundary. Renew Cancel keeps the old URL; refused renewal503 also keeps it; real renewal makes the old URL404 and persists the new URL. Refused revoke503 preserves it; real revoke makes it404 and removes the row after reload. Actual clipboard write/read was verified in Chromium only; Firefox/WebKit input selection was verified.
- Create select and number definitions with the actual manager. Rename an existing option without changing its ID; fill the answer through the personal form, move the definition down, archive/Undo, show archived/restore, then independently verify the same answer and reload.
- Eight concurrent real POSTs at nineteen feeds enforce the last slot. This is an API concurrency case using each browser’s authenticated fixture, not a claim about an unexercised cap-specific UI.
- Member `/fields` shows useful permission guidance and no New field action; definition write403, foreign feed renewal404 and inert foreign revoke preserve ownership. Required text validation is inline with `aria-invalid`; a real own answer save/reload does not change the head’s answer.
- The actual date picker in a browser set to Asia/Tashkent persists its chosen day; the independent GET and restored button text agree.
- Hold a real committed custom-answer200, type a newer answer, deliver the receipt, then save again. Independent GET after both writes and final reload confirm both acknowledgements and the retained draft.

Web/API typechecks and scoped ESLint passed. The later sequential UI loop rewrite only complies with the repository lint convention; it preserves the executed action order. Inventory merger tests passed6/6. No new applied migration, commit, push, deployment or video was performed by this agent.

The final functional run does **not** establish every field type, card inline editor, notification request, value/definition cap/blocklist/duplicate boundary, read-error Retry, owner-switch race, date clearing/western timezone, agenda, push setup, mobile/locale/theme/zoom or pixel quality. These distinct pending paths remain in `calendar-fields-evidence.json`; external integrations remain excluded. Other independent suites may supply some of them, but are not inferred here.
