---
name: feature-cycle
description: Ship exactly one backlog epic end to end (freeze acceptance criteria, design, decompose, build with gates and bounded review/fix loops, verify, adjudicate, release, scout). Use for a single epic id such as EPIC-012.
disable-model-invocation: true
allowed-tools: Bash(node *), Bash(date *), Read, Workflow
---

# /wp-agentic:feature-cycle EPIC-ID

1. Verify the epic exists and is `ready` or `in-progress`: `node agentic/scripts/backlog.mjs get $ARGUMENTS`.
2. Ensure `agentic/.unlock` is absent and `node agentic/scripts/selftest.mjs` passes.
3. Launch:
   ```
   Workflow({ name: "wp-agentic:feature-cycle", args: { epic: "$ARGUMENTS", ts: "<ISO from `date -Iseconds`>", parallel: false } })
   ```
4. On completion read `agentic/ledger/cycles/$ARGUMENTS/adjudication.json`, the verification reports in
   that folder, and any new file in `docs/04-escalations/`. Report the verdict per acceptance criterion,
   the release version if released, and every open escalation with its default.
