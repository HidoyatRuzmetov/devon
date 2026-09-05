---
name: polish-sweep
description: UX and visual polish pass over the running app: screenshots of every route in 3 widths, light/dark and uz/ru, a designer critique against DESIGN.md, the top fixes applied by the UI engineer, and a before/after report. Use after several epics ship or before a demo.
disable-model-invocation: true
allowed-tools: Bash(node *), Read, Workflow
---

# /wp-agentic:polish-sweep [maxFixes=8]

Make sure the app can be started (see `.claude/launch.json` or the README dev command). Then:
```
Workflow({ name: "wp-agentic:polish-sweep", args: { maxFixes: <N, default 8> } })
```
On completion read `agentic/ledger/polish/critique.md` and `agentic/ledger/polish/report.md`; report
the issues found, which were fixed, and the screenshot paths for before/after.
