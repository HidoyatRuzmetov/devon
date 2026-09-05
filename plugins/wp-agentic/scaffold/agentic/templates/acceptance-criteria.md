# Acceptance criteria: <EPIC-ID> <epic title>

- **Class:** A | B | C   (see agentic/ROSTER.md)
- **Frozen at:** <ISO timestamp>   (edits after this need an AC-CHANGE ledger line)
- **Source:** docs/03-plan/backlog.json → <EPIC-ID>; docs/03-plan/FEATURE-PLAN.md § <…>
- **Personas exercised:** specialist | head of sub-department | director | HR | admin

## Criteria

```
AC-1  <observable behaviour, with numbers where possible>
      DISPROOF: <the observation that would prove it false>
      EVIDENCE-EXPECTED: gate:<name> | qa:<test> | qa-visual:<route> | a11y-i18n:<flow>

AC-2  …
```

Rules of thumb for good criteria:
- Name the persona, the entry point, the click/keystroke count, the state shown, and the record written.
- One criterion per behaviour. If it has "and", split it.
- Include at least one negative criterion (what must NOT happen: e.g. "a specialist cannot see another unit's restricted fields").
- Include the zero-training criterion for any new screen: "a first-time user with no help text finds <action> within 30 seconds" (verified by `wp-qa-visual` following the screen cold).
- Include the i18n criterion: "renders correctly in uz and ru with no truncation at 390 px".

## Explicitly out of scope (goes to backlog as `proposed`)

- <…>
