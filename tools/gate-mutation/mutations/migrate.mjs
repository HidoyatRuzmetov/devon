// One deliberate unclassified-table defect, isolated to the `migrate` gate.
//
// Target: `packages/db/src/tenancy.ts`'s `TENANCY` registry (ADR-002). Removing the
// `'app.memberships': 'department_owned'` entry leaves a real `department_owned` base table
// unclassified; `test/checks/tenancy.ts`'s "every base table in app/audit is classified in TENANCY"
// assertion -- run by `migrate:verify`, i.e. the `migrate` gate -- fails. `TENANCY`'s type is
// `Record<string, TableClass>`, so removing one key from the object literal is still perfectly
// well-typed (no fixed key set to satisfy), and nothing else reads this file at build/lint/unit time
// (the registry test itself lives in `test/integration/**`, excluded from the `test:unit` glob --
// design.md §2.1, `packages/db/test/vitest.config.ts`), so only `migrate` moves.
import { mutateFile } from '../lib/fs-mutator.mjs'

const TARGET = 'packages/db/src/tenancy.ts'
const NEEDLE = "  'app.memberships': 'department_owned',\n"

export default {
  gate: 'migrate',
  description: `removes the 'app.memberships' entry from the TENANCY registry in ${TARGET} (unclassified table)`,
  targets: [TARGET],
  apply(root) {
    return mutateFile(root, TARGET, (text) => {
      if (!text.includes(NEEDLE)) throw new Error(`migrate mutation: anchor not found in ${TARGET}`)
      return text.replace(NEEDLE, '')
    })
  },
}
