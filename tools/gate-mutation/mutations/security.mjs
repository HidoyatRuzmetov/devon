// One deliberate OWASP-flagged pattern, isolated to the `security` gate.
//
// Target: a brand-new scratch file under this tool's own directory
// (`tools/gate-mutation/.tmp/security-defect.js`) shaped as a two-argument request handler that
// reads `req.query.<x>` and passes it to `eval(...)`. Verified empirically against the actual
// `p/owasp-top-ten` pull (`semgrep --config p/owasp-top-ten`, unauthenticated, the same invocation
// `security:scan` and CI use): this is `javascript.lang.security.audit.code-string-concat` (A03:2021
// Injection, taint mode, `severity: ERROR` -> Semgrep's `--error` flag makes it exit non-zero). A
// bare `eval(userInput)` with no matching request-handler shape does **not** trigger this ruleset's
// only eval-related rule (`detect-eval-with-expression` requires the tainted value to originate from
// `URLSearchParams(location.search|hash)` specifically) -- caught empirically while building this
// module, hence the specific two-parameter-function + `.query` shape below rather than a plainer
// snippet.
//
// Kept inside `tools/gate-mutation/**` and outside every workspace's `tsconfig` include/exclude and
// Vite/vitest globs, so it is picked up by `security:scan`'s repo-wide Semgrep pass without being
// picked up by `typecheck`, `lint`, `unit` or `build` for any package.
//
// `agentic/gates.json`'s `security` gate is `optional_local: true` with `requires_cmd: ["semgrep",
// "trivy"]`: on a machine missing either binary, gate.mjs reports the gate `skipped` (tolerated in the
// `integration` profile) rather than running it, so this mutation can only be *asserted* on a machine
// (or CI runner) that has both installed -- `run.mjs` reports `status: 'tooling-unavailable'` rather
// than a false pass when that happens (verified for this item: this sandbox has semgrep but not
// trivy, so `gate.mjs` skips `security` here regardless of the defect).
import { createFile } from '../lib/fs-mutator.mjs'

const TARGET = 'tools/gate-mutation/.tmp/security-defect.js'

export default {
  gate: 'security',
  description: `adds an untracked scratch file (${TARGET}): a request handler flowing req.query into eval() (OWASP A03 injection)`,
  targets: [TARGET],
  apply(root) {
    return createFile(
      root,
      TARGET,
      [
        '// Deliberate security-gate defect (EPIC-000.10 gate-mutation harness). Reverted immediately after use.',
        'function gateMutationHandler(req, res) {',
        '  const cmd = req.query.cmd',
        '  eval(cmd)',
        '}',
        '',
      ].join('\n'),
    )
  },
}
