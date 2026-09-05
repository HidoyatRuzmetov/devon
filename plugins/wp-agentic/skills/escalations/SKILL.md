---
name: escalations
description: Present open escalations to the human as a numbered list of single questions with defaults, then record their answers into the escalation files, the backlog and the ledger, and reopen blocked epics that are now unblocked. Use when the human wants to answer what the loop could not decide.
disable-model-invocation: true
allowed-tools: Bash(node *), Read, Edit, Write, Glob, Grep, AskUserQuestion
---

# /wp-agentic:escalations

1. Read every `docs/04-escalations/*.md` with `Status: OPEN`. For each, extract: the one question, the
   default in force, the epic/item, and what changes if the answer differs.
2. Present them as a numbered list (question, default, consequence). If the session is interactive, use
   AskUserQuestion with the default as the first option; otherwise wait for the human's message.
3. For each answered escalation: append an `## Answer` block with the date, set `Status: ANSWERED`,
   append a ledger line
   `node agentic/scripts/ledger.mjs append escalations '{"epic":"…","slug":"…","answer":"…"}'`,
   and if the answer unblocks an epic set it back to ready:
   `node agentic/scripts/backlog.mjs set-status <EPIC> ready --note "escalation <slug> answered"`.
   If the answer changes a frozen criterion, write the `AC-CHANGE: <id> | <old> → <new> | <reason>`
   line into `agentic/ledger/cycles/<EPIC>/ac.md` and the ledger, per PROTOCOL §2.
4. Report which epics are runnable again. Do not start a ship run unless asked.
