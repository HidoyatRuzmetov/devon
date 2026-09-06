// One deliberate accessible-name defect, isolated (in principle) to the `a11y` gate.
//
// Target: `apps/web/src/shell/app-shell.tsx`, the desktop sidebar-collapse `IconButton` (icon-only,
// rendered on every `chrome:"app"` route at >= 1024px per design.md §3.2-3.3). Removing its
// `aria-label` leaves an icon-only interactive control with no accessible name, which axe-core's
// `button-name` rule reports at `serious` impact -- one of `agentic/gates.json`'s
// `a11y_blocking_impacts`.
//
// KNOWN GAP (recorded here, not fixed here -- out of this item's TOUCHES): as shipped today,
// `agentic/gates.json`'s `a11y` gate runs `pnpm --filter @devon/web test:a11y`, which is
// `apps/web/test/e2e/playwright.config.ts` filtered to `--grep @a11y`. No spec under
// `apps/web/test/e2e/**` carries an `@a11y` tag yet (the tagged axe suite lives under the top-level
// `e2e/**` package instead -- EPIC-000.9's own TOUCHES, a separate, unwired Playwright project).
// Verified empirically for this item: `pnpm --filter @devon/web test:a11y` on an *unmutated* tree
// already exits 1 with "Error: No tests found" -- so the `a11y` gate fails at HEAD regardless of this
// mutation, and this module's assertion cannot currently distinguish "failed because of the aria-label
// regression" from "failed because zero tests matched". `run.mjs` reports this as
// `status: 'confounded'` rather than a false pass. Filed for `wp-lead`/backlog: wire
// `apps/web`'s `test:a11y` (or the gate command itself, which is protected) to the real `@a11y` suite
// in `e2e/**`.
import { mutateFile } from '../lib/fs-mutator.mjs'

const TARGET = 'apps/web/src/shell/app-shell.tsx'
const NEEDLE = "aria-label={t(collapsed ? 'shell.sidebar.expand' : 'shell.sidebar.toggle')}\n              onClick={toggleCollapsed}"
const MUTATED = 'onClick={toggleCollapsed}'

export default {
  gate: 'a11y',
  description: `removes the aria-label from the desktop sidebar-collapse IconButton in ${TARGET} (axe button-name, serious)`,
  targets: [TARGET],
  knownGap:
    "pnpm --filter @devon/web test:a11y matches zero @a11y-tagged specs at HEAD (verified: exits 1 with 'No tests found' even unmutated) -- the a11y gate cannot currently confirm causality for this defect. See this module's header comment.",
  apply(root) {
    return mutateFile(root, TARGET, (text) => {
      if (!text.includes(NEEDLE)) throw new Error(`a11y mutation: anchor not found in ${TARGET}`)
      return text.replace(NEEDLE, MUTATED)
    })
  },
}
