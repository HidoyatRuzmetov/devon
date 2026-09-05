---
name: review-sweep
description: Exhaustive bug hunt over the codebase with six review lenses, adversarial refutation of every finding, and bounded fixing of confirmed SEV1/SEV2 issues. Use between epics or before a release.
disable-model-invocation: true
allowed-tools: Bash(node *), Read, Workflow
---

# /wp-agentic:review-sweep [scope] [fix=true|false]

Launch:
```
Workflow({ name: "wp-agentic:review-sweep", args: { scope: "<scope path or 'apps/ packages/'>", maxRounds: 3, fix: <true unless fix=false> } })
```
On completion read `agentic/ledger/findings.jsonl` entries with `epic: "SWEEP"` and
`agentic/ledger/last-gate.json`. Report confirmed findings by severity with file:line, what was fixed,
what remains open, and whether integration gates are green.
