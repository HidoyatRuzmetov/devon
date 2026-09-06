// One deliberate copy defect, isolated to the `e2e` gate.
//
// Target: `packages/i18n/messages/uz-Latn.json`, key `shell.locale.aria`. Changing its *value* (not
// deleting the key -- that would be the `i18n` mutation's job) leaves every locale's key set intact,
// so `check-i18n.mjs` stays green, but `apps/web/test/e2e/shell.smoke.spec.ts`'s
// `page.getByRole('button', { name: 'Interfeys tili' })` (an exact accessible-name match) no longer
// finds the locale-switch trigger, failing the `@smoke locale switch ... is exactly 2 clicks` test
// that `test:e2e` (the `e2e` gate) runs.
//
// KNOWN GAP (recorded here, not fixed here -- out of this item's TOUCHES): verified empirically for
// this item, `pnpm --filter @devon/web test:e2e` already fails on an *unmutated* tree in this
// environment -- the very first assertion (`getByRole('heading', { name: 'Tizimga kirish' })` on
// `/login`) times out before this mutation's own click sequence is ever reached. `run.mjs`'s
// baseline-aware modes report that as `status: 'confounded'` rather than a false pass. Filed for
// `wp-lead`/backlog to reproduce and fix in `apps/web`/`e2e`'s own TOUCHES -- not this item's.
import { setJsonKeyPath } from '../lib/fs-mutator.mjs'

const TARGET = 'packages/i18n/messages/uz-Latn.json'
const KEY = 'shell.locale.aria'
const MUTATED_VALUE = 'Interfeys tili (gate-mutation defect)'

export default {
  gate: 'e2e',
  description: `changes the '${KEY}' value in ${TARGET} so the locale trigger's accessible name no longer matches the e2e spec`,
  targets: [TARGET],
  knownGap:
    "pnpm --filter @devon/web test:e2e already fails on an unmutated tree in this environment (first assertion on /login times out before this mutation's click sequence runs) -- cannot currently confirm causality for this defect.",
  apply(root) {
    return setJsonKeyPath(root, TARGET, KEY, MUTATED_VALUE)
  },
}
