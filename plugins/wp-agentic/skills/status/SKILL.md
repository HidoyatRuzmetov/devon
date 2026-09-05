---
name: status
description: Report the delivery state of the current project: ledger summary, backlog by status, open escalations with their questions and defaults, last gate run, and Definition-of-Done for any in-progress epic. Use when the human asks "where are we" or after a ship run.
disable-model-invocation: false
allowed-tools: Bash(node *), Bash(ls *), Read, Glob, Grep
---

# /wp-agentic:status

Run and read, in this order:
```bash
node agentic/scripts/ledger.mjs summary
node agentic/scripts/backlog.mjs list
node agentic/scripts/backlog.mjs next --json
```
Then `Read agentic/ledger/last-gate.json` (profile, ok, failed, skipped) and every
`docs/04-escalations/*.md` whose Status is OPEN (quote its one question and its default).
For each `in-progress` epic run `node agentic/scripts/dod.mjs --epic <id>`.

Report in plain language: what shipped (versions), what is blocked and by which question, gate
health (say explicitly if any gate is skipped), and the next epic that would run. Keep numbers in a
short table. Do not speculate beyond what the files say.
