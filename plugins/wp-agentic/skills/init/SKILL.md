---
name: init
description: Vendor the wp-agentic delivery runtime (protocol, invariants, gates, scripts, hooks, templates, ledger, backlog) into the current project so the repository is self-contained. Run once per project, or with --force to refresh.
disable-model-invocation: true
allowed-tools: Bash(node *), Read, Edit, Write
---

# /wp-agentic:init

Scaffold the delivery system into the project at the current working directory.

1. Run, from the project root:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/init-project.mjs" $ARGUMENTS
   ```
   If `${CLAUDE_PLUGIN_ROOT}` is not expanded in your environment, locate the plugin directory
   (`~/.claude/plugins/**/wp-agentic` or the repository's own `plugins/wp-agentic`) and use that path.
2. Read `agentic/gates.json` and align the gate commands with this repository's package scripts
   (typecheck, lint, unit, build, migrate, e2e, a11y). Do not weaken a gate; if a gate does not apply yet,
   leave it and note it in `agentic/README.md`.
3. Read `agentic/INVARIANTS.md` and adapt the product-specific invariants; keep the engineering ones.
4. Ensure `CLAUDE.md` points to `agentic/PROTOCOL.md`, `docs/03-plan/backlog.json`, and lists the
   commands `node agentic/scripts/gate.mjs`, `backlog.mjs`, `ledger.mjs`, `dod.mjs`.
5. Run `node agentic/scripts/selftest.mjs` and report the result verbatim.
