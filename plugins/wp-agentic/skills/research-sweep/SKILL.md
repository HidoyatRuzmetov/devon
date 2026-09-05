---
name: research-sweep
description: Multi-dimension research fan-out with editorial verification, gap-fill, competitive matrix, three vision drafts, a judge panel and a synthesised plan draft. Use for product/technology discovery before a technical spec. Edit the DIMENSIONS list in the workflow script for a new topic.
disable-model-invocation: true
allowed-tools: Read, Edit, Workflow
---

# /wp-agentic:research-sweep

1. Open `${CLAUDE_PLUGIN_ROOT}/workflows/research-sweep.js` (or copy it into the project's
   `.claude/workflows/` to customise): edit `CONTEXT`, the `DIMENSIONS` array (key, title, brief) and
   the output folders (`docs/01-research`, `docs/02-synthesis`). Keep `model: 'sonnet'` for research and
   critics and `model: 'opus'` for vision/synthesis (cost discipline).
2. Launch `Workflow({ name: "wp-agentic:research-sweep" })` (or `{ scriptPath }` for a customised copy).
3. On completion, read `docs/01-research/README.md`-style index if present, otherwise list the files
   written, their word counts, the critic scores from the result, and any dimensions that were dropped
   or hit a session limit; offer to resume with `resumeFromRunId` for the failed stages.
