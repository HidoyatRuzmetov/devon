---
name: ship
description: Run the autonomous delivery loop: take ready epics from docs/03-plan/backlog.json and ship them one by one through feature-cycle (frozen criteria → design → build with gates and bounded review/fix → verify → adjudicate → release → scout). Use when the backlog has ready epics and the human wants work shipped without babysitting.
disable-model-invocation: true
allowed-tools: Bash(node *), Bash(date *), Bash(git *), Read, Workflow
---

# /wp-agentic:ship [max=N]

Preconditions (check, do not assume):
1. `node agentic/scripts/backlog.mjs validate` passes and `node agentic/scripts/backlog.mjs next` names an epic.
   If none is ready, stop and tell the human which epics are `draft`/`proposed` and what they lack.
2. `agentic/.unlock` does not exist (delete it if it does; guards must be armed).
3. `node agentic/scripts/selftest.mjs` passes.
4. `git status --porcelain` is clean or the human has said uncommitted work may be included.

Then launch the loop. Workflow scripts cannot read the clock, so pass the timestamp and the plugin root:
```
Workflow({
  name: "wp-agentic:ship",
  args: { max: <N from $ARGUMENTS, default 3>, ts: "<ISO timestamp from `date -Iseconds`>",
          pluginRoot: "<absolute path of this plugin directory>", parallel: false }
})
```
Do not poll. When the completion notification arrives, read `agentic/ledger/run-summary.md` and list
open escalations in `docs/04-escalations/` (each has one question and a default). Report: epics
shipped with versions, epics blocked with the question that blocks them, and the next ready epic.
Never restate a workflow result you have not read from the ledger.
